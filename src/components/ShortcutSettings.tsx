import { useCallback, useEffect, useState } from 'react';
import { Smartphone, Copy, Check, KeyRound, Trash2, Apple, Bot } from 'lucide-react';
import { useApp } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { supabase } from '@/lib/supabase.ts';
import { commandEndpoint, generateToken, sha256Hex } from '@/lib/shortcutTokens.ts';
import { formatRelativeDay } from '@/core/time.ts';
import { Badge, Button, Card, Input, Segmented } from '@/components/ui/index.tsx';

interface TokenRow { id: string; name: string; token_prefix: string; last_used_at: string | null; created_at: string; revoked_at: string | null }

function CopyField({ label, value }: { label: string; value: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div>
      <p className="mb-1 text-xs text-muted">{label}</p>
      <div className="flex gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-void/60 px-3 py-2 font-mono text-xs scroll-thin">{value}</code>
        <Button variant="outline" size="icon" aria-label={`Copiar ${label}`} onClick={async () => { await navigator.clipboard.writeText(value); setOk(true); setTimeout(() => setOk(false), 1500); }}>
          {ok ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}

/** Configurações → Atalhos: chama o JARVIS pela Siri ou pelo Android sem abrir o app. */
export function ShortcutSettings() {
  const app = useApp();
  const { toast } = useJarvis();
  const endpoint = commandEndpoint();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [name, setName] = useState('iPhone');
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [guide, setGuide] = useState<'ios' | 'android'>('ios');

  const load = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase.from('api_tokens').select('id,name,token_prefix,last_used_at,created_at,revoked_at').is('revoked_at', null).order('created_at', { ascending: false });
    setTokens(data ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  if (app.mode === 'local' || !supabase || !endpoint) {
    return (
      <Card className="p-5">
        <div className="mb-2 flex items-center gap-3"><Smartphone className="h-5 w-5 text-cyan" /><h2 className="font-display text-lg font-semibold">Atalhos (Siri e Android)</h2></div>
        <p className="text-sm text-muted">Para falar com o JARVIS pela Siri ou por um atalho no Android, sem abrir o app, é preciso o Modo Nuvem: os comandos são executados no servidor. Conecte o Supabase seguindo <code>docs/INSTALACAO.md</code>.</p>
        <p className="mt-2 text-sm text-muted">Já disponível agora: no celular, use “Adicionar à tela inicial” e segure o ícone para abrir <b>Captura rápida</b> ou <b>Falar com o JARVIS</b>, ou use “Compartilhar → JARVIS” em outros apps.</p>
      </Card>
    );
  }

  const create = async () => {
    setBusy(true);
    try {
      const token = generateToken();
      const { error } = await supabase!.from('api_tokens').insert({ name: name.trim() || 'Atalho', token_hash: await sha256Hex(token), token_prefix: token.slice(0, 8) });
      if (error) throw error;
      setCreated(token);
      await load();
    } catch (e) {
      toast({ title: 'Não foi possível criar a chave', body: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (t: TokenRow) => {
    if (!window.confirm(`Revogar a chave “${t.name}”? Os atalhos que usam essa chave param de funcionar na hora.`)) return;
    await supabase!.from('api_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', t.id);
    await load();
  };

  const token = created ?? 'SUA_CHAVE';

  return (
    <Card className="p-5 xl:col-span-2">
      <div className="mb-1 flex items-center gap-3"><Smartphone className="h-5 w-5 text-cyan" /><h2 className="font-display text-lg font-semibold">Atalhos (Siri e Android)</h2></div>
      <p className="mb-4 text-sm text-muted">Fale com o JARVIS sem abrir o app. Cada aparelho usa uma chave pessoal, que pode ser revogada a qualquer momento. Ações sensíveis continuam pedindo confirmação: responda “sim” no comando seguinte.</p>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="label-tech">1. Crie uma chave para o aparelho</p>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome do aparelho" aria-label="Nome do aparelho" maxLength={60} />
            <Button onClick={create} loading={busy}><KeyRound className="h-4 w-4" /> Gerar chave</Button>
          </div>
          {created && (
            <div className="rounded-xl border border-warn/40 bg-warn/5 p-3">
              <p className="mb-2 text-sm text-warn">Copie agora: por segurança, esta chave não será mostrada de novo.</p>
              <CopyField label="Chave" value={created} />
            </div>
          )}
          <CopyField label="Endereço do comando" value={`${endpoint}?format=text`} />
          {tokens.length > 0 && (
            <ul className="space-y-1.5">
              {tokens.map((t) => (
                <li key={t.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <span className="flex-1 truncate">{t.name} <span className="font-mono text-xs text-muted">{t.token_prefix}…</span></span>
                  <Badge>{t.last_used_at ? `usada ${formatRelativeDay(t.last_used_at, new Date(), app.prefs.timezone)}` : 'nunca usada'}</Badge>
                  <button onClick={() => revoke(t)} className="text-muted hover:text-danger cursor-pointer" aria-label={`Revogar ${t.name}`}><Trash2 className="h-4 w-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <p className="label-tech mb-2">2. Configure o atalho</p>
          <Segmented value={guide} onChange={setGuide} options={[{ value: 'ios', label: 'iPhone (Siri)' }, { value: 'android', label: 'Android' }]} className="mb-3" />
          {guide === 'ios' ? (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Abra o app <b>Atalhos</b> e toque em <b>+</b>.</li>
              <li>Adicione <b>Ditar Texto</b> (idioma: Português do Brasil).</li>
              <li>Adicione <b>Obter Conteúdo do URL</b> e cole o endereço acima. Toque em <b>Mostrar Mais</b>: Método <b>POST</b>; Cabeçalhos: <code>Authorization</code> = <code className="break-all">Bearer {created ? token : 'SUA_CHAVE'}</code>; Corpo <b>JSON</b> com o campo <code>text</code> = <b>Texto Ditado</b>.</li>
              <li>Adicione <b>Falar Texto</b> usando o <b>Conteúdo do URL</b>.</li>
              <li>Dê o nome <b>Jarvis</b> ao atalho.</li>
              <li>Diga: <b>“E aí Siri, Jarvis”</b> e, em seguida, o seu comando.</li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              <li>Instale o app gratuito <b>HTTP Shortcuts</b> (Play Store).</li>
              <li>Crie um atalho: Método <b>POST</b>, URL = endereço acima.</li>
              <li>Em Cabeçalhos: <code>Authorization</code> = <code className="break-all">Bearer {created ? token : 'SUA_CHAVE'}</code>.</li>
              <li>Crie uma variável de <b>entrada de texto</b> chamada <code>comando</code> e use o corpo <b>JSON</b> <code>{'{"text": "{{comando}}"}'}</code>. No teclado, toque no microfone para ditar.</li>
              <li>Em Resposta, escolha <b>mostrar em janela</b>.</li>
              <li>Adicione o atalho à tela inicial como widget.</li>
            </ol>
          )}
          <p className="mt-3 flex items-start gap-2 text-xs text-muted">
            {guide === 'ios' ? <Apple className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Bot className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {guide === 'ios'
              ? 'Com o iPhone bloqueado, a Siri pode pedir o desbloqueio antes de executar, conforme suas configurações de segurança.'
              : 'O Google Assistente não envia comandos para endereços personalizados sozinho. Para dizer “Ok Google” e falar com o JARVIS, é preciso um app de automação como o Tasker (pago).'}
          </p>
        </div>
      </div>
    </Card>
  );
}
