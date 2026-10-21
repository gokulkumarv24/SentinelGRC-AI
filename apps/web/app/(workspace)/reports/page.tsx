"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Download, FileBarChart, Plus, Sparkles, Trash2 } from "lucide-react";
import { Suspense, useState } from "react";
import { AiAssist } from "@/components/ai/ai-assist";
import { humanize, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader, Section } from "@/components/common/page-header";
import { RecordPicker, type PickerOption } from "@/components/common/record-picker";
import { QueryState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListParams } from "@/hooks/use-list-params";
import { useCan, useDirectory } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

type FilterKey = "from" | "to" | "frameworkId" | "vendorId" | "assessmentId" | "aiSystemId";
interface ReportType {
  key: string;
  title: string;
  description: string;
  filters: FilterKey[];
  requiredFilters?: FilterKey[];
  periodic?: boolean;
  allowed: boolean;
}
interface ReportRun {
  id: string;
  reportType: string;
  format: "pdf" | "csv" | "xlsx";
  title: string;
  reportStatus: "draft" | "final";
  status: "queued" | "generating" | "ready" | "failed" | "expired";
  errorCode: string | null;
  generatedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
  scheduleId: string | null;
  generatedByName: string | null;
  canDownload: boolean;
}
interface Schedule {
  id: string;
  reportType: string;
  format: string;
  frequency: "daily" | "weekly" | "monthly";
  recipientUserIds: string[];
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
}

const FORMATS = [
  { value: "pdf", label: "PDF" },
  { value: "csv", label: "CSV" },
  { value: "xlsx", label: "Excel" },
];
const RUN_STATUS: Record<ReportRun["status"], string> = { queued: "queued", generating: "running", ready: "succeeded", failed: "failed", expired: "expired" };

const frameworkOption = (f: { id: string; name: string; version: string }): PickerOption => ({ id: f.id, label: `${f.name} ${f.version}` });
const assessmentOption = (a: { id: string; assessmentVersion: number; status: string; vendor: { name: string } }): PickerOption => ({ id: a.id, label: `${a.vendor.name} v${a.assessmentVersion}`, sublabel: humanize(a.status) });
const aiOption = (s: { id: string; name: string }): PickerOption => ({ id: s.id, label: s.name });

function useTypes() {
  return useQuery({ queryKey: ["reports", "types"], queryFn: () => api.get<ReportType[]>("/reports/types"), staleTime: 300_000 });
}

function FilterFields({ type, value, onChange }: { type: ReportType; value: Record<string, PickerOption | string | null>; onChange: (k: FilterKey, v: PickerOption | string | null) => void }) {
  const required = (k: FilterKey) => type.requiredFilters?.includes(k);
  return (
    <>
      {type.periodic && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label htmlFor="from">From</Label>
            <Input id="from" type="date" value={(value.from as string) ?? ""} onChange={(e) => onChange("from", e.target.value || null)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="to">To</Label>
            <Input id="to" type="date" value={(value.to as string) ?? ""} onChange={(e) => onChange("to", e.target.value || null)} />
          </div>
          <p className="col-span-2 text-xs text-muted-foreground">Leave empty for the last 30 days.</p>
        </div>
      )}
      {type.filters.includes("frameworkId") && (
        <div className="space-y-1">
          <Label>Framework (optional)</Label>
          <FrameworkSelect value={(value.frameworkId as string) ?? null} onChange={(v) => onChange("frameworkId", v)} />
        </div>
      )}
      {type.filters.includes("assessmentId") && (
        <div className="space-y-1">
          <Label>Vendor assessment{required("assessmentId") ? "" : " (optional)"}</Label>
          <RecordPicker endpoint="/assessments" toOption={assessmentOption} value={(value.assessmentId as PickerOption) ?? null} onChange={(o) => onChange("assessmentId", o)} placeholder="Choose an assessment" />
        </div>
      )}
      {type.filters.includes("aiSystemId") && (
        <div className="space-y-1">
          <Label>AI system (optional)</Label>
          <RecordPicker endpoint="/ai-systems" toOption={aiOption} value={(value.aiSystemId as PickerOption) ?? null} onChange={(o) => onChange("aiSystemId", o)} placeholder="All AI systems" />
        </div>
      )}
    </>
  );
}

function FrameworkSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const q = useQuery({ queryKey: ["frameworks"], queryFn: () => api.get<Array<{ id: string; name: string; version: string }>>("/frameworks") });
  return (
    <Select value={value ?? "__all"} onValueChange={(v) => onChange(v === "__all" ? null : v)}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">All frameworks in scope</SelectItem>
        {q.data?.map((f) => <SelectItem key={f.id} value={f.id}>{frameworkOption(f).label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function toFilters(type: ReportType, value: Record<string, PickerOption | string | null>) {
  const out: Record<string, string> = {};
  for (const k of type.filters) {
    const v = value[k];
    if (!v) continue;
    out[k] = typeof v === "string" ? v : v.id;
  }
  return out;
}

function GenerateForm({ types }: { types: ReportType[] }) {
  const allowed = types.filter((t) => t.allowed);
  const [typeKey, setTypeKey] = useState(allowed[0]?.key ?? "");
  const [format, setFormat] = useState("pdf");
  const [status, setStatus] = useState<"draft" | "final">("draft");
  const [title, setTitle] = useState("");
  const [filters, setFilters] = useState<Record<string, PickerOption | string | null>>({});
  const type = allowed.find((t) => t.key === typeKey);
  const generate = useApiMutation({
    mutationFn: () => api.post<ReportRun>("/reports", { reportType: typeKey, format, reportStatus: status, title: title || undefined, filters: type ? toFilters(type, filters) : {} }),
    success: "Report queued — it will appear below when ready",
    invalidate: [["reports", "runs"]],
    onSuccess: () => setTitle(""),
  });
  if (!type) return <p className="text-sm text-muted-foreground">Your role cannot generate any report type.</p>;
  const missing = (type.requiredFilters ?? []).some((k) => !filters[k]);
  return (
    <form method="post" className="space-y-3" onSubmit={(e) => { e.preventDefault(); generate.mutate(); }}>
      <div className="space-y-1">
        <Label htmlFor="type">Report</Label>
        <Select value={typeKey} onValueChange={(v) => { setTypeKey(v); setFilters({}); }}>
          <SelectTrigger id="type" className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>{allowed.map((t) => <SelectItem key={t.key} value={t.key}>{t.title}</SelectItem>)}</SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{type.description}</p>
      </div>
      <FilterFields type={type} value={filters} onChange={(k, v) => setFilters({ ...filters, [k]: v })} />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="format">Format</Label>
          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger id="format" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="status">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as "draft" | "final")}>
            <SelectTrigger id="status" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="final">Final</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="title">Title (optional)</Label>
        <Input id="title" maxLength={200} value={title} placeholder={type.title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={missing || generate.isPending}><FileBarChart /> Generate</Button>
      <p className="text-xs text-muted-foreground">Reports are generated in the background from current records and include the generation time, filters, definitions and a source appendix. They are not audit opinions or attestations.</p>
    </form>
  );
}

function NarrativeDialog({ run }: { run: ReportRun }) {
  return (
    <Dialog>
      <DialogTrigger asChild><Button size="icon-xs" variant="ghost" aria-label={`Draft a narrative for ${run.title}`}><Sparkles /></Button></DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Management narrative</DialogTitle>
          <DialogDescription>An AI draft built only from this report&apos;s verified metrics. Review it before using it anywhere.</DialogDescription>
        </DialogHeader>
        <AiAssist artifactType="report_draft" targetId={run.id} title="Narrative draft" />
      </DialogContent>
    </Dialog>
  );
}

function History({ types }: { types: ReportType[] }) {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "createdAt", order: "desc" });
  const query = useQuery({
    queryKey: ["reports", "runs", params],
    queryFn: () => api.get<Page<ReportRun>>("/reports", params),
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === "queued" || r.status === "generating") ? 4_000 : false),
  });
  const titleOf = (key: string) => types.find((t) => t.key === key)?.title ?? humanize(key);
  const columns: Column<ReportRun>[] = [
    {
      id: "title",
      header: "Report",
      cell: (r) => (
        <span>
          {r.title}
          <span className="block text-xs text-muted-foreground">
            {[r.title !== titleOf(r.reportType) && titleOf(r.reportType), r.format.toUpperCase(), r.scheduleId && "scheduled"].filter(Boolean).join(" · ")}
          </span>
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusBadge status={RUN_STATUS[r.status]} label={humanize(r.status)} />
          <StatusBadge status={r.reportStatus === "final" ? "final" : "draft"} />
          {r.errorCode && <span className="block w-full font-mono text-[11px] text-sev-critical">{r.errorCode}</span>}
        </span>
      ),
    },
    { id: "created", header: "Requested", sortKey: "createdAt", cell: (r) => <span className="text-xs"><DateText value={r.createdAt} withTime /><span className="block text-muted-foreground">{r.generatedByName ?? "—"}</span></span> },
    { id: "expires", header: "Expires", cell: (r) => <DateText value={r.expiresAt} />, hideOnMobile: true },
    {
      id: "actions",
      header: "",
      cell: (r) => (
        <span className="flex justify-end gap-1">
          {r.status === "ready" && can("assistant.use") && <NarrativeDialog run={r} />}
          {r.canDownload && (
            <Button asChild size="xs" variant="outline">
              <a href={`/api/v1/reports/${r.id}/download`} download><Download /> Download</a>
            </Button>
          )}
        </span>
      ),
    },
  ];
  return (
    <>
      <FilterBar params={params} setParams={setParams} filters={[{ key: "status", label: "Status", options: options(["queued", "generating", "ready", "failed", "expired"]) }, { key: "reportType", label: "Report", options: types.map((t) => ({ value: t.key, label: t.title })) }]} />
      <DataTable caption="Report history" columns={columns} query={query} params={params} setParams={setParams} rowKey={(r) => r.id} empty={{ title: "No reports yet", description: "Generate a report with the form." }} />
    </>
  );
}

