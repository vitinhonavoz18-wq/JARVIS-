import { useEffect, useState } from 'react';
import { MonitorSmartphone, RefreshCw } from 'lucide-react';
import { currentLevel, GFX_LABEL, onGraphicsChange, writePref, type GfxPref } from '@/lib/graphics.ts';
import { readVitals } from '@/lib/vitals.ts';
import { Badge, Button, Card } from '@/components/ui/index.tsx';
import { cn } from '@/lib/cn.ts';

const DESC: Record<GfxPref, string> = {
  auto: 'Escolhe pelo aparelho e reduz sozinho se detectar lentidão ou falha gráfica.',
  high: 'Núcleo 3D completo, desfoques e animações.',
  balanced: 'Núcleo 3D mais leve (menos partículas, menor resolução), desfoques suaves.',
  economy: 'Núcleo em CSS, sem desfoques nem animações decorativas. Ideal se aparecerem falhas visuais.',
};

/** JARVIS Graphics Safe Mode — reduz efeitos sem desligar nenhuma função. */
export function GraphicsSettings() {
  const [info, setInfo] = useState(currentLevel);
  useEffect(() => {
    const off = onGraphicsChange(() => setInfo(currentLevel()));
    return () => {
      off();
    };
  }, []);
  const vitals = readVitals()[0];

  const update = async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update().catch(() => {});
    // Limpa somente arquivos do app em cache — tarefas, notas e configurações não são tocadas.
    if ('caches' in window) for (const k of await caches.keys()) if (k.startsWith('jarvis-')) await caches.delete(k);
    location.reload();
  };

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <MonitorSmartphone className="mt-0.5 h-5 w-5 text-cyan" />
        <div>
          <h2 className="font-display text-lg font-semibold">Qualidade visual</h2>
          <p className="text-sm text-muted">Modo de segurança gráfica: reduz efeitos, nunca funcionalidades.</p>
        </div>
      </div>
      <div role="radiogroup" aria-label="Qualidade visual" className="grid gap-2 sm:grid-cols-2">
        {(Object.keys(GFX_LABEL) as GfxPref[]).map((p) => (
          <button
            key={p}
            role="radio"
            aria-checked={info.pref === p}
            onClick={() => writePref(p)}
            className={cn('rounded-xl border p-3 text-left transition cursor-pointer', info.pref === p ? 'border-cyan/60 bg-cyan/10' : 'border-line hover:border-cyan/30')}
          >
            <p className="text-sm font-medium">{GFX_LABEL[p]}</p>
            <p className="mt-0.5 text-xs text-muted">{DESC[p]}</p>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Em uso agora: <Badge tone="cyan">{GFX_LABEL[info.level]}</Badge> — {info.reason}.
      </p>
      {vitals && (
        <p className="mt-2 text-xs text-muted">
          Última medição neste aparelho: LCP {vitals.lcp ?? '—'} ms · CLS {vitals.cls ?? 0} · resposta a toques {vitals.inp ?? '—'} ms
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={update}><RefreshCw className="h-4 w-4" /> Atualizar o app</Button>
        <span className="self-center text-[11px] text-muted">Versão {__BUILD_ID__}</span>
      </div>
    </Card>
  );
}
