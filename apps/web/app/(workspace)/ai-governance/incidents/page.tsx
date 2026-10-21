"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Suspense, useState } from "react";
import { humanize, SeverityBadge, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page, Severity } from "@/lib/types";

interface Row {
  id: string;
  title: string;
  severity: Severity;
  description: string;
  status: "open" | "investigating" | "mitigated" | "resolved" | "closed";
  detectedAt: string;
  impact: string | null;
  rootCause: string | null;
  responseActions: string | null;
  lessonsLearned: string | null;
  findingId: string | null;
  aiSystem: { id: string; name: string };
}

const NEXT: Record<Row["status"], Row["status"][]> = { open: ["investigating", "mitigated", "resolved"], investigating: ["mitigated", "resolved"], mitigated: ["resolved", "investigating"], resolved: ["closed", "investigating"], closed: [] };

function UpdateIncident({ incident }: { incident: Row }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ status: incident.status, impact: incident.impact ?? "", rootCause: incident.rootCause ?? "", responseActions: incident.responseActions ?? "", lessonsLearned: incident.lessonsLearned ?? "" });
  const save = useApiMutation({ mutationFn: () => api.patch(`/ai-incidents/${incident.id}`, Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === "" ? null : v]))), success: "Incident updated", invalidate: [["ai-incidents"], ["ai-systems"]], onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="xs" variant="outline">Update</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{incident.title}</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="st">Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as Row["status"] })}>
            <SelectTrigger id="st" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{[incident.status, ...NEXT[incident.status]].map((s) => <SelectItem key={s} value={s}>{humanize(s)}</SelectItem>)}</SelectContent>
          </Select>
          {(["impact", "rootCause", "responseActions", "lessonsLearned"] as const).map((k) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={k}>{humanize(k.replace(/([A-Z])/g, "_$1").toLowerCase())}</Label>
              <Textarea id={k} rows={2} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Root cause is required to resolve; lessons learned are required to close.</p>
        </div>
        <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Incidents() {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "detectedAt", order: "desc" });
  const query = useQuery({ queryKey: ["ai-incidents", params], queryFn: () => api.get<Page<Row>>("/ai-incidents", params) });
  const columns: Column<Row>[] = [
    { id: "title", header: "Incident", cell: (r) => <span>{r.title}<span className="block text-xs text-muted-foreground">{r.description}</span></span> },
    { id: "system", header: "AI system", cell: (r) => <Link href={`/ai-governance/${r.aiSystem.id}`} className="text-primary hover:underline">{r.aiSystem.name}</Link> },
    { id: "sev", header: "Severity", cell: (r) => <SeverityBadge severity={r.severity} /> },
    { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status === "open" ? "open" : r.status === "closed" ? "closed" : r.status === "resolved" ? "completed" : "in_progress"} label={humanize(r.status)} /> },
    { id: "detected", header: "Detected", sortKey: "detectedAt", cell: (r) => <DateText value={r.detectedAt} withTime /> },
    { id: "actions", header: "", cell: (r) => <span className="flex gap-1">{r.findingId && <Link href={`/findings/${r.findingId}`} className="text-xs text-primary hover:underline">Finding</Link>}{can("ai_incident.manage") && r.status !== "closed" && <UpdateIncident incident={r} />}</span> },
  ];
  return (
    <>
      <PageHeader title="AI incidents" description="Incidents, impact, root cause, response and lessons learned. Report new incidents from the AI system's page." crumbs={[{ label: "AI Governance" }, { label: "Incidents" }]} />
      <FilterBar params={params} setParams={setParams} filters={[{ key: "status", label: "Status", options: options(["open", "investigating", "mitigated", "resolved", "closed"]) }, { key: "severity", label: "Severity", options: options(["low", "medium", "high", "critical"]) }]} />
      <DataTable caption="AI incidents" columns={columns} query={query} params={params} setParams={setParams} rowKey={(r) => r.id} empty={{ title: "No AI incidents recorded" }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Incidents />
    </Suspense>
  );
}
