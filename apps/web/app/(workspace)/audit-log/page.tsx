"use client";

import { useQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useListParams } from "@/hooks/use-list-params";
import { api } from "@/lib/api";
import type { AuditEvent, Page } from "@/lib/types";

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <p className="text-xs text-muted-foreground">—</p>;
  return <pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">{JSON.stringify(value, null, 2)}</pre>;
}

function AuditLog() {
  const [params, setParams] = useListParams({ sort: "timestamp", order: "desc" });
  const [selected, setSelected] = useState<AuditEvent | null>(null);
  const query = useQuery({ queryKey: ["audit", params], queryFn: () => api.get<Page<AuditEvent>>("/audit-events", params) });
  const columns: Column<AuditEvent>[] = [
    { id: "time", header: "Time", sortKey: "timestamp", cell: (e) => <DateText value={e.timestamp} withTime /> },
    { id: "action", header: "Action", cell: (e) => <span className="font-mono text-xs">{e.action}</span> },
    { id: "entity", header: "Record", cell: (e) => <span className="text-xs">{e.entityType}{e.entityId && <span className="block font-mono text-muted-foreground">{e.entityId.slice(0, 8)}…</span>}</span>, hideOnMobile: true },
    { id: "actor", header: "Actor", cell: (e) => e.actor?.displayName ?? (e.actorType === "system" ? "System" : e.actorType) },
    { id: "outcome", header: "Outcome", cell: (e) => <StatusBadge status={e.outcome === "success" ? "succeeded" : e.outcome === "denied" ? "rejected" : "failed"} label={e.outcome} /> },
    { id: "detail", header: "", cell: (e) => <Button size="xs" variant="ghost" onClick={() => setSelected(e)}>Details</Button> },
  ];
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Security-relevant and business-significant events for this organization. The log is append-only: the database rejects updates and deletions."
        crumbs={[{ label: "Audit log" }]}
      />
      <FilterBar
        params={params}
        setParams={setParams}
        searchPlaceholder="Search action or record type"
        filters={[
          { key: "outcome", label: "Outcome", options: options(["success", "denied", "failure"]) },
          { key: "entityType", label: "Record type", options: options(["risk", "finding", "control", "evidence", "remediation_task", "membership", "session", "user", "vendor", "vendor_assessment", "ai_system", "ai_assessment", "workflow_run", "report", "route"]) },
        ]}
      >
        <div className="flex items-center gap-2">
          <Label htmlFor="from" className="text-xs text-muted-foreground">From</Label>
          <Input id="from" type="date" className="h-9 w-36" value={(params.from as string)?.slice(0, 10) ?? ""} onChange={(e) => setParams({ from: e.target.value ? `${e.target.value}T00:00:00Z` : undefined })} />
          <Label htmlFor="to" className="text-xs text-muted-foreground">To</Label>
          <Input id="to" type="date" className="h-9 w-36" value={(params.to as string)?.slice(0, 10) ?? ""} onChange={(e) => setParams({ to: e.target.value ? `${e.target.value}T23:59:59Z` : undefined })} />
        </div>
      </FilterBar>
      <DataTable caption="Audit events" columns={columns} query={query} params={params} setParams={setParams} rowKey={(e) => e.id} empty={{ title: "No events" }} />
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono text-base">{selected.action}</SheetTitle>
                <SheetDescription>
                  <DateText value={selected.timestamp} withTime /> · {selected.actor?.displayName ?? selected.actorType}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6 text-sm">
                <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-xs">
                  <dt className="text-muted-foreground">Record</dt>
                  <dd className="font-mono break-all">{selected.entityType} {selected.entityId}</dd>
                  <dt className="text-muted-foreground">Outcome</dt>
                  <dd>{selected.outcome}</dd>
                  <dt className="text-muted-foreground">Request ID</dt>
                  <dd className="font-mono break-all">{selected.requestId ?? "—"}</dd>
                  <dt className="text-muted-foreground">Source IP</dt>
                  <dd>{selected.sourceIp ?? "—"}</dd>
                </dl>
                {selected.rationale && (
                  <div>
                    <p className="text-xs font-medium">Rationale</p>
                    <p className="text-sm italic">“{selected.rationale}”</p>
                  </div>
                )}
                <div>
                  <p className="mb-1 text-xs font-medium">Before</p>
                  <JsonBlock value={selected.beforeSummary} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-medium">After</p>
                  <JsonBlock value={selected.afterSummary} />
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AuditLog />
    </Suspense>
  );
}
