"use client";

import { Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Chart container with a title, an accessible "view as table" alternative (dataviz a11y rule)
 * and consistent empty handling.
 */
export function ChartCard({
  title,
  description,
  children,
  table,
  empty,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  table: { headers: string[]; rows: Array<Array<ReactNode>> };
  empty?: boolean;
  action?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="flex flex-col rounded-lg border bg-card p-4" aria-label={title}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center gap-1">
          {action}
          {!empty && (
            <Button size="icon-xs" variant="ghost" aria-pressed={asTable} aria-label={asTable ? "Show chart" : "Show as table"} onClick={() => setAsTable((v) => !v)}>
              <Table2 aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {empty ? (
        <p className="flex min-h-40 flex-1 items-center justify-center text-sm text-muted-foreground">No data yet.</p>
      ) : asTable ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                {table.headers.map((h) => (
                  <th key={h} className="py-1.5 pr-3 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className="py-1.5 pr-3">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="min-h-40 flex-1">{children}</div>
      )}
    </section>
  );
}

/** Recharts tooltip in the app's text tokens (values never wear the series colour). */
export function ChartTooltip({ active, payload, label, formatter }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string; dataKey: string }>; label?: string; formatter?: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium text-popover-foreground">{label}</p>}
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={p.dataKey} className="flex items-center gap-2 text-popover-foreground">
            <span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="ml-auto font-medium tabular-nums">{formatter ? formatter(p.value) : p.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatTile({ label, value, sub, href, tone }: { label: string; value: ReactNode; sub?: ReactNode; href?: string; tone?: "danger" | "warn" | "ok" }) {
  const toneClass = tone === "danger" ? "text-sev-critical" : tone === "warn" ? "text-sev-high" : tone === "ok" ? "text-ok" : "";
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </>
  );
  return href ? (
    <a href={href} className="block cursor-pointer rounded-lg border bg-card p-4 transition-colors hover:border-primary">
      {body}
    </a>
  ) : (
    <div className="rounded-lg border bg-card p-4">{body}</div>
  );
}
