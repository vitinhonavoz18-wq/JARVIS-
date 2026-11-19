import { useState, type FormEvent } from 'react';
import { Mail, KeyRound } from 'lucide-react';
import { supabase } from '@/lib/supabase.ts';
import { Button, Card, Field, Input, Segmented } from '@/components/ui/index.tsx';
import { JarvisCore } from '@/components/core/JarvisCore.tsx';
import { useRef } from 'react';

export default function Login() {
  const [mode, setMode] = useState<'login' | 'signup' | 'magic'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const level = useRef(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      if (mode === 'login') {
        const { error } = await supabase!.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { error } = await supabase!.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: window.location.origin } });
        if (error) throw error;
        setMsg({ ok: true, text: 'Conta criada. Verifique seu e-mail para confirmar o cadastro.' });
      } else {
        const { error } = await supabase!.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
        if (error) throw error;
        setMsg({ ok: true, text: 'Enviamos um link de acesso para o seu e-mail.' });
      }
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      setMsg({ ok: false, text: /invalid login/i.test(m) ? 'E-mail ou senha incorretos.' : m });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative z-10 grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <JarvisCore state={loading ? 'thinking' : 'idle'} level={level} size={170} showLabel={false} />
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-[0.2em]">J.A.R.V.I.S.</h1>
          <p className="label-tech mt-1">FV · Personal Intelligence OS</p>
        </div>
        <Card className="p-6">
          <Segmented className="mb-5 w-full justify-center" value={mode} onChange={(m) => { setMode(m); setMsg(null); }} options={[{ value: 'login', label: 'Entrar' }, { value: 'signup', label: 'Criar conta' }, { value: 'magic', label: 'Link por e-mail' }]} />
          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && <Field label="Como devo te chamar?"><Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></Field>}
            <Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></Field>
            {mode !== 'magic' && <Field label="Senha"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></Field>}
            {msg && <p className={msg.ok ? 'text-sm text-success' : 'text-sm text-danger'} role="alert">{msg.text}</p>}
            <Button type="submit" className="w-full" loading={loading}>{mode === 'magic' ? <><Mail className="h-4 w-4" /> Enviar link</> : <><KeyRound className="h-4 w-4" /> {mode === 'login' ? 'Entrar' : 'Criar conta'}</>}</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
