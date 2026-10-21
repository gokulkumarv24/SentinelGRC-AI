"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Suspense } from "react";
import { SeverityBadge, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader, Section } from "@/components/common/page-header";
import { RiskFormDialog, RISK_CATEGORIES } from "@/components/risks/risk-form";
import { RiskHeatmap } from "@/components/risks/risk-heatmap";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page, Risk } from "@/lib/types";

const STATUSES = ["identified", "assessed", "treatment_planned", "in_treatment", "monitoring", "accepted", "closed"] as const;

const columns: Column<Risk>[] = [
  { id: "key", header: "Risk", sortKey: "riskKey", cell: (r) => <span><span className="font-mono text-xs">{r.riskKey}</span> · {r.title}</span> },
  { id: "category", header: "Category", cell: (r) => r.category, hideOnMobile: true },
  { id: "inherent", header: "Inherent", sortKey: "inherentScore", cell: (r) => <SeverityBadge severity={r.inherentRating} score={r.inherentScore} /> },
  { id: "residual", header: "Residual", sortKey: "residualScore", cell: (r) => (r.residualRating ? <SeverityBadge severity={r.residualRating} score={r.residualScore} /> : <span className="text-xs text-muted-foreground">Not assessed</span>) },
  { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  { id: "owner", header: "Owner", cell: (r) => r.owner?.displayName ?? <span className="text-muted-foreground">Unassigned</span>, hideOnMobile: true },
  { id: "review", header: "Review", sortKey: "reviewDate", cell: (r) => <DateText value={r.reviewDate} />, hideOnMobile: true },
];

function RiskRegister() {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "inherentScore", order: "desc" });
  const query = useQuery({ queryKey: ["risks", params], queryFn: () => api.get<Page<Risk>>("/risks", params) });
  const newRisk = can("risk.create") && (
    <RiskFormDialog trigger={<Button><Plus aria-hidden /> New risk</Button>} />
  );

  return (
    <>
      <PageHeader
        title="Risk register"
        description="Shared enterprise risks from compliance tests, vendor assessments, AI assessments and manual identification."
        crumbs={[{ label: "Risk Management" }, { label: "Risk register" }]}
        actions={newRisk}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          <FilterBar
            params={params}
            setParams={setParams}
            searchPlaceholder="Search key, title or description"
            filters={[
              { key: "status", label: "Status", options: options(STATUSES) },
              { key: "rating", label: "Rating", options: options(["low", "medium", "high", "critical"]) },
              { key: "category", label: "Category", options: RISK_CATEGORIES.map((c) => ({ value: c, label: c })) },
            ]}
          />
          <DataTable
            caption="Risks"
            columns={columns}
            query={query}
            params={params}
            setParams={setParams}
            rowKey={(r) => r.id}
            rowHref={(r) => `/risks/${r.id}`}
            empty={{ title: "No risks yet", description: "Record a risk manually or let control tests and assessments create them.", action: newRisk }}
          />
        </div>
        <Section title="Risk heatmap" description="Counts of open risks per cell.">
          <RiskHeatmap />
        </Section>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <RiskRegister />
    </Suspense>
  );
}
