import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import type { Repo, Query } from '@/core/data/repo.ts';
import { MemoryRepo } from '@/core/data/memoryRepo.ts';
import { SupabaseRepo } from '@/core/data/supabaseRepo.ts';
import type { Source, TableMap, TableName, UserPreferences } from '@/core/types.ts';
import type { ToolContext } from '@/core/agent/tools.ts';
import type { LlmProvider } from '@/core/agent/agent.ts';
import { DEFAULT_TZ } from '@/core/time.ts';
import { supabase } from './supabase.ts';
import { localAdapter } from './localStore.ts';
import { observable } from './observableRepo.ts';
import { cloudServices } from './integrationServices.ts';

export const LOCAL_USER_ID = '00000000-0000-4000-8000-000000000001';

export const DEFAULT_PREFS: Omit<UserPreferences, 'id' | 'user_id' | 'created_at' | 'updated_at'> = {
  display_name: 'Franklin',
  assistant_name: 'JARVIS',
  timezone: DEFAULT_TZ,
  locale: 'pt-BR',
  voice_enabled: true,
  wake_word_enabled: false,
  tts_enabled: true,
  tts_voice: null,
  tts_rate: 1,
  memory_enabled: true,
  memory_categories: [],
  quiet_hours_start: null,
  quiet_hours_end: null,
  default_reminder_minutes: 15,
  morning_briefing: true,
  push_enabled: false,
  accent: 'cyan',
  history_retention_days: 180,
};

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
});

interface AppState {
  status: 'loading' | 'signed_out' | 'ready' | 'error';
  retryPreferences(): void;
  mode: 'local' | 'cloud';
  repo: Repo;
  session: Session | null;
  prefs: UserPreferences;
  updatePrefs(patch: Partial<UserPreferences>): Promise<void>;
  aiAvailable: boolean;
  llm: LlmProvider | null;
  signOut(): Promise<void>;
  toolCtx(source?: Source): ToolContext;
  /** Muda a cada gravação: força recálculo de dados derivados. */
  version: number;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp fora do AppProvider');
  return v;
}

const cloudLlm: LlmProvider = {
  async chat(req) {
    const { data, error } = await supabase!.functions.invoke('ai-chat', { body: req });
    if (error) {
      let detail = error.message;
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) detail = body.error;
      } catch {
        /* corpo não é JSON */
      }
      throw new Error(detail);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  },
};

function Provider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [prefsError, setPrefsError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [aiAvailable, setAiAvailable] = useState(false);
  const [version, setVersion] = useState(0);
  const bump = useRef<number | null>(null);

  const onWrite = useCallback(() => {
    if (bump.current) window.clearTimeout(bump.current);
    bump.current = window.setTimeout(() => {
      setVersion((v) => v + 1);
      queryClient.invalidateQueries();
    }, 40);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const repo = useMemo<Repo | null>(() => {
    if (!supabase) return observable(new MemoryRepo(LOCAL_USER_ID, localAdapter), onWrite);
    if (!session) return null;
    return observable(new SupabaseRepo(supabase, session.user.id), onWrite);
  }, [session, onWrite]);

  // Carrega (ou cria) as preferências do usuário.
  useEffect(() => {
    setPrefsError(false);
    if (!repo) {
      setPrefs(null);
      return;
    }
    let alive = true;
    (async () => {
      const t = repo.table('user_preferences');
      const rows = await t.list({ limit: 1 });
      const row = rows[0] ?? (await t.insert({ ...DEFAULT_PREFS }));
      if (alive) setPrefs(row);
    })().catch(() => {
      if (alive) setPrefsError(true);
    });
    return () => {
      alive = false;
    };
  }, [repo, attempt]);

  // Verifica se o módulo de IA está configurado no servidor.
  useEffect(() => {
    if (!supabase || !session) return;
    supabase.functions
      .invoke('ai-chat', { body: { ping: true } })
      .then(({ data }) => setAiAvailable(Boolean(data?.configured)))
      .catch(() => setAiAvailable(false));
  }, [session]);

  // Sincronização em tempo real entre aparelhos.
  useEffect(() => {
    if (!supabase || !session) return;
    const ch = supabase.channel('jarvis-sync');
    for (const table of ['tasks', 'notes', 'calendar_events', 'reminders', 'focus_sessions']) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${session.user.id}` }, onWrite);
    }
    ch.subscribe();
    return () => {
      supabase!.removeChannel(ch);
    };
  }, [session, onWrite]);

  const updatePrefs = useCallback(
    async (patch: Partial<UserPreferences>) => {
      if (!repo || !prefs) return;
      const next = await repo.table('user_preferences').update(prefs.id, patch);
      setPrefs(next);
    },
    [repo, prefs],
  );

  const value = useMemo<AppState | null>(() => {
    const status: AppState['status'] = !authReady ? 'loading' : supabase && !session ? 'signed_out' : prefsError ? 'error' : prefs && prefs.user_id === repo?.userId ? 'ready' : 'loading';
    const p = prefs ?? ({ ...DEFAULT_PREFS, id: '', user_id: '', created_at: '', updated_at: '' } as UserPreferences);
    return {
      status,
      retryPreferences: () => setAttempt((n) => n + 1),
      mode: supabase ? 'cloud' : 'local',
      repo: repo ?? observable(new MemoryRepo('none'), () => {}),
      session,
      prefs: p,
      updatePrefs,
      aiAvailable,
      llm: aiAvailable ? cloudLlm : null,
      version,
      signOut: async () => {
        await supabase?.auth.signOut();
        queryClient.clear();
      },
      toolCtx: (source: Source = 'manual') => ({
        repo: repo!,
        now: new Date(),
        tz: p.timezone || DEFAULT_TZ,
        source,
        services: supabase ? cloudServices : null,
        prefs: {
          display_name: p.display_name,
          assistant_name: p.assistant_name,
          default_reminder_minutes: p.default_reminder_minutes,
          memory_enabled: p.memory_enabled,
          memory_categories: p.memory_categories,
          timezone: p.timezone,
        },
      }),
    };
  }, [authReady, session, prefs, prefsError, repo, updatePrefs, aiAvailable, version]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Provider>{children}</Provider>
    </QueryClientProvider>
  );
}

/** Lista linhas de uma tabela com cache e atualização automática. */
export function useRows<K extends TableName>(name: K, q?: Query<TableMap[K]>, enabled = true) {
  const { repo, status } = useApp();
  return useQuery({
    queryKey: [name, q ?? null, repo.userId],
    queryFn: () => repo.table(name).list(q),
    enabled: enabled && status === 'ready',
  });
}

/** Consulta derivada (ex.: snapshot do dia), refeita a cada gravação. */
export function useDerived<T>(key: unknown[], fn: (repo: Repo) => Promise<T>, enabled = true) {
  const { repo, status } = useApp();
  return useQuery({ queryKey: ['derived', ...key, repo.userId], queryFn: () => fn(repo), enabled: enabled && status === 'ready' });
}
