"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Suspense } from "react";
import { SeverityBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListParams } from "@/hooks/use-list-params";
import { useCan, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page, RiskAcceptance } from "@/lib/types";

function AcceptanceQueue() {
  const can = useCan();
  const { data: me } = useMe();
  const [params, setParams] = useListParams({ sort: "requestedAt", order: "desc" });
  const query = useQuery({ queryKey: ["risks", "acceptances", params], queryFn: () => api.get<Page<RiskAcceptance>>("/risk-acceptances", params) });
  const decide = useApiMutation({
    mutationFn: (vars: { id: string; decision: "approved" | "rejected"; rationale: string }) => api.post(`/risk-acceptances/${vars.id}/decision`, { decision: vars.decision, rationale: vars.rationale }),
    success: "Decision recorded",
    invalidate: [["risks"]],
  });

  const columns: Column<RiskAcceptance>[] = [
    { id: "risk", header: "Risk", cell: (a) => <span><span className="font-mono text-xs">{a.risk?.riskKey}</span> · {a.risk?.title}</span> },
    { id: "rating", header: "Rating", cell: (a) => <SeverityBadge severity={a.risk?.residualRating ?? a.risk?.inherentRating} score={a.riskScoreAtRequest} /> },
    { id: "requested", header: "Requested", sortKey: "requestedAt", cell: (a) => <span>{a.requestedByRef?.displayName} · <DateText value={a.requestedAt} /></span>, hideOnMobile: true },
    { id: "expiry", header: "Expires", sortKey: "expiryDate", cell: (a) => <DateText value={a.expiryDate} /> },
    { id: "decision", header: "Decision", cell: (a) => <StatusBadge status={a.decision} /> },
    {
      id: "actions",
      header: "Actions",
      cell: (a) =>
        a.decision === "pending" && can("risk.acceptance.decide") && a.requestedBy !== me?.user.id && a.risk?.riskOwnerId !== me?.user.id ? (
          <div className="flex gap-1">
            <ConfirmDialog trigger={<Button size="xs">Approve</Button>} title={`Approve acceptance for ${a.risk?.riskKey}`} description={a.rationale} requireRationale confirmLabel="Approve" onConfirm={(r) => decide.mutateAsync({ id: a.id, decision: "approved", rationale: r })} />
            <ConfirmDialog trigger={<Button size="xs" variant="outline">Reject</Button>} title={`Reject acceptance for ${a.risk?.riskKey}`} description={a.rationale} requireRationale destructive confirmLabel="Reject" onConfirm={(r) => decide.mutateAsync({ id: a.id, decision: "rejected", rationale: r })} />
          </div>
        ) : (
          <Link href={`/risks/${a.riskId}`} className="text-xs text-primary hover:underline">
            View risk
          </Link>
        ),
    },
  ];

  return (
    <>
      <PageHeader title="Risk acceptance" description="Requests to accept residual risk. Approvals require an authorized decision-maker other than the requester or risk owner." crumbs={[{ label: "Risk Management" }, { label: "Risk acceptance" }]} />
      <FilterBar params={params} setParams={setParams} filters={[{ key: "decision", label: "Decision", options: options(["pending", "approved", "rejected", "expired", "withdrawn"]) }]} />
      <DataTable caption="Risk acceptance requests" columns={columns} query={query} params={params} setParams={setParams} rowKey={(a) => a.id} empty={{ title: "No acceptance requests", description: "Requests appear here when a risk owner asks to accept a residual risk." }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <AcceptanceQueue />
    </Suspense>
  );
}