function NewSchedule({ types }: { types: ReportType[] }) {
  const directory = useDirectory();
  const allowed = types.filter((t) => t.allowed && !t.requiredFilters?.length);
  const [open, setOpen] = useState(false);
  const [typeKey, setTypeKey] = useState(allowed[0]?.key ?? "");
  const [format, setFormat] = useState("pdf");
  const [frequency, setFrequency] = useState("weekly");
  const [recipients, setRecipients] = useState<string[]>([]);
  const create = useApiMutation({
    mutationFn: () => api.post("/report-schedules", { reportType: typeKey, format, frequency, recipientUserIds: recipients, filters: {} }),
    success: "Schedule created",
    invalidate: [["reports", "schedules"]],
    onSuccess: () => { setOpen(false); setRecipients([]); },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Plus /> New schedule</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule a report</DialogTitle>
          <DialogDescription>Scheduled reports are generated as drafts by the worker. Periodic reports cover the time since the previous run. Recipients must be allowed to download them.</DialogDescription>
        </DialogHeader>
        <form method="post" className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1">
            <Label htmlFor="s-type">Report</Label>
            <Select value={typeKey} onValueChange={setTypeKey}>
              <SelectTrigger id="s-type" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{allowed.map((t) => <SelectItem key={t.key} value={t.key}>{t.title}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="s-format">Format</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger id="s-format" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{FORMATS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="s-freq">Frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger id="s-freq" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{["daily", "weekly", "monthly"].map((f) => <SelectItem key={f} value={f}>{humanize(f)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">Recipients</legend>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
              {directory.data?.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={recipients.includes(u.id)} onCheckedChange={(c) => setRecipients(c ? [...recipients, u.id] : recipients.filter((x) => x !== u.id))} />
                  {u.displayName}
                </label>
              ))}
            </div>
          </fieldset>
          <DialogFooter><Button type="submit" disabled={!recipients.length || !typeKey || create.isPending}>Create schedule</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Schedules({ types }: { types: ReportType[] }) {
  const can = useCan();
  const directory = useDirectory();
  const query = useQuery({ queryKey: ["reports", "schedules"], queryFn: () => api.get<Schedule[]>("/reports/schedules") });
  const toggle = useApiMutation({ mutationFn: (s: Schedule) => api.patch(`/report-schedules/${s.id}`, { enabled: !s.enabled }), success: "Schedule updated", invalidate: [["reports", "schedules"]] });
  const remove = useApiMutation({ mutationFn: (id: string) => api.delete(`/report-schedules/${id}`), success: "Schedule deleted", invalidate: [["reports", "schedules"]] });
  const nameOf = (id: string) => directory.data?.find((u) => u.id === id)?.displayName ?? "Former member";
  return (
    <Section title="Schedules" description="Times are stored in UTC and shown in your time zone." actions={can("report.schedule") && <NewSchedule types={types} />}>
      <QueryState query={query}>
        {(items) =>
          items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scheduled reports.</p>
          ) : (
            <ul className="divide-y text-sm">
              {items.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                  <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {types.find((t) => t.key === s.reportType)?.title ?? s.reportType} · {s.format.toUpperCase()} · {s.frequency}
                    <span className="block text-xs text-muted-foreground">Next <DateText value={s.nextRunAt} withTime /> · to {s.recipientUserIds.map(nameOf).join(", ")}</span>
                  </span>
                  {can("report.schedule") && (
                    <>
                      <Switch aria-label={`${s.enabled ? "Pause" : "Resume"} schedule`} checked={s.enabled} onCheckedChange={() => toggle.mutate(s)} />
                      <ConfirmDialog trigger={<Button size="icon-xs" variant="ghost" aria-label="Delete schedule"><Trash2 /></Button>} title="Delete this schedule?" description="Reports already generated are kept." destructive confirmLabel="Delete" onConfirm={() => remove.mutateAsync(s.id)} />
                    </>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Section>
  );
}

function Reports() {
  const can = useCan();
  const types = useTypes();
  return (
    <>
      <PageHeader title="Reports" description="Traceable PDF, CSV and Excel reports generated from current records, with draft or final status and a source appendix." crumbs={[{ label: "Reporting" }, { label: "Reports" }]} />
      <QueryState query={types}>
        {(t) => (
          <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
            <div className="space-y-4">
              {can("report.generate") && <Section title="Generate a report"><GenerateForm types={t} /></Section>}
              <Schedules types={t} />
            </div>
            <div className="min-w-0">
              <History types={t} />
            </div>
          </div>
        )}
      </QueryState>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Reports />
    </Suspense>
  );
}
