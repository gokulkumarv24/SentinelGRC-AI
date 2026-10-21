"use client";

import { useQuery } from "@tanstack/react-query";
import { Play, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { humanize, StatusBadge } from "@/components/common/badges";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { QueryState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";

interface Definition {
  id: string;
  key: string;
  name: string;
  description: string | null;
  triggerType: "schedule" | "event" | "manual";
  eventType: string | null;
  configuration: { intervalHours?: number | null; warnDays?: number; handler?: string };
  enabled: boolean;
  version: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRun: { id: string; status: string; createdAt: string; errorCode: string | null } | null;
  failuresLast7Days: number;
}

const KEY = ["workflows"];

function trigger(d: Definition) {
  if (d.triggerType === "schedule") return `Every ${d.configuration.intervalHours ?? "?"} h`;
  if (d.triggerType === "event") return `On ${d.eventType?.replace(/[._]/g, " ")}`;
  return "Manual";
}

function EditDialog({ def }: { def: Definition }) {
  const [open, setOpen] = useState(false);
  const [interval, setIntervalHours] = useState(String(def.configuration.intervalHours ?? ""));
  const [warn, setWarn] = useState(String(def.configuration.warnDays ?? ""));
  const save = useApiMutation({
    mutationFn: () =>
      api.patch(`/workflows/${def.id}`, {
        version: def.version,
        ...(def.triggerType === "schedule" ? { intervalHours: Number(interval) } : {}),
        ...(def.configuration.warnDays !== undefined ? { warnDays: Number(warn) } : {}),
      }),
    success: "Workflow updated",
    invalidate: [KEY],
    onSuccess: () => setOpen(false),
  });
  if (def.triggerType !== "schedule" && def.configuration.warnDays === undefined) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={`Configure ${def.name}`}><Settings2 /></Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{def.name}</DialogTitle>
          <DialogDescription>Schedules are stored in UTC; times on this page show in your local time zone.</DialogDescription>
        </DialogHeader>
        <form method="post" className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {def.triggerType === "schedule" && (
            <div className="space-y-1">
              <Label htmlFor="interval">Run every (hours)</Label>
              <Input id="interval" type="number" min={1} max={744} required value={interval} onChange={(e) => setIntervalHours(e.target.value)} />
            </div>
          )}
          {def.configuration.warnDays !== undefined && (
            <div className="space-y-1">
              <Label htmlFor="warn">Remind this many days ahead</Label>
              <Input id="warn" type="number" min={0} max={365} required value={warn} onChange={(e) => setWarn(e.target.value)} />
            </div>
          )}
          <DialogFooter><Button type="submit" disabled={save.isPending}>Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function WorkflowsPage() {
  const can = useCan();
  const query = useQuery({ queryKey: KEY, queryFn: () => api.get<Definition[]>("/workflows"), refetchInterval: 15_000 });
  const toggle = useApiMutation({ mutationFn: (d: Definition) => api.patch(`/workflows/${d.id}`, { enabled: !d.enabled, version: d.version }), success: "Workflow updated", invalidate: [KEY] });
  const run = useApiMutation({ mutationFn: (d: Definition) => api.post<{ workflowRunId: string }>(`/workflows/${d.id}/run`), success: "Queued — the worker will run it shortly", invalidate: [KEY, ["workflow-runs"]] });
  return (
    <>
      <PageHeader
        title="Workflows"
        description="Scheduled checks, reminders and event alerts run in the background worker. Each run is recorded with its steps, attempts and outcome."
        crumbs={[{ label: "Automation" }, { label: "Workflows" }]}
        actions={<Button asChild variant="outline"><Link href="/workflows/runs">Runs and failures</Link></Button>}
      />
      <QueryState query={query}>
        {(defs) => (
          <div className="overflow-x-auto rounded-lg border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">Workflow definitions</caption>
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Workflow</th>
                  <th className="px-3 py-2 font-medium">Trigger</th>
                  <th className="px-3 py-2 font-medium">Last run</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Next run</th>
                  <th className="hidden px-3 py-2 font-medium md:table-cell">Failures (7 days)</th>
                  <th className="px-3 py-2 font-medium">Enabled</th>
                  <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {defs.map((d) => (
                  <tr key={d.id} className="align-top">
                    <th scope="row" className="max-w-md px-3 py-2 text-left font-normal">
                      <span className="font-medium">{d.name}</span>
                      <span className="block text-xs text-muted-foreground">{d.description}</span>
                      {d.configuration.warnDays !== undefined && <span className="block text-xs text-muted-foreground">Reminder window: {d.configuration.warnDays} days</span>}
                    </th>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">{trigger(d)}</td>
                    <td className="px-3 py-2">
                      {d.lastRun ? (
                        <Link href={`/workflows/runs/${d.lastRun.id}`} className="inline-flex flex-col gap-1 hover:underline">
                          <StatusBadge status={d.lastRun.status} />
                          <DateText value={d.lastRun.createdAt} relative className="text-xs text-muted-foreground" />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Never run</span>
                      )}
                    </td>
                    <td className="hidden px-3 py-2 text-xs md:table-cell">{d.triggerType === "schedule" && d.enabled ? <DateText value={d.nextRunAt} withTime /> : "—"}</td>
                    <td className="hidden px-3 py-2 md:table-cell">
                      {d.failuresLast7Days ? <Link href={`/workflows/runs?status=failed&workflowDefinitionId=${d.id}`} className="text-sev-critical text-xs font-medium hover:underline">{d.failuresLast7Days} failed</Link> : <span className="text-xs text-muted-foreground">None</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Switch aria-label={`${d.enabled ? "Disable" : "Enable"} ${d.name}`} checked={d.enabled} disabled={!can("workflow.manage") || toggle.isPending} onCheckedChange={() => toggle.mutate(d)} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex justify-end gap-1">
                        {can("workflow.manage") && <EditDialog def={d} />}
                        {can("workflow.run") && d.triggerType !== "event" && (
                          <Button size="xs" variant="outline" disabled={!d.enabled || run.isPending} onClick={() => run.mutate(d)} aria-label={`Run ${d.name} now`}>
                            <Play /> Run now
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryState>
      <p className="mt-3 text-xs text-muted-foreground">
        Event workflows ({humanize("high_finding_alert").toLowerCase()}, questionnaire submissions, AI changes) run automatically when their event occurs. Nothing here deletes data; failed runs can be retried from the run page.
      </p>
    </>
  );
}
