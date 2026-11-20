import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  LayoutDashboard, MessageSquareText, CalendarDays, CheckSquare, NotebookPen, FolderKanban, Repeat, Library, BarChart3, Settings,
  Search, Plus, Target, Cloud, HardDrive, Mic, X, BellRing, Building2, Workflow, Cpu, WifiOff, CalendarPlus, AlarmClock,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { useOnline } from '@/lib/hooks.ts';
import { cn } from '@/lib/cn.ts';
import { QuickCapture } from '@/components/QuickCapture.tsx';
import { CommandPalette } from '@/components/CommandPalette.tsx';

export const NAV = [
  { to: '/', label: 'Visão Geral', icon: LayoutDashboard, end: true },
  { to: '/conversar', label: 'Conversar', icon: MessageSquareText },
  { to: '/executivo', label: 'Central Executiva', icon: Building2 },
  { to: '/automacoes', label: 'Automation Studio', icon: Workflow },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/tarefas', label: 'Tarefas', icon: CheckSquare },
  { to: '/notas', label: 'Meu Cérebro', icon: NotebookPen },
  { to: '/projetos', label: 'Projetos', icon: FolderKanban },
  { to: '/rotinas', label: 'Rotinas', icon: Repeat },
  { to: '/foco', label: 'Mission Mode', icon: Target },
  { to: '/conhecimento', label: 'Conhecimento', icon: Library },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/ai-engine', label: 'AI Engine', icon: Cpu },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

const MOBILE = [
  { to: '/', label: 'Início', icon: LayoutDashboard, end: true },
  { to: '/tarefas', label: 'Tarefas', icon: CheckSquare },
  null, // microfone central
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/notas', label: 'Notas', icon: NotebookPen },
];

const CREATE_ACTIONS = [
  { label: 'Tarefa', icon: CheckSquare, to: '/tarefas?novo=1' },
  { label: 'Anotação', icon: NotebookPen, to: '/notas?novo=1' },
  { label: 'Compromisso', icon: CalendarPlus, to: '/agenda?novo=1' },
  { label: 'Projeto', icon: FolderKanban, to: '/projetos?novo=1' },
  { label: 'Lembrete', icon: AlarmClock, capture: 'Me lembre de ' },
];

/** Estado de conexão real: modo do app + rede do aparelho. */
function ConnectionBadge({ compact }: { compact?: boolean }) {
  const { mode } = useApp();
  const online = useOnline();
  const s = !online
    ? { label: 'Offline', icon: WifiOff, cls: 'text-danger border-danger/40', title: 'Sem internet: no Modo Local tudo continua funcionando neste aparelho.' }
    : mode === 'cloud'
      ? { label: 'Online', icon: Cloud, cls: 'text-success border-success/40', title: 'Sincronizado na nuvem' }
      : { label: 'Local', icon: HardDrive, cls: 'text-warn border-warn/40', title: 'Modo Local: dados salvos só neste aparelho' };
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider', s.cls)} title={s.title} role="status" aria-label={`Conexão: ${s.label}`}>
      <s.icon className="h-3 w-3" aria-hidden />
      {!compact && s.label}
      {compact && <span>{s.label}</span>}
    </span>
  );
}

function CreateMenu() {
  const { openCapture } = useJarvis();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="fixed right-4 z-fab bottom-[calc(var(--nav-h)+var(--safe-bottom)+0.75rem)] lg:bottom-6 lg:right-6 flex flex-col items-end gap-2">
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.16 }}
            className="glass-overlay mb-1 w-52 overflow-hidden rounded-2xl p-1.5 shadow-2xl shadow-black/50"
            role="menu"
            aria-label="Criar"
          >
            {CREATE_ACTIONS.map((a) => (
              <li key={a.label} role="none">
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    if (a.capture) openCapture(a.capture);
                    else navigate(a.to!);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-cyan/10 focus-visible:bg-cyan/10 cursor-pointer"
                >
                  <a.icon className="h-4.5 w-4.5 text-cyan" aria-hidden /> {a.label}
                </button>
              </li>
            ))}
            <li role="none">
              <button role="menuitem" onClick={() => { setOpen(false); openCapture(); }} className="mt-1 flex w-full items-center gap-3 rounded-xl border-t border-line px-3 py-2.5 text-left text-sm text-muted hover:bg-cyan/10 cursor-pointer">
                <Mic className="h-4.5 w-4.5" aria-hidden /> Captura livre <kbd className="ml-auto hidden font-mono text-[10px] lg:inline">Ctrl J</kbd>
              </button>
            </li>
          </motion.ul>
        )}
      </AnimatePresence>
      <button
        onClick={() => setOpen((v) => !v)}
        className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-tech to-cyan text-void shadow-[0_8px_28px_-6px_rgb(0_219_255/0.65)] transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        aria-label={open ? 'Fechar menu de criação' : 'Criar novo item'}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Plus className={cn('h-6 w-6 transition-transform duration-200', open && 'rotate-45')} />
      </button>
    </div>
  );
}

