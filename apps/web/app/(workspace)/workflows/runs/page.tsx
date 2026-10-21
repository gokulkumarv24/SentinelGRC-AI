"use client";

import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { humanize, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { useListParams } from "@/hooks/use-list-params";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

interface Run {
  id: string;
  status: string;
  triggerSource: string;
  attemptCount: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  nextAttemptAt: string | null;
  errorCode: string | null;
  createdAt: string;
  retryOfRunId: string | null;
  definition: { id: string; key: string; name: string };
}

const columns: Column<Run>[] = [
  { id: "workflow", header: "Workflow", cell: (r) => <span>{r.definition.name}{r.retryOfRunId && <span className="block text-xs text-muted-foreground">Retry of an earlier run</span>}</span> },
  { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  { id: "trigger", header: "Trigger", cell: (r) => humanize(r.triggerSource), hideOnMobile: true },
  {
    id: "attempts",
    header: "Attempts",
    cell: (r) => (
      <span className="text-xs tabular-nums">
        {r.attemptCount}/{r.maxAttempts}
        {r.status === "queued" && r.attemptCount > 0 && r.nextAttemptAt && <span className="block text-muted-foreground">retry <DateText value={r.nextAttemptAt} relative /></span>}
      </span>
    ),
  },
  { id: "error", header: "Error", cell: (r) => (r.errorCode ? <span className="font-mono text-xs">{r.errorCode}</span> : "—"), hideOnMobile: true },
  { id: "created", header: "Queued", sortKey: "createdAt", cell: (r) => <DateText value={r.createdAt} withTime /> },
  { id: "completed", header: "Finished", sortKey: "completedAt", cell: (r) => <DateText value={r.completedAt} withTime />, hideOnMobile: true },
];

function Runs() {
  const [params, setParams] = useListParams({ sort: "createdAt", order: "desc" });
  const query = useQuery({ queryKey: ["workflow-runs", params], queryFn: () => api.get<Page<Run>>("/workflow-runs", params), refetchInterval: 10_000 });
  return (
    <>
      <PageHeader title="Workflow runs" description="Every scheduled, event, manual and retried run with its attempts and outcome. Failed runs can be retried by authorized users." crumbs={[{ label: "Workflows", href: "/workflows" }, { label: "Runs and failures" }]} />
      <FilterBar
        params={params}
        setParams={setParams}
        filters={[
          { key: "status", label: "Status", options: options(["queued", "running", "succeeded", "partially_succeeded", "failed", "cancelled"]) },
          { key: "triggerSource", label: "Trigger", options: options(["schedule", "event", "manual", "retry"]) },
        ]}
      />
      <DataTable caption="Workflow runs" columns={columns} query={query} params={params} setParams={setParams} rowKey={(r) => r.id} rowHref={(r) => `/workflows/runs/${r.id}`} empty={{ title: "No runs match", description: "Runs appear once the worker processes scheduled or triggered workflows." }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Runs />
    </Suspense>
  );
}
