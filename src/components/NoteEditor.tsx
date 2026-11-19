import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect } from 'react';
import { Bold, Italic, Heading1, Heading2, List, ListOrdered, Quote, Code } from 'lucide-react';
import { cn } from '@/lib/cn.ts';

export function NoteEditor({ html, onChange, appendRef }: { html: string; onChange: (html: string, text: string) => void; appendRef?: { current: ((text: string) => void) | null } }) {
  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: 'Escreva seus pensamentos, ideias e decisões…' })],
    content: html,
    onUpdate: ({ editor: e }) => onChange(e.getHTML(), e.getText()),
    editorProps: { attributes: { 'aria-label': 'Conteúdo da anotação' } },
  });

  useEffect(() => {
    if (!appendRef) return;
    appendRef.current = (text: string) => editor?.chain().focus('end').insertContent(`<p>${text.replace(/</g, '&lt;')}</p>`).run();
    return () => {
      appendRef.current = null;
    };
  }, [editor, appendRef]);

  if (!editor) return null;
  const B = ({ on, active, label, children }: { on: () => void; active?: boolean; label: string; children: React.ReactNode }) => (
    <button type="button" onClick={on} aria-label={label} aria-pressed={active} className={cn('grid h-8 w-8 place-items-center rounded-lg cursor-pointer', active ? 'bg-cyan/15 text-cyan' : 'text-muted hover:text-ink hover:bg-white/5')}>
      {children}
    </button>
  );
  return (
    <div>
      <div className="sticky top-0 z-10 mb-3 flex flex-wrap gap-1 rounded-xl border border-line bg-void/80 p-1 backdrop-blur">
        <B label="Negrito" on={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}><Bold className="h-4 w-4" /></B>
        <B label="Itálico" on={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}><Italic className="h-4 w-4" /></B>
        <B label="Título" on={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })}><Heading1 className="h-4 w-4" /></B>
        <B label="Subtítulo" on={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}><Heading2 className="h-4 w-4" /></B>
        <B label="Lista" on={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')}><List className="h-4 w-4" /></B>
        <B label="Lista numerada" on={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')}><ListOrdered className="h-4 w-4" /></B>
        <B label="Citação" on={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')}><Quote className="h-4 w-4" /></B>
        <B label="Código" on={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')}><Code className="h-4 w-4" /></B>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
