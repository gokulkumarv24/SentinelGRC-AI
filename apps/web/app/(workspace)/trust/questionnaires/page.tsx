"use client";

import { useQuery } from "@tanstack/react-query";
import { FileUp, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { humanize, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

interface Row {
  id: string;
  title: string;
  customerName: string;
  status: string;
  dueDate: string | null;
  createdAt: string;
  progress: Partial<Record<"pending" | "drafted" | "needs_input" | "approved", number>>;
}

function NewQuestionnaireDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", customerName: "", dueDate: "", text: "" });
  const lines = form.text.split(/\r?\n/).filter((l) => l.trim()).length;
  const create = useApiMutation({
    mutationFn: () => api.post<{ id: string }>("/trust/questionnaires", { title: form.title, customerName: form.customerName, dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null, text: form.text }),
    success: "Questionnaire created — the AI agent is answering it now",
    invalidate: [["trust"]],
    onSuccess: (q) => {
      setOpen(false);
      router.push(`/trust/questionnaires/${q.id}`);
    },
  });
  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 400_000) return;
    setForm((f) => ({ ...f, text: "" }));
    const text = await file.text();
    setForm((f) => ({ ...f, text, title: f.title || file.name.replace(/\.[^.]+$/, "") }));
  };
  const valid = form.title.trim() && form.customerName.trim() && lines > 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> New questionnaire
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New customer questionnaire</DialogTitle>
          <DialogDescription>Paste the questions, one per line, or load a CSV with a “question” column. The AI agent drafts answers from your answer library, controls and approved evidence; you approve each one.</DialogDescription>
        </DialogHeader>
        <form
          id="trust-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) create.mutate(undefined);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="tq-customer">Customer</Label>
              <Input id="tq-customer" value={form.customerName} maxLength={200} onChange={(e) => setForm({ ...form, customerName: e.target.value })} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tq-title">Title</Label>
              <Input id="tq-title" value={form.title} maxLength={200} placeholder="e.g. Security due diligence 2026" onChange={(e) => setForm({ ...form, title: e.target.value })} required />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="tq-due">Due date</Label>
            <Input id="tq-due" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="tq-text">Questions</Label>
              <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-primary hover:underline">
                <FileUp className="size-3.5" aria-hidden /> Load .csv or .txt
                <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => loadFile(e.target.files?.[0])} />
              </label>
            </div>
            <Textarea id="tq-text" rows={10} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder={"Access control | Do you enforce MFA for administrators?\nDo you encrypt customer data at rest?"} />
            <p className="text-xs text-muted-foreground">{lines} line(s). Optional section prefix: “Section | Question”. Up to 500 questions.</p>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="trust-form" disabled={!valid || create.isPending}>
            {create.isPending ? "Creating…" : "Create and answer with AI"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Questionnaires() {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "createdAt", order: "desc" });
  const query = useQuery({ queryKey: ["trust", "questionnaires", params], queryFn: () => api.get<Page<Row>>("/trust/questionnaires", params), refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === "answering") ? 5000 : false) });
  const columns: Column<Row>[] = [
    { id: "customer", header: "Customer", sortKey: "customerName", cell: (r) => <span><span className="font-medium">{r.customerName}</span><span className="block text-xs text-muted-foreground">{r.title}</span></span> },
    { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} label={humanize(r.status)} /> },
    {
      id: "progress",
      header: "Answers",
      cell: (r) => {
        const total = Object.values(r.progress).reduce((a, b) => a + (b ?? 0), 0);
        return <span className="text-xs">{r.progress.approved ?? 0} approved · {r.progress.drafted ?? 0} drafted · {r.progress.needs_input ?? 0} need input · {total} total</span>;
      },
    },
    { id: "due", header: "Due", sortKey: "dueDate", cell: (r) => (r.dueDate ? <DateText value={r.dueDate} /> : "—") },
    { id: "created", header: "Received", sortKey: "createdAt", cell: (r) => <DateText value={r.createdAt} /> },
  ];
  return (
    <>
      <PageHeader
        title="Customer questionnaires"
        description="Security questionnaires your customers send you. The AI agent answers from approved past answers, controls and evidence; a person approves every answer before it is exported."
        crumbs={[{ label: "AI Agent" }, { label: "Customer questionnaires" }]}
        actions={can("trust.manage") && <NewQuestionnaireDialog />}
      />
      <FilterBar params={params} setParams={setParams} filters={[{ key: "status", label: "Status", options: options(["answering", "in_review", "completed"]) }]} />
      <DataTable caption="Customer questionnaires" columns={columns} query={query} params={params} setParams={setParams} rowKey={(r) => r.id} rowHref={(r) => `/trust/questionnaires/${r.id}`} empty={{ title: "No questionnaires yet", description: "Create one when a customer sends you a security questionnaire." }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Questionnaires />
    </Suspense>
  );
}
