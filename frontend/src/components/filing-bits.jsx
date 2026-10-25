import { AlertTriangle, BadgeCheck, Check, Info, ShieldAlert } from "lucide-react";
import { Badge, cn } from "./ui";
import { formatDate, titleCase } from "../format";

const STATUS = {
  DRAFT: { label: "Draft", variant: "muted" },
  AI_VALIDATED: { label: "Computed", variant: "info" },
  PENDING_REVIEW: { label: "Pending CA review", variant: "warning" },
  CHANGES_REQUESTED: { label: "Changes requested", variant: "danger" },
  READY_TO_FILE: { label: "Ready to File", variant: "success" },
  REJECTED: { label: "Rejected", variant: "danger" },
};

export function StatusBadge({ status }) {
  const s = STATUS[status] ?? STATUS.DRAFT;
  return (
    <Badge variant={s.variant}>
      {status === "READY_TO_FILE" && <BadgeCheck className="h-3.5 w-3.5" />}
      {s.label}
    </Badge>
  );
}

export function stageOf(filing, incomes = []) {
  if (!filing?.view_plan) return 0;
  const st = filing.status;
  if (["PENDING_REVIEW", "READY_TO_FILE", "REJECTED"].includes(st)) return st === "READY_TO_FILE" ? 4 : 3;
  if (st === "AI_VALIDATED") return 2;
  return incomes.length ? 1 : 1;
}

export function Stepper({ current }) {
  const steps = ["Intake", "Details", "Result", "CA review"];
  return (
    <ol className="flex items-center gap-2">
      {steps.map((s, i) => (
        <li key={s} className="flex flex-1 items-center gap-2">
          <span
            className={cn(
              "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
              i < current && "border-primary bg-primary text-primary-foreground",
              i === current && "border-primary text-primary",
              i > current && "border-border text-muted-foreground",
            )}
          >
            {i < current ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={cn("hidden text-sm sm:inline", i === current ? "font-medium" : "text-muted-foreground")}>{s}</span>
          {i < steps.length - 1 && <span className={cn("h-px flex-1", i < current ? "bg-primary" : "bg-border")} />}
        </li>
      ))}
    </ol>
  );
}

const FLAG_STYLE = {
  critical: { cls: "border-destructive/30 bg-destructive-soft text-destructive", Icon: ShieldAlert },
  warning: { cls: "border-warning/40 bg-warning-soft text-warning-foreground", Icon: AlertTriangle },
  info: { cls: "border-info/30 bg-info-soft text-info", Icon: Info },
};

export function FlagChips({ flags = [] }) {
  if (!flags.length) return <p className="text-sm text-muted-foreground">No flags — nothing unusual found.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {flags.map((f) => {
        const { cls, Icon } = FLAG_STYLE[f.severity] ?? FLAG_STYLE.warning;
        return (
          <span key={f.code} className={cn("inline-flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs", cls)}>
            <Icon className="mt-px h-3.5 w-3.5 shrink-0" /> {f.message}
          </span>
        );
      })}
    </div>
  );
}

export function AuditTimeline({ rows = [] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {[...rows].reverse().map((r) => (
        <li key={r.log_id} className="relative">
          <span className="absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
          <p className="text-sm font-medium">{titleCase(r.action)}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(r.created_at)} · {r.actor_name ?? "system"}{r.actor_role === "reviewer" ? " (CA)" : ""}
          </p>
          {r.details && Object.keys(r.details).length > 0 && (
            <p className="num mt-1 break-all text-xs text-muted-foreground">{JSON.stringify(r.details)}</p>
          )}
        </li>
      ))}
    </ol>
  );
}
