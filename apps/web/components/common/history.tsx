import type { AuditEvent } from "@/lib/types";
import { DateText } from "./date-text";

function summarize(values: Record<string, unknown> | null | undefined): string {
  if (!values) return "";
  return Object.entries(values)
    .slice(0, 6)
    .map(([k, v]) => `${k.replace(/([A-Z])/g, " $1").toLowerCase()}: ${typeof v === "object" ? JSON.stringify(v) : String(v ?? "—")}`)
    .join(" · ");
}

/** Audit-trail timeline for a record's detail page. */
export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">No recorded changes yet.</p>;
  return (
    <ol className="relative space-y-4 border-l pl-4">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
          <p className="text-sm">
            <span className="font-medium">{e.action.replace(/[._]/g, " ")}</span>
            {e.outcome !== "success" && <span className="ml-2 text-xs text-destructive">({e.outcome})</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {(e.actor ?? e.actorUserRef)?.displayName ?? (e.actorType === "system" ? "System" : "Unknown")} · <DateText value={e.timestamp} withTime />
          </p>
          {e.afterSummary && <p className="mt-1 text-xs break-words text-muted-foreground">{summarize(e.afterSummary)}</p>}
          {e.rationale && <p className="mt-1 text-xs italic">“{e.rationale}”</p>}
        </li>
      ))}
    </ol>
  );
}
