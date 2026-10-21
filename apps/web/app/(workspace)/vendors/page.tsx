"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Suspense } from "react";
import { SeverityBadge, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DueDate } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { VendorFormDialog } from "@/components/vendors/vendor-form";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page, Severity } from "@/lib/types";

interface VendorRow {
  id: string;
  name: string;
  serviceDescription: string;
  criticality: Severity;
  status: string;
  inherentRiskScore: number | null;
  residualRiskScore: number | null;
  riskTier: Severity | null;
  nextAssessmentAt: string | null;
  businessOwner: { displayName: string } | null;
  _count: { assessments: number };
}

const columns: Column<VendorRow>[] = [
  { id: "name", header: "Vendor", sortKey: "name", cell: (v) => <span>{v.name}<span className="block text-xs text-muted-foreground">{v.serviceDescription}</span></span> },
  { id: "crit", header: "Criticality", cell: (v) => <SeverityBadge severity={v.criticality} /> },
  { id: "status", header: "Status", cell: (v) => <StatusBadge status={v.status} /> },
  { id: "inherent", header: "Inherent", sortKey: "inherentRiskScore", cell: (v) => <span className="tabular-nums">{v.inherentRiskScore ?? "—"}</span>, hideOnMobile: true },
  { id: "residual", header: "Residual tier", sortKey: "residualRiskScore", cell: (v) => (v.riskTier ? <SeverityBadge severity={v.riskTier} score={v.residualRiskScore} /> : <span className="text-xs text-muted-foreground">Not assessed</span>) },
  { id: "next", header: "Next assessment", sortKey: "nextAssessmentAt", cell: (v) => <DueDate value={v.nextAssessmentAt} />, hideOnMobile: true },
  { id: "owner", header: "Business owner", cell: (v) => v.businessOwner?.displayName ?? "—", hideOnMobile: true },
];

function Vendors() {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "name", order: "asc" });
  const query = useQuery({ queryKey: ["vendors", params], queryFn: () => api.get<Page<VendorRow>>("/vendors", params) });
  const action = can("vendor.create") && <VendorFormDialog trigger={<Button><Plus aria-hidden /> New vendor</Button>} />;
  return (
    <>
      <PageHeader title="Vendors" description="Third parties, their inherent risk from the service profile and residual risk from reviewed assessments." crumbs={[{ label: "Third-Party Risk" }, { label: "Vendors" }]} actions={action} />
      <FilterBar
        params={params}
        setParams={setParams}
        searchPlaceholder="Search vendors"
        filters={[
          { key: "status", label: "Status", options: options(["draft", "onboarding", "assessment_required", "under_review", "approved", "approved_with_conditions", "rejected", "active", "offboarding", "archived"]) },
          { key: "criticality", label: "Criticality", options: options(["low", "medium", "high", "critical"]) },
          { key: "tier", label: "Residual tier", options: options(["low", "medium", "high", "critical", "not_assessed"]) },
          { key: "reassessmentDue", label: "Reassessment", options: [{ value: "true", label: "Due within 30 days" }] },
        ]}
      />
      <DataTable caption="Vendors" columns={columns} query={query} params={params} setParams={setParams} rowKey={(v) => v.id} rowHref={(v) => `/vendors/${v.id}`} empty={{ title: "No vendors yet", description: "Register the third parties that handle your data or access your systems.", action }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Vendors />
    </Suspense>
  );
}
