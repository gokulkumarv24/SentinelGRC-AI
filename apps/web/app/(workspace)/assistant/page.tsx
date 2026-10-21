"use client";

import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { DraftView, useAiStatus, type AiArtifact } from "@/components/ai/ai-assist";
import { humanize, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useListParams } from "@/hooks/use-list-params";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

const TYPES = ["evidence_summary", "evidence_statements", "vendor_observations", "finding_draft", "remediation_options", "risk_summary", "report_draft", "mapping_suggestions", "control_failure_explanation"];
const DECISION_TONE: Record<AiArtifact["decision"], string> = { pending: "pending_review", accepted: "approved", edited_and_accepted: "approved", rejected: "rejected" };

function Drafts() {
  const status = useAiStatus();
  const [params, setParams] = useListParams({ sort: "createdAt", order: "desc" });
  const query = useQuery({ queryKey: ["ai", "list", params], queryFn: () => api.get<Page<AiArtifact>>("/ai/drafts", params) });
  const columns: Column<AiArtifact>[] = [
    { id: "type", header: "Draft", cell: (a) => <span>{humanize(a.artifactType)}<span className="block text-xs text-muted-foreground">{a.sourceRecords.map((s) => s.label).slice(0, 2).join(", ")}{a.sourceRecords.length > 2 ? ` +${a.sourceRecords.length - 2}` : ""}</span></span> },
    { id: "status", header: "Result", cell: (a) => (a.status === "failed" ? <StatusBadge status="failed" label={`Failed: ${a.errorCode ?? "invalid output"}`} /> : <StatusBadge status="succeeded" label="Draft" />) },
    { id: "decision", header: "Human review", cell: (a) => <StatusBadge status={DECISION_TONE[a.decision]} label={humanize(a.decision)} /> },
    { id: "model", header: "Provider / model", cell: (a) => <span className="font-mono text-xs">{a.provider}/{a.model}<span className="block text-muted-foreground">{a.promptVersion}</span></span>, hideOnMobile: true },
    { id: "created", header: "Created", sortKey: "createdAt", cell: (a) => <DateText value={a.createdAt} withTime /> },
    {
      id: "open",
      header: "",
      cell: (a) => (
        <Dialog>
          <DialogTrigger asChild><Button size="xs" variant="outline">Open</Button></DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{humanize(a.artifactType)}</DialogTitle></DialogHeader>
            <DraftView artifact={a} />
          </DialogContent>
        </Dialog>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title="AI drafts"
        description="Every AI-generated draft with its sources, model and prompt version, and who reviewed it. Drafts never change records by themselves."
        crumbs={[{ label: "Reporting" }, { label: "AI drafts" }]}
        meta={status.data && <span className="text-xs text-muted-foreground">AI is {status.data.enabled ? "enabled" : "disabled"} · provider {status.data.provider} ({status.data.model}){status.data.sendsDataExternally ? " · sends redacted data externally" : " · runs locally"}</span>}
      />
      <FilterBar
        params={params}
        setParams={setParams}
        filters={[
          { key: "artifactType", label: "Type", options: options(TYPES) },
          { key: "decision", label: "Review", options: options(["pending", "accepted", "edited_and_accepted", "rejected"]) },
          { key: "mine", label: "Requested by", options: [{ value: "true", label: "Me" }] },
        ]}
      />
      <DataTable caption="AI drafts" columns={columns} query={query} params={params} setParams={setParams} rowKey={(a) => a.id} empty={{ title: "No AI drafts", description: "Use “Draft with AI” on evidence, findings, risks, vendor assessments, controls or reports." }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Drafts />
    </Suspense>
  );
}
