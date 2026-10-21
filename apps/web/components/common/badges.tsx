import { AlertOctagon, AlertTriangle, ArrowDownCircle, CircleDot, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Severity } from "@/lib/types";

const SEVERITY: Record<Severity, { label: string; icon: LucideIcon; className: string }> = {
  low: { label: "Low", icon: ArrowDownCircle, className: "bg-sev-low-bg text-sev-low" },
  medium: { label: "Medium", icon: CircleDot, className: "bg-sev-medium-bg text-sev-medium" },
  high: { label: "High", icon: AlertTriangle, className: "bg-sev-high-bg text-sev-high" },
  critical: { label: "Critical", icon: AlertOctagon, className: "bg-sev-critical-bg text-sev-critical" },
};

const chip = "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap";

/** Severity is shown with colour, icon AND text — never colour alone. */
export function SeverityBadge({ severity, score, className }: { severity: Severity | null | undefined; score?: number | null; className?: string }) {
  if (!severity) return <span className="text-xs text-muted-foreground">Not rated</span>;
  const s = SEVERITY[severity];
  return (
    <span className={cn(chip, s.className, className)}>
      <s.icon className="size-3.5" aria-hidden />
      {s.label}
      {score != null && <span className="font-mono opacity-80">· {score}</span>}
    </span>
  );
}

type Tone = "neutral" | "info" | "ok" | "warn" | "danger" | "muted";

const TONES: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  info: "bg-info-bg text-info",
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-sev-critical-bg text-sev-critical",
  muted: "bg-muted text-muted-foreground border border-dashed",
};

/** Maps every status value used by the API to a tone and a human label. */
const STATUS_TONES: Record<string, Tone> = {
  // review / approval states (spec §14.3)
  draft: "neutral",
  unreviewed: "muted",
  pending: "warn",
  pending_review: "warn",
  submitted: "info",
  under_review: "warn",
  returned_for_clarification: "warn",
  approved: "ok",
  approved_with_conditions: "warn",
  rejected: "danger",
  stale: "muted",
  expired: "danger",
  withdrawn: "muted",
  superseded: "muted",
  final: "ok",
  // test results
  pass: "ok",
  fail: "danger",
  unknown: "muted",
  error: "danger",
  not_applicable: "neutral",
  // implementation
  not_assessed: "muted",
  planned: "neutral",
  in_progress: "info",
  implemented: "ok",
  partially_implemented: "warn",
  retired: "muted",
  // findings / tasks / risks
  open: "danger",
  triaged: "warn",
  in_remediation: "info",
  pending_validation: "warn",
  closed: "ok",
  accepted: "neutral",
  reopened: "danger",
  blocked: "danger",
  completed: "ok",
  cancelled: "muted",
  identified: "warn",
  assessed: "info",
  treatment_planned: "info",
  in_treatment: "info",
  monitoring: "ok",
  // evidence currency
  current: "ok",
  expiring: "warn",
  missing: "danger",
  no_expiry: "neutral",
  // runs
  queued: "neutral",
  running: "info",
  succeeded: "ok",
  failed: "danger",
  partially_succeeded: "warn",
  // integrations
  not_configured: "muted",
  configured: "neutral",
  healthy: "ok",
  degraded: "warn",
  failing: "danger",
  disabled: "muted",
  // generic
  active: "ok",
  suspended: "danger",
  invited: "warn",
  removed: "muted",
};

export function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function StatusBadge({ status, label, className }: { status: string | null | undefined; label?: string; className?: string }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const tone = STATUS_TONES[status] ?? "neutral";
  return <span className={cn(chip, TONES[tone], className)}>{label ?? humanize(status)}</span>;
}

/** Marks illustrative / demo / unreviewed content so it is never mistaken for verified data (spec §1.2). */
export function IllustrativeBadge({ label = "Illustrative" }: { label?: string }) {
  return <span className={cn(chip, TONES.muted)} title="Sample content — not verified organizational evidence or official framework text">{label}</span>;
}
