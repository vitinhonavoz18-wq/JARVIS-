import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Pin, Star, Trash2, RotateCcw, Mic, FolderKanban, History, Paperclip, NotebookPen, ArrowLeft, Tag, Folder } from 'lucide-react';
import type { Note } from '@/core/types.ts';
import { useApp, useRows } from '@/lib/app.tsx';
import { useJarvis } from '@/lib/jarvis.tsx';
import { executeCall } from '@/core/agent/agent.ts';
import { DEFAULT_PHASES } from '@/core/agent/tools.ts';
import { formatRelativeDay, formatTime } from '@/core/time.ts';
import { listenOnce, voiceSupport } from '@/lib/voice.ts';
import { supabase } from '@/lib/supabase.ts';
import { Button, Card, EmptyState, Input, PageHeader, Segmented, Spinner, Badge } from '@/components/ui/index.tsx';
import { cn } from '@/lib/cn.ts';

const NoteEditor = lazy(() => import('@/components/NoteEditor.tsx').then((m) => ({ default: m.NoteEditor })));

type Filter = 'all' | 'pinned' | 'favorite' | 'trash';

export default function Notes() {
  const app = useApp();
  const tz = app.prefs.timezone;
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('all');
  const [folder, setFolder] = useState('');
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(params.get('id'));
  const notes = useRows('notes', { order: [{ field: 'updated_at', asc: false }] });

  useEffect(() => {
    const id = params.get('id');
    if (id) {
      setSelectedId(id);
      params.delete('id');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const folders = useMemo(() => [...new Set((notes.data ?? []).filter((n) => !n.deleted_at).map((n) => n.folder).filter(Boolean))] as string[], [notes.data]);
  const list = useMemo(() => {
    let rows = (notes.data ?? []).filter((n) => (filter === 'trash' ? n.deleted_at : !n.deleted_at));
    if (filter === 'pinned') rows = rows.filter((n) => n.pinned);
    if (filter === 'favorite') rows = rows.filter((n) => n.favorite);
    if (folder) rows = rows.filter((n) => n.folder === folder);
    if (q.trim()) {
      const terms = q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\s+/);
      rows = rows.filter((n) => {
        const hay = `${n.title} ${n.content_text} ${n.tags.join(' ')}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        return terms.every((t) => hay.includes(t));
      });
    }
    return [...rows].sort((a, b) => Number(b.pinned) - Number(a.pinned));
  }, [notes.data, filter, folder, q]);

  const selected = (notes.data ?? []).find((n) => n.id === selectedId) ?? null;

  const creatingRef = useRef(false);
  useEffect(() => {
    if (params.get('novo') !== '1' || creatingRef.current) return;
    creatingRef.current = true;
    params.delete('novo');
    setParams(params, { replace: true });
    void create().finally(() => (creatingRef.current = false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const create = async () => {
    const n = await app.repo.table('notes').insert({ title: '', content: '', content_text: '', folder: folder || null, tags: [], source: 'manual' });
    setFilter('all');
    setSelectedId(n.id);
  };

  return (
    <div>
      <PageHeader title="Meu Cérebro" subtitle="Ideias, pensamentos e decisões — tudo pesquisável." actions={<Button onClick={create}><Plus className="h-4 w-4" /> Nova nota</Button>} />
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className={cn('space-y-3', selected && 'hidden lg:block')}>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar nas notas" className="pl-9" aria-label="Pesquisar nas notas" />
          </div>
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'all', label: 'Todas' }, { value: 'pinned', label: 'Fixadas' }, { value: 'favorite', label: 'Favoritas' }, { value: 'trash', label: 'Lixeira' }]} />
          {folders.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button onClick={() => setFolder('')} className={cn('rounded-full border px-2.5 py-1 text-xs cursor-pointer', !folder ? 'border-cyan/50 text-cyan' : 'border-line text-muted')}>Todas as pastas</button>
              {folders.map((f) => (
                <button key={f} onClick={() => setFolder(f === folder ? '' : f)} className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs cursor-pointer', folder === f ? 'border-cyan/50 text-cyan' : 'border-line text-muted')}>
                  <Folder className="h-3 w-3" /> {f}
                </button>
              ))}
            </div>
          )}
          {notes.isLoading ? (
            <div className="grid place-items-center py-10"><Spinner /></div>
          ) : list.length ? (
            <ul className="space-y-2">
              {list.map((n) => (
                <li key={n.id}>
                  <button onClick={() => setSelectedId(n.id)} className={cn('glass w-full rounded-xl p-3 text-left transition cursor-pointer', selectedId === n.id ? 'border-cyan/50' : 'hover:border-cyan/30')}>
                    <div className="flex items-center gap-1.5">
                      {n.pinned && <Pin className="h-3 w-3 text-cyan" />}
                      {n.favorite && <Star className="h-3 w-3 text-warn" />}
                      <p className="truncate text-sm font-medium">{n.title || 'Sem título'}</p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted">{n.content_text || 'Nota vazia'}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                      <span>{formatRelativeDay(n.updated_at, new Date(), tz)}</span>
                      {n.folder && <span>· {n.folder}</span>}
                      {n.tags.slice(0, 3).map((t) => <span key={t} className="text-cyan/80">#{t}</span>)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Card><EmptyState icon={<NotebookPen className="h-5 w-5" />} title={filter === 'trash' ? 'Lixeira vazia' : 'Nenhuma nota'} text={filter === 'trash' ? 'Notas excluídas ficam aqui e podem ser recuperadas.' : 'Diga “Jarvis, tive uma ideia…” ou crie uma nova nota.'} /></Card>
          )}
        </div>

        <div className={cn(!selected && 'hidden lg:block')}>
          {selected ? (
            <NotePanel key={selected.id} note={selected} onBack={() => setSelectedId(null)} />
          ) : (
            <Card className="grid min-h-[60vh] place-items-center"><EmptyState icon={<NotebookPen className="h-5 w-5" />} title="Selecione uma nota" text="Ou crie uma nova para registrar uma ideia." action={<Button variant="soft" onClick={create}><Plus className="h-4 w-4" /> Nova nota</Button>} /></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function NotePanel({ note, onBack }: { note: Note; onBack: () => void }) {
  const app = useApp();
  const { toast } = useJarvis();
  const tz = app.prefs.timezone;
  const [title, setTitle] = useState(note.title);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [tagInput, setTagInput] = useState('');
  const [dictating, setDictating] = useState(false);
  const pending = useRef<Partial<Note>>({});
  const timer = useRef<number | null>(null);
  const appendRef = useRef<((t: string) => void) | null>(null);
  const versions = useRows('note_versions', { eq: { note_id: note.id }, order: [{ field: 'created_at', asc: false }], limit: 20 }, app.mode === 'cloud');

  const flush = async () => {
    if (!Object.keys(pending.current).length) return;
    const patch = pending.current;
    pending.current = {};
    setSaving('saving');
    try {
      await app.repo.table('notes').update(note.id, patch);
      setSaving('saved');
    } catch (e) {
      toast({ title: 'Erro ao salvar a nota', body: String(e), tone: 'error' });
      setSaving('idle');
    }
  };
  const queue = (patch: Partial<Note>) => {
    pending.current = { ...pending.current, ...patch };
    setSaving('saving');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 800);
  };
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
    void flush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (patch: Partial<Note>) => app.repo.table('notes').update(note.id, patch);

  const dictate = async () => {
    setDictating(true);
    try {
      const text = await listenOnce({}).result;
      if (text) appendRef.current?.(text);
    } catch (e) {
      toast({ title: 'Ditado', body: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setDictating(false);
    }
  };

  const toProject = async () => {
    const name = (note.title || note.content_text.slice(0, 60)).replace(/^ideia\s+(de|para|sobre)?\s*/i, '') || 'Novo projeto';
    if (!window.confirm(`Criar o projeto “${name}” a partir desta nota, com as etapas: ${DEFAULT_PHASES.join(', ')}?`)) return;
    const ctx = app.toolCtx('manual');
    const r1 = await executeCall(ctx, { tool: 'create_project', input: { name, description: note.content_text.slice(0, 2000) } });
    const r2 = r1.ok ? await executeCall(ctx, { tool: 'add_project_tasks', input: { project: name, tasks: DEFAULT_PHASES.map((title) => ({ title })) } }, { bypassConfirm: true }) : r1;
    if (r1.ok) await update({ project_id: (r1.data as { id: string }).id });
    toast({ title: r2.ok ? 'Projeto criado' : 'Erro', body: r2.message, tone: r2.ok ? 'success' : 'error' });
  };

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, '');
    if (!t || note.tags.includes(t)) return setTagInput('');
    update({ tags: [...note.tags, t] });
    setTagInput('');
  };

  return (
    <Card className="p-4 md:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onBack} className="lg:hidden"><ArrowLeft className="h-4 w-4" /> Notas</Button>
        <span className="label-tech mr-auto">{saving === 'saving' ? 'salvando…' : saving === 'saved' ? 'salvo ✓' : `editada ${formatRelativeDay(note.updated_at, new Date(), tz)} ${formatTime(note.updated_at, tz)}`}</span>
        {note.deleted_at ? (
          <Button variant="soft" size="sm" onClick={() => update({ deleted_at: null })}><RotateCcw className="h-4 w-4" /> Restaurar</Button>
        ) : (
          <>
            <Button variant="ghost" size="icon" onClick={() => update({ pinned: !note.pinned })} aria-label={note.pinned ? 'Desafixar' : 'Fixar'} aria-pressed={note.pinned}><Pin className={cn('h-4 w-4', note.pinned && 'text-cyan')} /></Button>
            <Button variant="ghost" size="icon" onClick={() => update({ favorite: !note.favorite })} aria-label={note.favorite ? 'Remover dos favoritos' : 'Favoritar'} aria-pressed={note.favorite}><Star className={cn('h-4 w-4', note.favorite && 'text-warn fill-warn')} /></Button>
            {voiceSupport.recognition() && <Button variant="ghost" size="icon" onClick={dictate} disabled={dictating} aria-label="Ditar texto"><Mic className={cn('h-4 w-4', dictating && 'text-cyan animate-pulse')} /></Button>}
            <Button variant="ghost" size="icon" onClick={toProject} aria-label="Transformar em projeto" title="Transformar em projeto"><FolderKanban className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={async () => { await update({ deleted_at: new Date().toISOString() }); onBack(); }} aria-label="Mover para a lixeira"><Trash2 className="h-4 w-4" /></Button>
          </>
        )}
      </div>
      <input
        value={title}
        onChange={(e) => { setTitle(e.target.value); queue({ title: e.target.value }); }}
        placeholder="Título"
        className="mb-3 w-full bg-transparent font-display text-2xl font-semibold focus:outline-none"
        aria-label="Título da nota"
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 text-muted"><Folder className="h-3.5 w-3.5" />
          <input defaultValue={note.folder ?? ''} onBlur={(e) => update({ folder: e.target.value.trim() || null })} placeholder="Pasta" className="w-28 bg-transparent focus:outline-none" aria-label="Pasta" />
        </span>
        {note.tags.map((t) => (
          <Badge key={t} tone="cyan">#{t}<button onClick={() => update({ tags: note.tags.filter((x) => x !== t) })} className="ml-0.5 cursor-pointer" aria-label={`Remover etiqueta ${t}`}>×</button></Badge>
        ))}
        <span className="inline-flex items-center gap-1 text-muted"><Tag className="h-3.5 w-3.5" />
          <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} onBlur={addTag} placeholder="etiqueta" className="w-24 bg-transparent focus:outline-none" aria-label="Nova etiqueta" />
        </span>
      </div>
      <Suspense fallback={<Spinner />}>
        <NoteEditor html={note.content} onChange={(html, text) => queue({ content: html, content_text: text })} appendRef={appendRef} />
      </Suspense>

      {app.mode === 'cloud' && <Attachments noteId={note.id} />}

      {app.mode === 'cloud' && Boolean(versions.data?.length) && (
        <details className="mt-6 border-t border-line pt-4">
          <summary className="label-tech flex cursor-pointer items-center gap-1.5"><History className="h-3.5 w-3.5" /> Histórico de versões ({versions.data!.length})</summary>
          <ul className="mt-3 space-y-2">
            {versions.data!.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <span className="truncate">{v.title || 'Sem título'} · <span className="text-muted">{formatRelativeDay(v.created_at, new Date(), tz)} {formatTime(v.created_at, tz)}</span></span>
                <Button variant="ghost" size="sm" onClick={() => window.confirm('Restaurar esta versão? A versão atual será salva no histórico.') && update({ title: v.title, content: v.content, content_text: v.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }).then(() => window.location.reload())}>Restaurar</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

interface AttachmentRow { id: string; file_name: string; storage_path: string; size_bytes: number }

function Attachments({ noteId }: { noteId: string }) {
  const app = useApp();
  const { toast } = useJarvis();
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const { data } = await supabase!.from('attachments').select('id,file_name,storage_path,size_bytes').eq('entity_type', 'note').eq('entity_id', noteId);
    setRows(data ?? []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const upload = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) return toast({ title: 'Arquivo muito grande', body: 'Limite de 20 MB.', tone: 'error' });
    setBusy(true);
    try {
      const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-100);
      const path = `${app.repo.userId}/${noteId}/${Date.now()}_${safe}`;
      const up = await supabase!.storage.from('attachments').upload(path, file, { contentType: file.type });
      if (up.error) throw up.error;
      const ins = await supabase!.from('attachments').insert({ entity_type: 'note', entity_id: noteId, storage_path: path, file_name: file.name.slice(0, 200), mime_type: file.type, size_bytes: file.size });
      if (ins.error) {
        await supabase!.storage.from('attachments').remove([path]);
        throw ins.error;
      }
      await load();
    } catch (e) {
      toast({ title: 'Falha no envio', body: e instanceof Error ? e.message : 'Tipo de arquivo não permitido (imagens, PDF, texto ou áudio).', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const open = async (r: AttachmentRow) => {
    const { data } = await supabase!.storage.from('attachments').createSignedUrl(r.storage_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  };

  const remove = async (r: AttachmentRow) => {
    await supabase!.storage.from('attachments').remove([r.storage_path]);
    await supabase!.from('attachments').delete().eq('id', r.id);
    await load();
  };

  return (
    <div className="mt-6 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <p className="label-tech flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5" /> Anexos</p>
        <label className={cn('cursor-pointer text-xs text-cyan hover:underline', busy && 'opacity-50')}>
          {busy ? 'Enviando…' : '+ anexar arquivo'}
          <input type="file" className="sr-only" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,audio/*" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
        </label>
      </div>
      {rows.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-sm">
              <button onClick={() => open(r)} className="truncate text-left hover:text-cyan cursor-pointer">{r.file_name}</button>
              <span className="text-xs text-muted">{Math.ceil(r.size_bytes / 1024)} KB</span>
              <button onClick={() => remove(r)} className="ml-auto text-muted hover:text-danger cursor-pointer" aria-label={`Remover ${r.file_name}`}><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
