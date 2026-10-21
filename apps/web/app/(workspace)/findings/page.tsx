"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Suspense } from "react";
import { SeverityBadge, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText, DueDate } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { FindingFormDialog } from "@/components/findings/finding-form";
import { Button } from "@/components/ui/button";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Finding, Page } from "@/lib/types";

const STATUSES = ["open", "triaged", "in_remediation", "pending_validation", "closed", "accepted", "reopened"] as const;

const columns: Column<Finding>[] = [
  { id: "key", header: "Finding", sortKey: "findingKey", cell: (f) => <span><span className="font-mono text-xs">{f.findingKey}</span> · {f.title}</span> },
  { id: "severity", header: "Severity", sortKey: "severity", cell: (f) => <SeverityBadge severity={f.severity} /> },
  { id: "status", header: "Status", cell: (f) => <StatusBadge status={f.status} /> },
  { id: "source", header: "Source", cell: (f) => f.sourceType.replace(/_/g, " "), hideOnMobile: true },
  { id: "assignee", header: "Assignee", cell: (f) => f.assignee?.displayName ?? <span className="text-muted-foreground">Unassigned</span>, hideOnMobile: true },
  { id: "due", header: "Due", sortKey: "dueDate", cell: (f) => <DueDate value={f.dueDate} done={["closed", "accepted"].includes(f.status)} /> },
  { id: "detected", header: "Last detected", sortKey: "lastDetectedAt", cell: (f) => <span><DateText value={f.lastDetectedAt} />{f.detectionCount > 1 && <span className="ml-1 text-xs text-muted-foreground">×{f.detectionCount}</span>}</span>, hideOnMobile: true },
];

function Findings() {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "createdAt", order: "desc" });
  const query = useQuery({ queryKey: ["findings", params], queryFn: () => api.get<Page<Finding>>("/findings", params) });
  const action = can("finding.create") && <FindingFormDialog trigger={<Button><Plus aria-hidden /> New finding</Button>} />;
  return (
    <>
      <PageHeader title="Findings" description="Gaps detected by control tests, assessments and reviews. Re-detections update the existing finding instead of duplicating it." crumbs={[{ label: "Risk Management" }, { label: "Findings" }]} actions={action} />
      <FilterBar
        params={params}
        setParams={setParams}
        searchPlaceholder="Search key or title"
        filters={[
          { key: "status", label: "Status", options: options(STATUSES) },
          { key: "severity", label: "Severity", options: options(["low", "medium", "high", "critical"]) },
          { key: "sourceType", label: "Source", options: options(["manual", "control_test", "vendor_assessment", "ai_assessment", "ai_incident"]) },
          { key: "overdue", label: "Due", options: [{ value: "true", label: "Overdue only" }] },
        ]}
      />
      <DataTable caption="Findings" columns={columns} query={query} params={params} setParams={setParams} rowKey={(f) => f.id} rowHref={(f) => `/findings/${f.id}`} empty={{ title: "No findings", description: "Nothing has been detected yet.", action }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Findings />
    </Suspense>
  );
}
