"use client";

import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { SeverityBadge, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText, DueDate } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { useListParams } from "@/hooks/use-list-params";
import { api } from "@/lib/api";
import type { Page, Severity } from "@/lib/types";

interface Row {
  id: string;
  assessmentVersion: number;
  status: string;
  decision: string | null;
  dueDate: string | null;
  submittedAt: string | null;
  residualRisk: number | null;
  riskTier: Severity | null;
  vendor: { id: string; name: string; criticality: Severity };
  assessor: { displayName: string } | null;
  template: { name: string; version: number };
}

const columns: Column<Row>[] = [
  { id: "vendor", header: "Vendor", cell: (r) => <span>{r.vendor.name} <span className="text-xs text-muted-foreground">v{r.assessmentVersion}</span></span> },
  { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.decision ?? r.status} /> },
  { id: "tier", header: "Residual", cell: (r) => (r.riskTier ? <SeverityBadge severity={r.riskTier} score={r.residualRisk} /> : "—") },
  { id: "template", header: "Questionnaire", cell: (r) => <span className="text-xs">{r.template.name} v{r.template.version}</span>, hideOnMobile: true },
  { id: "assessor", header: "Assessor", cell: (r) => r.assessor?.displayName ?? "—", hideOnMobile: true },
  { id: "due", header: "Due", sortKey: "dueDate", cell: (r) => <DueDate value={r.dueDate} done={!!r.decision} /> },
  { id: "submitted", header: "Submitted", sortKey: "submittedAt", cell: (r) => <DateText value={r.submittedAt} />, hideOnMobile: true },
];

function Assessments() {
  const [params, setParams] = useListParams({ sort: "createdAt", order: "desc" });
  const query = useQuery({ queryKey: ["assessments", params], queryFn: () => api.get<Page<Row>>("/assessments", params) });
  return (
    <>
      <PageHeader title="Vendor assessments" description="Questionnaires in progress, under review and decided." crumbs={[{ label: "Third-Party Risk" }, { label: "Assessments" }]} />
      <FilterBar params={params} setParams={setParams} searchPlaceholder="Search vendor" filters={[{ key: "status", label: "Status", options: options(["draft", "submitted", "under_review", "returned_for_clarification", "approved", "closed"]) }]} />
      <DataTable caption="Vendor assessments" columns={columns} query={query} params={params} setParams={setParams} rowKey={(r) => r.id} rowHref={(r) => `/vendors/assessments/${r.id}`} empty={{ title: "No assessments yet", description: "Start an assessment from a vendor's page." }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Assessments />
    </Suspense>
  );
}
