"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Suspense } from "react";
import { AiSystemFormDialog } from "@/components/ai/ai-system-form";
import { humanize, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DueDate } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

const LIFECYCLE = ["proposed", "under_assessment", "approved_for_pilot", "pilot", "approved_for_production", "production", "suspended", "retired"] as const;
const TIERS = ["minimal", "limited", "high", "unacceptable", "undetermined"] as const;

interface Row {
  id: string;
  name: string;
  businessPurpose: string;
  modelName: string | null;
  modelVersion: string | null;
  lifecycleStatus: string;
  riskTier: string;
  nextReviewAt: string | null;
  personalDataProcessed: boolean;
  influencesDecisionsAboutPeople: boolean;
  businessOwner: { displayName: string } | null;
  providerVendor: { id: string; name: string } | null;
  _count: { assessments: number; incidents: number };
}

const TIER_TONE: Record<string, string> = { minimal: "approved", limited: "pending", high: "rejected", unacceptable: "error", undetermined: "unreviewed" };

const columns: Column<Row>[] = [
  { id: "name", header: "AI system", sortKey: "name", cell: (r) => <span>{r.name}<span className="block text-xs text-muted-foreground">{r.businessPurpose}</span></span> },
  { id: "stage", header: "Lifecycle", cell: (r) => <StatusBadge status={r.lifecycleStatus} /> },
  { id: "tier", header: "Risk tier", cell: (r) => <StatusBadge status={TIER_TONE[r.riskTier]} label={humanize(r.riskTier)} /> },
  { id: "model", header: "Model", cell: (r) => <span className="text-xs">{[r.modelName, r.modelVersion].filter(Boolean).join(" · ") || "—"}{r.providerVendor && <span className="block text-muted-foreground">via {r.providerVendor.name}</span>}</span>, hideOnMobile: true },
  { id: "flags", header: "Sensitivity", cell: (r) => <span className="text-xs">{[r.personalDataProcessed && "personal data", r.influencesDecisionsAboutPeople && "decisions about people"].filter(Boolean).join(", ") || "—"}</span>, hideOnMobile: true },
  { id: "review", header: "Next review", sortKey: "nextReviewAt", cell: (r) => <DueDate value={r.nextReviewAt} done={r.lifecycleStatus === "retired"} /> },
];

function Inventory() {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "name", order: "asc" });
  const query = useQuery({ queryKey: ["ai-systems", params], queryFn: () => api.get<Page<Row>>("/ai-systems", params) });
  const action = can("ai_system.create") && <AiSystemFormDialog trigger={<Button><Plus aria-hidden /> Register AI system</Button>} />;
  return (
    <>
      <PageHeader title="AI inventory" description="Every AI system with its purpose, owners, data, oversight and lifecycle stage. Pilot and production require an approved assessment and deployment approval." crumbs={[{ label: "AI Governance" }, { label: "AI inventory" }]} actions={action} />
      <FilterBar
        params={params}
        setParams={setParams}
        searchPlaceholder="Search name, model or purpose"
        filters={[
          { key: "lifecycleStatus", label: "Lifecycle", options: options(LIFECYCLE) },
          { key: "riskTier", label: "Risk tier", options: options(TIERS) },
          { key: "reviewDue", label: "Review", options: [{ value: "true", label: "Due within 30 days" }] },
        ]}
      />
      <DataTable caption="AI systems" columns={columns} query={query} params={params} setParams={setParams} rowKey={(r) => r.id} rowHref={(r) => `/ai-governance/${r.id}`} empty={{ title: "No AI systems registered", description: "Register AI systems your organization builds, buys or embeds.", action }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Inventory />
    </Suspense>
  );
}
