"use client";

import { useQuery } from "@tanstack/react-query";
import { LayoutGrid, List, Plus } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { SeverityBadge, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DueDate } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { ErrorState, LoadingState } from "@/components/common/states";
import { TaskFormDialog } from "@/components/remediation/task-form";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page, RemediationTask } from "@/lib/types";

const COLUMNS = ["open", "in_progress", "blocked", "completed"] as const;

const tableColumns: Column<RemediationTask>[] = [
  { id: "title", header: "Task", cell: (t) => t.title },
  { id: "finding", header: "Finding", cell: (t) => (t.finding ? <span className="font-mono text-xs">{t.finding.findingKey}</span> : "—"), hideOnMobile: true },
  { id: "priority", header: "Priority", sortKey: "priority", cell: (t) => <StatusBadge status={t.priority} /> },
  { id: "owner", header: "Owner", cell: (t) => t.owner?.displayName ?? <span className="text-muted-foreground">Unassigned</span> },
  { id: "due", header: "Due", sortKey: "dueDate", cell: (t) => <DueDate value={t.dueDate} done={t.status === "completed" || t.status === "cancelled"} /> },
  { id: "status", header: "Status", cell: (t) => <StatusBadge status={t.status} /> },
];

function Board({ params }: { params: Record<string, unknown> }) {
  const query = useQuery({
    queryKey: ["remediation", "board", params],
    queryFn: () => api.get<Page<RemediationTask>>("/remediation-tasks", { ...(params as Record<string, string>), view: undefined, pageSize: 100, sort: "dueDate", order: "asc", status: "open,in_progress,blocked,completed" }),
  });
  if (query.isPending) return <LoadingState rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((status) => {
        const tasks = query.data.items.filter((t) => t.status === status);
        return (
          <section key={status} aria-label={status.replace(/_/g, " ")} className="rounded-lg border bg-muted/40 p-2">
            <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
              <StatusBadge status={status} /> <span className="text-xs text-muted-foreground">{tasks.length}</span>
            </h2>
            <ul className="space-y-2">
              {tasks.length === 0 && <li className="px-1 py-4 text-center text-xs text-muted-foreground">No tasks</li>}
              {tasks.map((t) => (
                <li key={t.id}>
                  <Link href={`/remediation/${t.id}`} className="block cursor-pointer rounded-md border bg-card p-2.5 transition-colors hover:border-primary">
                    <p className="text-sm font-medium">{t.title}</p>
                    {t.finding && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="font-mono">{t.finding.findingKey}</span> <SeverityBadge severity={t.finding.severity} />
                      </p>
                    )}
                    <p className="mt-1.5 flex items-center justify-between text-xs">
                      <span>{t.owner?.displayName ?? "Unassigned"}</span>
                      <DueDate value={t.dueDate} done={t.status === "completed"} />
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function Remediation() {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "dueDate", order: "asc" });
  const view = (params.view as string) ?? "board";
  const listQuery = useQuery({ queryKey: ["remediation", params], queryFn: () => api.get<Page<RemediationTask>>("/remediation-tasks", { ...params, view: undefined }), enabled: view === "list" });
  return (
    <>
      <PageHeader
        title="Remediation"
        description="Corrective actions for findings. Completing the last task sends the finding to validation; it never closes automatically."
        crumbs={[{ label: "Risk Management" }, { label: "Remediation" }]}
        actions={
          <>
            <div role="group" aria-label="View" className="flex rounded-md border p-0.5">
              <Button size="sm" variant={view === "board" ? "secondary" : "ghost"} aria-pressed={view === "board"} onClick={() => setParams({ view: undefined })}>
                <LayoutGrid aria-hidden /> Board
              </Button>
              <Button size="sm" variant={view === "list" ? "secondary" : "ghost"} aria-pressed={view === "list"} onClick={() => setParams({ view: "list" })}>
                <List aria-hidden /> List
              </Button>
            </div>
            {can("remediation.create") && <TaskFormDialog trigger={<Button><Plus aria-hidden /> New task</Button>} />}
          </>
        }
      />
      <FilterBar
        params={params}
        setParams={setParams}
        searchPlaceholder="Search tasks"
        filters={[
          ...(view === "list" ? [{ key: "status", label: "Status", options: options(["open", "in_progress", "blocked", "completed", "cancelled"]) }] : []),
          { key: "priority", label: "Priority", options: options(["low", "medium", "high", "urgent"]) },
          { key: "overdue", label: "Due", options: [{ value: "true", label: "Overdue only" }] },
        ]}
      />
      {view === "board" ? (
        <Board params={params} />
      ) : (
        <DataTable caption="Remediation tasks" columns={tableColumns} query={listQuery} params={params} setParams={setParams} rowKey={(t) => t.id} rowHref={(t) => `/remediation/${t.id}`} empty={{ title: "No remediation tasks", description: "Create tasks from findings to track corrective action." }} />
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Remediation />
    </Suspense>
  );
}
