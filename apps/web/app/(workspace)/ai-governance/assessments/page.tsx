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

interface Row {
  id: string;
  assessmentVersion: number;
  status: string;
  riskTier: string;
  submittedAt: string | null;
  approvedAt: string | null;
  createdAt: string;
  aiSystem: { id: string; name: string; lifecycleStatus: string };
  progress: { answered: number; total: number; unsatisfactory: number };
}

const columns: Column<Row>[] = [
  { id: "system", header: "AI system", cell: (r) => <span>{r.aiSystem.name} <span className="text-xs text-muted-foreground">v{r.assessmentVersion}</span></span> },
  { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  { id: "progress", header: "Progress", cell: (r) => <span className="text-xs tabular-nums">{r.progress.answered}/{r.progress.total} rated{r.progress.unsatisfactory > 0 && <span className="text-sev-high"> · {r.progress.unsatisfactory} unsatisfactory</span>}</span> },
  { id: "tier", header: "Tier", cell: (r) => humanize(r.riskTier), hideOnMobile: true },
  { id: "submitted", header: "Submitted", sortKey: "submittedAt", cell: (r) => <DateText value={r.submittedAt} />, hideOnMobile: true },
  { id: "created", header: "Started", sortKey: "createdAt", cell: (r) => <DateText value={r.createdAt} /> },
];

function List() {
  const [params, setParams] = useListParams({ sort: "createdAt", order: "desc" });
  const query = useQuery({ queryKey: ["ai-assessments", params], queryFn: () => api.get<Page<Row>>("/ai-assessments", params) });
  return (
    <>
      <PageHeader title="AI assessments" description="Risk assessments of AI systems, organized by NIST AI RMF function." crumbs={[{ label: "AI Governance" }, { label: "Assessments" }]} />
      <FilterBar params={params} setParams={setParams} searchPlaceholder="Search AI system" filters={[{ key: "status", label: "Status", options: options(["draft", "in_progress", "submitted", "approved", "rejected", "superseded"]) }]} />
      <DataTable caption="AI assessments" columns={columns} query={query} params={params} setParams={setParams} rowKey={(r) => r.id} rowHref={(r) => `/ai-governance/assessments/${r.id}`} empty={{ title: "No AI assessments", description: "Start one from an AI system's page." }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <List />
    </Suspense>
  );
}
