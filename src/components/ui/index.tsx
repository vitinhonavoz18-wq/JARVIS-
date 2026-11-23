import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import * as RDialog from '@radix-ui/react-dialog';
import * as RSwitch from '@radix-ui/react-switch';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/lib/cn.ts';

type BtnVariant = 'primary' | 'ghost' | 'outline' | 'danger' | 'soft';
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: 'sm' | 'md' | 'icon'; loading?: boolean }>(
  ({ className, variant = 'primary', size = 'md', loading, children, disabled, ...p }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 select-none disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] cursor-pointer',
        size === 'sm' && 'h-8 px-3 text-sm',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'icon' && 'h-10 w-10',
        variant === 'primary' && 'bg-gradient-to-r from-tech to-cyan text-void shadow-[0_0_24px_-6px_rgb(0_217_255/0.6)] hover:shadow-[0_0_32px_-4px_rgb(0_217_255/0.8)] hover:brightness-110',
        variant === 'ghost' && 'text-muted hover:text-ink hover:bg-white/5',
        variant === 'outline' && 'border border-line text-ink hover:border-cyan/50 hover:bg-cyan/5',
        variant === 'soft' && 'bg-cyan/10 text-cyan hover:bg-cyan/15',
        variant === 'danger' && 'bg-danger/15 text-danger hover:bg-danger/25',
        className,
      )}
      {...p}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

export function Card({ className, children, interactive, ...p }: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div className={cn('glass rounded-2xl', interactive && 'glow-border transition-transform duration-300 hover:-translate-y-0.5', className)} {...p}>
      {children}
    </div>
  );
}

export function CardHeader({ title, icon, action, subtitle }: { title: ReactNode; icon?: ReactNode; action?: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
      <div className="flex items-center gap-2.5 min-w-0">
        {icon && <span className="text-cyan shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h2 className="label-tech !text-[0.7rem] !text-ink/80">{title}</h2>
          {subtitle && <p className="text-xs text-muted mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    className={cn('h-10 w-full rounded-xl bg-void/60 border border-line px-3 text-sm text-ink placeholder:text-muted/70 focus:border-cyan/60 focus:outline-none focus:ring-2 focus:ring-cyan/20 transition', className)}
    {...p}
  />
));
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(({ className, ...p }, ref) => (
  <textarea
    ref={ref}
    className={cn('w-full rounded-xl bg-void/60 border border-line px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-cyan/60 focus:outline-none focus:ring-2 focus:ring-cyan/20 transition resize-y', className)}
    {...p}
  />
));
Textarea.displayName = 'Textarea';

export function Select({ className, children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn('h-10 w-full rounded-xl bg-void/60 border border-line px-3 text-sm text-ink focus:border-cyan/60 focus:outline-none', className)} {...p}>
      {children}
    </select>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted/80">{hint}</span>}
    </label>
  );
}

export function Badge({ className, tone = 'default', children }: { className?: string; tone?: 'default' | 'cyan' | 'violet' | 'success' | 'warn' | 'danger'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-medium border',
        tone === 'default' && 'border-line text-muted',
        tone === 'cyan' && 'border-cyan/30 text-cyan bg-cyan/5',
        tone === 'violet' && 'border-violet/30 text-violet bg-violet/5',
        tone === 'success' && 'border-success/30 text-success bg-success/5',
        tone === 'warn' && 'border-warn/30 text-warn bg-warn/5',
        tone === 'danger' && 'border-danger/30 text-danger bg-danger/5',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Switch({ checked, onCheckedChange, label, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className="relative h-6 w-11 shrink-0 rounded-full bg-graphite border border-line data-[state=checked]:bg-cyan/30 data-[state=checked]:border-cyan/50 transition disabled:opacity-40 cursor-pointer"
    >
      <RSwitch.Thumb className="block h-4.5 w-4.5 translate-x-0.5 rounded-full bg-muted transition data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-cyan data-[state=checked]:shadow-[0_0_12px_rgb(0_217_255/0.8)]" />
    </RSwitch.Root>
  );
}

export function Dialog({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-overlay bg-void/80" />
        <RDialog.Content
          className={cn(
            'glass-overlay fixed z-modal left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-2rem)] max-h-[85dvh] overflow-y-auto overscroll-contain scroll-thin rounded-2xl p-5 shadow-2xl shadow-black/50',
            wide ? 'max-w-2xl' : 'max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <RDialog.Title className="font-display text-lg font-semibold">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Fechar">
                <X className="h-4 w-4" />
              </Button>
            </RDialog.Close>
          </div>
          {children}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-10">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-cyan/10 text-cyan shadow-[0_0_30px_-8px_rgb(0_217_255/0.6)]">{icon}</div>
      <p className="font-display font-medium">{title}</p>
      <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-5 w-5 animate-spin text-cyan', className)} aria-label="Carregando" />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-4 md:mb-7 md:pb-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-prose text-sm leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Segmented<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('inline-flex flex-wrap gap-1 rounded-xl bg-void/50 border border-line p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          tabIndex={value === o.value ? 0 : -1}
          onKeyDown={(event) => {
            const tabs = Array.from(event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
            const index = tabs.indexOf(event.currentTarget);
            const target = {
              ArrowRight: (index + 1) % tabs.length,
              ArrowLeft: (index + tabs.length - 1) % tabs.length,
              Home: 0,
              End: tabs.length - 1,
            }[event.key];
            if (target === undefined) return;
            event.preventDefault();
            tabs[target].focus();
            tabs[target].click();
          }}
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn('rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer', value === o.value ? 'bg-cyan/15 text-cyan shadow-[inset_0_0_0_1px_rgb(0_217_255/0.3)]' : 'text-muted hover:text-ink')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
