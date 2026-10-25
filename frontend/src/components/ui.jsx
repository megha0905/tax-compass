// Small UI building blocks in the TaxCompass style.
import { LoaderCircle } from "lucide-react";

export const cn = (...c) => c.filter(Boolean).join(" ");

const BTN = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/70",
  outline: "border border-border bg-card hover:bg-secondary",
  ghost: "hover:bg-secondary",
  danger: "bg-destructive text-white hover:opacity-90",
  success: "bg-success text-white hover:opacity-90",
};

export function Button({ variant = "primary", size = "md", busy, className, children, ...props }) {
  const sz = size === "sm" ? "h-8 px-3 text-sm" : size === "lg" ? "h-12 px-6 text-base" : "h-10 px-4 text-sm";
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        BTN[variant], sz, className,
      )}
      disabled={busy || props.disabled}
      {...props}
    >
      {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Input({ className, ...props }) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20 disabled:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }) {
  return (
    <select
      className={cn("h-10 w-full rounded-lg border border-input bg-card px-3 text-sm outline-none focus:border-primary disabled:bg-muted", className)}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }) {
  return (
    <textarea
      className={cn("min-h-24 w-full rounded-lg border border-input bg-card p-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/20", className)}
      {...props}
    />
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function Panel({ title, action, className, children }) {
  return (
    <section className={cn("rounded-2xl border border-border bg-card p-5 shadow-card", className)}>
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const BADGE = {
  muted: "bg-muted text-muted-foreground border-border",
  info: "bg-info-soft text-info border-info/30",
  warning: "bg-warning-soft text-warning-foreground border-warning/40",
  success: "bg-success-soft text-success border-success/40",
  danger: "bg-destructive-soft text-destructive border-destructive/30",
  primary: "bg-secondary text-primary border-primary/30",
};

export function Badge({ variant = "muted", className, children }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", BADGE[variant], className)}>
      {children}
    </span>
  );
}

export function Alert({ variant = "info", title, children }) {
  return (
    <div className={cn("rounded-xl border p-4 text-sm", BADGE[variant])}>
      {title && <p className="mb-1 font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
      <LoaderCircle className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}
