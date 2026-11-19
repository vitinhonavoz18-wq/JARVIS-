import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { cn } from '@/lib/cn.ts';
import type { CoreState } from '@/lib/jarvis.tsx';

const LABEL: Record<CoreState, string> = {
  idle: 'Pronto',
  listening: 'Ouvindo…',
  thinking: 'Processando…',
  speaking: 'Falando…',
  executing: 'Executando…',
  success: 'Concluído',
  error: 'Algo deu errado',
};

const FALLBACK_COLORS: Record<CoreState, string> = {
  idle: 'from-tech via-cyan to-violet',
  listening: 'from-cyan via-ink to-cyan',
  thinking: 'from-violet via-cyan to-violet',
  speaking: 'from-cyan via-violet to-tech',
  executing: 'from-tech via-violet to-cyan',
  success: 'from-success via-cyan to-success',
  error: 'from-danger via-violet to-danger',
};

/** Núcleo holográfico. Usa WebGL quando disponível; senão, uma versão leve em CSS. */
export function JarvisCore({ state, level, size = 280, className, showLabel = true }: { state: CoreState; level: MutableRefObject<number>; size?: number; className?: string; showLabel?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [mode, setMode] = useState<'pending' | 'webgl' | 'css'>('pending');

  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    (async () => {
      const mod = await import('./orbScene.ts');
      if (cancelled) return;
      if (reduced || !mod.webglAvailable() || !canvasRef.current) {
        setMode('css');
        return;
      }
      try {
        dispose = mod.createOrb(canvasRef.current, () => stateRef.current, () => level.current);
        setMode('webgl');
      } catch {
        setMode('css');
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [level]);

  return (
    <div className={cn('relative flex flex-col items-center', className)}>
      <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`Núcleo JARVIS: ${LABEL[state]}`}>
        <div className={cn('absolute inset-[18%] rounded-full blur-3xl opacity-40 transition-colors duration-700 bg-gradient-to-br', FALLBACK_COLORS[state])} />
        <canvas ref={canvasRef} className={cn('absolute inset-0 h-full w-full transition-opacity duration-700', mode === 'webgl' ? 'opacity-100' : 'opacity-0')} />
        {mode === 'css' && <CssOrb state={state} />}
      </div>
      {showLabel && (
        <div className="mt-1 flex items-center gap-2 label-tech" aria-live="polite">
          <span className={cn('h-1.5 w-1.5 rounded-full', state === 'error' ? 'bg-danger' : state === 'success' ? 'bg-success' : 'bg-cyan', state !== 'idle' && 'animate-pulse-soft')} />
          {LABEL[state]}
        </div>
      )}
    </div>
  );
}

function CssOrb({ state }: { state: CoreState }) {
  const active = state !== 'idle';
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="absolute inset-[8%] rounded-full border border-cyan/30 animate-spin-slow" style={{ borderStyle: 'dashed' }} />
      <div className="absolute inset-[16%] rounded-full border border-violet/30" />
      <div
        className={cn('h-[46%] w-[46%] rounded-full bg-gradient-to-br shadow-[0_0_80px_rgb(0_217_255/0.45)] transition-all duration-700', FALLBACK_COLORS[state], active && 'animate-pulse-soft')}
        style={{ transform: state === 'listening' ? 'scale(1.06)' : undefined }}
      />
    </div>
  );
}
