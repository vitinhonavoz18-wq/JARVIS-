import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  LayoutDashboard, MessageSquareText, CalendarDays, CheckSquare, NotebookPen, FolderKanban, Repeat, Library, BarChart3, Settings,
  Search, Plus, Target, Cloud, HardDrive, Mic, X, BellRing,
} from 'lucide-react';
import { useEffect } from 'react';
import { useApp } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { cn } from '@/lib/cn.ts';
import { QuickCapture } from '@/components/QuickCapture.tsx';
import { CommandPalette } from '@/components/CommandPalette.tsx';

export const NAV = [
  { to: '/', label: 'Visão Geral', icon: LayoutDashboard, end: true },
  { to: '/conversar', label: 'Conversar', icon: MessageSquareText },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/tarefas', label: 'Tarefas', icon: CheckSquare },
  { to: '/notas', label: 'Meu Cérebro', icon: NotebookPen },
  { to: '/projetos', label: 'Projetos', icon: FolderKanban },
  { to: '/rotinas', label: 'Rotinas', icon: Repeat },
  { to: '/foco', label: 'Mission Mode', icon: Target },
  { to: '/conhecimento', label: 'Conhecimento', icon: Library },
  { to: '/relatorios', label: 'Relatórios', icon: BarChart3 },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

const MOBILE = [NAV[0], NAV[3], NAV[1], NAV[2], NAV[4]];

export function AppShell() {
  const { mode, prefs } = useApp();
  const { openCapture, setPaletteOpen, toasts, dismissToast, wakeActive, startListening } = useJarvis();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Atalhos do app e “Compartilhar com o JARVIS”: abre a captura preenchida, sem executar nada sozinho.
    const p = new URLSearchParams(location.search);
    const shared = [p.get('title'), p.get('text'), p.get('url')].filter(Boolean).join('\n').trim();
    if (p.get('capture') === '1' || shared) {
      openCapture(shared);
      navigate(location.pathname, { replace: true });
    }
  }, [location, navigate, openCapture]);

  return (
    <div className="relative z-10 flex h-full">
      {/* Barra lateral (desktop) */}
      <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-line bg-void/40 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="relative h-9 w-9">
            <div className="absolute inset-0 rounded-full bg-gradient-to-br from-cyan to-violet blur-md opacity-60" />
            <div className="relative grid h-9 w-9 place-items-center rounded-full border border-cyan/40 bg-void">
              <div className="h-3.5 w-3.5 rounded-full bg-gradient-to-br from-ink via-cyan to-tech shadow-[0_0_12px_rgb(0_217_255)]" />
            </div>
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
        <div className="m-3 rounded-xl border border-line bg-void/40 p-3 text-xs">
          <div className="flex items-center gap-2 text-muted">
            {mode === 'cloud' ? <Cloud className="h-3.5 w-3.5 text-success" /> : <HardDrive className="h-3.5 w-3.5 text-warn" />}
            {mode === 'cloud' ? 'Sincronizado na nuvem' : 'Modo Local (só neste aparelho)'}
          </div>
          {prefs.wake_word_enabled && (
            <div className="mt-1.5 flex items-center gap-2 text-muted">
              <Mic className={cn('h-3.5 w-3.5', wakeActive ? 'text-cyan' : 'text-muted')} />
              {wakeActive ? 'Ouvindo “Jarvis”' : 'Ativação por voz pausada'}
            </div>
          )}
        </div>
      </aside>

      {/* Conteúdo */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="pt-safe lg:hidden sticky top-0 z-30 flex items-center justify-between border-b border-line bg-void/70 px-4 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-gradient-to-br from-ink via-cyan to-violet shadow-[0_0_14px_rgb(0_217_255/0.8)]" />
            <span className="font-display font-semibold tracking-[0.15em] text-sm">JARVIS</span>
            {mode === 'local' && <span className="label-tech !text-warn !text-[0.55rem]">local</span>}
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPaletteOpen(true)} className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:text-ink cursor-pointer" aria-label="Pesquisar">
              <Search className="h-5 w-5" />
            </button>
            <NavLink to="/configuracoes" className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:text-ink" aria-label="Configurações">
              <Settings className="h-5 w-5" />
            </NavLink>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto scroll-thin">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="mx-auto w-full max-w-7xl px-4 pt-5 pb-32 md:px-8 md:pt-8 lg:pb-12"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {/* Botão global de captura (oculto na conversa, onde o campo de comando já está visível) */}
      {location.pathname !== '/conversar' && <button
        onClick={() => openCapture()}
        className="fixed right-4 bottom-[calc(5.5rem+var(--safe-bottom))] lg:bottom-6 lg:right-6 z-40 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-tech to-cyan text-void shadow-[0_8px_32px_-4px_rgb(0_217_255/0.7)] transition hover:scale-105 active:scale-95 cursor-pointer"
        aria-label="Captura rápida (Ctrl J)"
        title="Captura rápida (Ctrl J)"
      >
        <Plus className="h-6 w-6" />
      </button>}

      {/* Navegação inferior (mobile) */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-void/85 backdrop-blur-xl lg:hidden" aria-label="Navegação">
        <div className="grid grid-cols-5 px-2 pt-1.5">
          {MOBILE.map((n, i) =>
            i === 2 ? (
              <button key="mic" onClick={() => { navigate('/conversar'); startListening(); }} className="-mt-6 flex flex-col items-center gap-1 cursor-pointer" aria-label="Falar com o JARVIS">
                <span className="grid h-14 w-14 place-items-center rounded-full border border-cyan/50 bg-void shadow-[0_0_30px_rgb(0_217_255/0.45)]">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-cyan to-tech text-void">
                    <Mic className="h-5 w-5" />
                  </span>
                </span>
                <span className="text-[10px] text-cyan">JARVIS</span>
              </button>
            ) : (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn('flex flex-col items-center gap-1 py-1.5 text-[10px]', isActive ? 'text-cyan' : 'text-muted')}>
                <n.icon className="h-5 w-5" />
                {n.label.replace('Visão Geral', 'Início').replace('Meu Cérebro', 'Notas')}
              </NavLink>
            ),
          )}
        </div>
      </nav>

      <QuickCapture />
      <CommandPalette />

      {/* Avisos */}
      <div className="pointer-events-none fixed top-4 right-4 left-4 sm:left-auto z-[60] flex flex-col items-end gap-2" aria-live="assertive">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 30, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30 }}
              className={cn(
                'glass pointer-events-auto w-full sm:w-96 rounded-2xl p-4 shadow-2xl shadow-black/40',
                t.tone === 'error' && 'border-danger/40',
                t.tone === 'reminder' && 'border-cyan/50 shadow-[0_0_40px_-10px_rgb(0_217_255/0.6)]',
              )}
            >
              <div className="flex items-start gap-3">
                {t.tone === 'reminder' && <BellRing className="mt-0.5 h-5 w-5 text-cyan" />}
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{t.title}</p>
                  {t.body && <p className="mt-0.5 text-sm text-muted">{t.body}</p>}
                </div>
                <button onClick={() => dismissToast(t.id)} className="text-muted hover:text-ink cursor-pointer" aria-label="Fechar aviso">
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