export function AppShell() {
  const { setPaletteOpen, toasts, dismissToast, wakeActive, startListening, openCapture } = useJarvis();
  const { prefs } = useApp();
  const location = useLocation();
  const navigate = useNavigate();

  // Atalhos e “Compartilhar com o JARVIS”: abre a captura preenchida, sem executar nada sozinho.
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const shared = [p.get('title'), p.get('text'), p.get('url')].filter(Boolean).join('\n').trim();
    if (p.get('capture') === '1' || shared) {
      openCapture(shared);
      navigate(location.pathname, { replace: true });
    }
  }, [location, navigate, openCapture]);

  // Nova versão publicada: oferece recarregar (sem apagar dados locais).
  const { toast } = useJarvis();
  useEffect(() => {
    const on = () => toast({ title: 'Nova versão do JARVIS disponível', body: 'Toque em “Atualizar” nas Configurações ou recarregue a página.', tone: 'info' });
    window.addEventListener('jarvis:update-ready', on);
    return () => window.removeEventListener('jarvis:update-ready', on);
  }, [toast]);

  // Cada página começa do topo.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <div className="relative min-h-dvh lg:flex">
      {/* Barra lateral (desktop) */}
      <aside className="hidden lg:flex lg:sticky lg:top-0 lg:h-dvh w-64 shrink-0 flex-col border-r border-line bar-surface">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="relative grid h-9 w-9 place-items-center rounded-full border border-cyan/40 bg-void shadow-[0_0_18px_-4px_rgb(0_219_255/0.7)]">
            <div className="h-3.5 w-3.5 rounded-full bg-gradient-to-br from-ink via-cyan to-tech shadow-[0_0_12px_rgb(0_219_255)]" />
          </div>
          <div>
            <p className="font-display text-[15px] font-semibold tracking-[0.18em]">J.A.R.V.I.S.</p>
            <p className="label-tech !text-[0.6rem]">FV · Personal Intelligence OS</p>
          </div>
        </div>
        <button onClick={() => setPaletteOpen(true)} className="mx-4 mb-3 flex items-center gap-2 rounded-xl border border-line bg-void/50 px-3 py-2 text-sm text-muted hover:text-ink hover:border-cyan/40 transition cursor-pointer">
          <Search className="h-4 w-4" />
          <span className="flex-1 text-left">Pesquisar tudo</span>
          <kbd className="font-mono text-[10px] rounded border border-line px-1.5 py-0.5">Ctrl K</kbd>
        </button>
        <nav className="flex-1 space-y-0.5 overflow-y-auto scroll-thin px-3" aria-label="Navegação principal">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition',
                  isActive ? 'bg-gradient-to-r from-cyan/15 to-transparent text-ink shadow-[inset_2px_0_0_var(--color-cyan)]' : 'text-muted hover:bg-white/[0.03] hover:text-ink',
                )
              }
            >
              <n.icon className="h-4.5 w-4.5 transition group-hover:text-cyan" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="m-3 space-y-1.5 rounded-xl border border-line bg-void/40 p-3 text-xs text-muted">
          <ConnectionBadge />
          {prefs.wake_word_enabled && (
            <div className="flex items-center gap-2">
              <Mic className={cn('h-3.5 w-3.5', wakeActive ? 'text-cyan' : 'text-muted')} />
              {wakeActive ? 'Ouvindo “Jarvis”' : 'Ativação por voz pausada'}
            </div>
          )}
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe lg:hidden sticky top-0 z-header border-b border-line bar-surface">
          <div className="flex h-[var(--header-h)] items-center justify-between gap-2 px-3">
            <NavLink to="/" className="flex min-w-0 items-center gap-2 rounded-xl px-1 py-1" aria-label="JARVIS — início">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-cyan/40 bg-void shadow-[0_0_14px_-3px_rgb(0_219_255/0.8)]">
                <span className="h-3 w-3 rounded-full bg-gradient-to-br from-ink via-cyan to-tech" />
              </span>
              <span className="font-display text-sm font-semibold tracking-[0.18em]">JARVIS</span>
            </NavLink>
            <div className="flex items-center gap-0.5">
              <ConnectionBadge compact />
              <button onClick={() => setPaletteOpen(true)} className="grid h-11 w-11 place-items-center rounded-xl text-muted hover:text-ink cursor-pointer" aria-label="Pesquisar">
                <Search className="h-5 w-5" />
              </button>
              <NavLink to="/configuracoes" className="grid h-11 w-11 place-items-center rounded-xl text-muted hover:text-ink" aria-label="Configurações">
                <Settings className="h-5 w-5" />
              </NavLink>
            </div>
          </div>
        </header>
        <main className="flex-1">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="pb-nav mx-auto w-full max-w-7xl px-4 pt-5 md:px-8 md:pt-8"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {location.pathname !== '/conversar' && <CreateMenu />}

      {/* Navegação inferior (mobile) */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-nav border-t border-line bar-surface lg:hidden" aria-label="Navegação">
        <div className="mx-auto grid h-[var(--nav-h)] max-w-md grid-cols-5 items-center px-1">
          {MOBILE.map((n) =>
            n === null ? (
              <div key="mic" className="flex justify-center">
                <button
                  onClick={() => { navigate('/conversar'); startListening(); }}
                  className="-mt-7 flex flex-col items-center gap-1 cursor-pointer"
                  aria-label="Falar com o JARVIS"
                >
                  <span className="grid h-14 w-14 place-items-center rounded-full border border-cyan/50 bg-void shadow-[0_0_24px_-2px_rgb(0_219_255/0.5)]">
                    <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-cyan to-tech text-void">
                      <Mic className="h-5 w-5" />
                    </span>
                  </span>
                  <span className="text-[11px] font-medium text-cyan">JARVIS</span>
                </button>
              </div>
            ) : (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) => cn('relative flex h-full min-h-11 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium transition-colors', isActive ? 'text-cyan' : 'text-muted hover:text-ink')}
              >
                {({ isActive }) => (
                  <>
                    {isActive && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-cyan shadow-[0_0_8px_var(--color-cyan)]" aria-hidden />}
                    <n.icon className="h-5 w-5" aria-hidden />
                    {n.label}
                  </>
                )}
              </NavLink>
            ),
          )}
        </div>
      </nav>

      <QuickCapture />
      <CommandPalette />

      {/* Avisos */}
      <div className="pointer-events-none fixed top-[calc(var(--safe-top)+0.75rem)] right-4 left-4 sm:left-auto z-toast flex flex-col items-end gap-2" aria-live="assertive">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className={cn(
                'glass-overlay pointer-events-auto w-full sm:w-96 rounded-2xl p-4 shadow-2xl shadow-black/40',
                t.tone === 'error' && 'border-danger/40',
                t.tone === 'reminder' && 'border-cyan/50',
              )}
            >
              <div className="flex items-start gap-3">
                {t.tone === 'reminder' && <BellRing className="mt-0.5 h-5 w-5 text-cyan" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{t.title}</p>
                  {t.body && <p className="mt-0.5 text-sm text-muted break-words">{t.body}</p>}
                </div>
                <button onClick={() => dismissToast(t.id)} className="-m-2 grid h-9 w-9 place-items-center text-muted hover:text-ink cursor-pointer" aria-label="Fechar aviso">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
