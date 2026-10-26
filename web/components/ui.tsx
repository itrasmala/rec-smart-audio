"use client";
import { Loader2, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- Button
type Variant = "primary" | "secondary" | "ghost" | "danger" | "sodium";
const variants: Record<Variant, string> = {
  primary: "bg-petrol text-white hover:bg-petrol-hover border border-transparent dark:text-[#0b1a20]",
  secondary: "bg-surface text-ink border border-line hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 border border-transparent",
  danger: "bg-fault text-white border border-transparent hover:opacity-90 dark:text-[#2a0d08]",
  sodium: "bg-sodium text-[#2b1a00] border border-transparent hover:brightness-95",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none whitespace-nowrap",
        size === "sm" && "h-8 px-3 text-[13px]",
        size === "md" && "h-10 px-4 text-sm",
        size === "lg" && "h-12 px-5 text-[15px]",
        variants[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- Panel
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("rounded-[10px] border border-line bg-surface", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold leading-6">{title}</h2>}
            {description && <p className="text-[13px] text-ink-3">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Badge / dot
type Tone = "neutral" | "ok" | "fault" | "sodium" | "petrol";
const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2",
  ok: "bg-ok-soft text-ok",
  fault: "bg-fault-soft text-fault",
  sodium: "bg-sodium-soft text-sodium-ink",
  petrol: "bg-petrol-soft text-petrol",
};
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}

export function Dot({ tone, live }: { tone: Tone; live?: boolean }) {
  const c = { neutral: "bg-ink-3", ok: "bg-ok", fault: "bg-fault", sodium: "bg-sodium", petrol: "bg-petrol" }[tone];
  return <span className={cx("inline-block size-2 shrink-0 rounded-full", c, live && "live-dot")} aria-hidden />;
}

// ---------------------------------------------------------------- Form controls
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  children: (id: string) => React.ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {error ? <p className="text-xs text-fault">{error}</p> : hint ? <p className="text-xs text-ink-3">{hint}</p> : null}
    </div>
  );
}

const widthOf = (c?: string) => (c && /(^|\s)(sm:|md:|lg:)?w-/.test(c) ? "" : "w-full");
const inputCls =
  "h-10 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-petrol focus:outline-none focus:ring-2 focus:ring-petrol/20 disabled:opacity-60";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, widthOf(props.className), props.className)} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputCls, widthOf(className), "pe-8", className)}>
      {children}
    </select>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, "w-full h-auto min-h-24 py-2 font-mono text-[13px]", props.className)} />;
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border px-[3px] transition-colors disabled:opacity-50",
        checked ? "justify-end border-petrol bg-petrol" : "justify-start border-line bg-surface-2",
      )}
    >
      <span
        className="inline-block size-4 rounded-full bg-white shadow-sm"
      />
    </button>
  );
}

export function VolumeSlider({
  value,
  onChange,
  onCommit,
  max = 100,
  disabled,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  max?: number;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(Math.min(max, Number(e.target.value)))}
        onPointerUp={(e) => onCommit?.(Math.min(max, Number((e.target as HTMLInputElement).value)))}
        onKeyUp={(e) => onCommit?.(Math.min(max, Number((e.target as HTMLInputElement).value)))}
        className="h-2 w-full cursor-pointer"
      />
      <span className="tnum w-10 text-end text-sm font-medium">{value}%</span>
    </div>
  );
}

// ---------------------------------------------------------------- Modal
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-[#0b141a]/55",
        wide ? "max-w-3xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h3 className="text-base font-semibold">{title}</h3>
            <button onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-surface-2" aria-label="close">
              <X className="size-5" />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- Toasts + confirm
type ToastItem = { id: number; tone: "ok" | "fault" | "neutral"; text: string };
const ToastCtx = createContext<{
  toast: (text: string, tone?: ToastItem["tone"]) => void;
  confirm: (o: { title: string; body?: string; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
} | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [dlg, setDlg] = useState<null | { title: string; body?: string; confirmLabel?: string; danger?: boolean; resolve: (v: boolean) => void }>(null);
  const { t } = usePrefs();

  const toast = useCallback((text: string, tone: ToastItem["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, tone, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === "fault" ? 7000 : 3500);
  }, []);
  const confirm = useCallback(
    (o: { title: string; body?: string; confirmLabel?: string; danger?: boolean }) =>
      new Promise<boolean>((resolve) => setDlg({ ...o, resolve })),
    [],
  );
  const close = (v: boolean) => {
    dlg?.resolve(v);
    setDlg(null);
  };

  return (
    <ToastCtx.Provider value={{ toast, confirm }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {items.map((i) => (
          <div
            key={i.id}
            className={cx(
              "pointer-events-auto max-w-md rounded-lg border px-4 py-2.5 text-sm shadow-lg",
              i.tone === "ok" && "border-ok/30 bg-surface text-ink",
              i.tone === "fault" && "border-fault/40 bg-fault-soft text-fault",
              i.tone === "neutral" && "border-line bg-surface text-ink",
            )}
          >
            {i.text}
          </div>
        ))}
      </div>
      <Modal
        open={!!dlg}
        onClose={() => close(false)}
        title={dlg?.title ?? ""}
        footer={
          <>
            <Button onClick={() => close(false)}>{t("إلغاء", "Cancel")}</Button>
            <Button variant={dlg?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
              {dlg?.confirmLabel ?? t("تأكيد", "Confirm")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-2">{dlg?.body}</p>
      </Modal>
    </ToastCtx.Provider>
  );
}

export function useFeedback() {
  const v = useContext(ToastCtx);
  if (!v) throw new Error("FeedbackProvider missing");
  return v;
}

// ---------------------------------------------------------------- misc
export function Empty({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <p className="font-medium">{title}</p>
      {body && <p className="max-w-sm text-sm text-ink-3">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx("size-5 animate-spin text-ink-3", className)} />;
}

export function Loading() {
  return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  );
}

export function ErrorNote({ error }: { error: { message: string } | null }) {
  if (!error) return null;
  return <div className="rounded-lg border border-fault/30 bg-fault-soft px-4 py-3 text-sm text-fault">{error.message}</div>;
}
