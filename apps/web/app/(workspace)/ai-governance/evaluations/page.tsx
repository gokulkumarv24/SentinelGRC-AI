"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
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
  evaluationType: string;
  methodology: string;
  version: string;
  result: string;
  limitations: string;
  executedAt: string;
  approvalStatus: string;
  metrics: Record<string, unknown>;
  aiSystem: { id: string; name: string };
}

const columns: Column<Row>[] = [
  { id: "system", header: "AI system", cell: (r) => <Link href={`/ai-governance/${r.aiSystem.id}`} className="text-primary hover:underline">{r.aiSystem.name}</Link> },
  { id: "type", header: "Type", cell: (r) => `${humanize(r.evaluationType)} v${r.version}` },
  { id: "result", header: "Result", cell: (r) => <StatusBadge status={r.result === "pass" ? "pass" : r.result === "fail" ? "fail" : "unknown"} label={r.result} /> },
  { id: "method", header: "Method and limitations", cell: (r) => <span className="text-xs">{r.methodology}<span className="block text-muted-foreground">Limitations: {r.limitations}</span></span>, hideOnMobile: true },
  { id: "metrics", header: "Metrics", cell: (r) => <span className="font-mono text-[11px]">{Object.keys(r.metrics).length ? JSON.stringify(r.metrics) : "—"}</span>, hideOnMobile: true },
  { id: "approval", header: "Approval", cell: (r) => <StatusBadge status={r.approvalStatus} /> },
  { id: "when", header: "Executed", sortKey: "executedAt", cell: (r) => <DateText value={r.executedAt} /> },
];

function Evaluations() {
  const [params, setParams] = useListParams({ sort: "executedAt", order: "desc" });
  const query = useQuery({ queryKey: ["ai-evaluations", params], queryFn: () => api.get<Page<Row>>("/ai-evaluations", params) });
  return (
    <>
      <PageHeader title="AI evaluations" description="Security, reliability, fairness, privacy and explainability evaluations with documented methodology and limitations." crumbs={[{ label: "AI Governance" }, { label: "Evaluations" }]} />
      <FilterBar params={params} setParams={setParams} filters={[{ key: "evaluationType", label: "Type", options: options(["security", "quality_reliability", "fairness", "privacy", "explainability", "human_review", "drift_monitoring"]) }]} />
      <DataTable caption="AI evaluations" columns={columns} query={query} params={params} setParams={setParams} rowKey={(r) => r.id} empty={{ title: "No evaluations", description: "Record evaluations from an AI system's page." }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Evaluations />
    </Suspense>
  );
}
