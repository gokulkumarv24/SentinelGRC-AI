"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Suspense } from "react";
import { humanize, SeverityBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListParams } from "@/hooks/use-list-params";
import { useCan, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page, Severity } from "@/lib/types";

interface Row {
  id: string;
  changeType: string;
  changeDescription: string;
  previousVersion: string | null;
  newVersion: string | null;
  changeRisk: Severity;
  requiresReassessment: boolean;
  reviewStatus: string;
  requestedBy: string | null;
  createdAt: string;
  aiSystem: { id: string; name: string };
}

function Changes() {
  const can = useCan();
  const { data: me } = useMe();
  const [params, setParams] = useListParams({ sort: "createdAt", order: "desc" });
  const query = useQuery({ queryKey: ["ai-changes", params], queryFn: () => api.get<Page<Row>>("/ai-model-changes", params) });
  const review = useApiMutation({ mutationFn: (v: { id: string; decision: string; notes: string }) => api.post(`/ai-model-changes/${v.id}/review`, { decision: v.decision, notes: v.notes }), success: "Change reviewed", invalidate: [["ai-changes"], ["ai-systems"]] });
  const columns: Column<Row>[] = [
    { id: "system", header: "AI system", cell: (r) => <Link href={`/ai-governance/${r.aiSystem.id}`} className="text-primary hover:underline">{r.aiSystem.name}</Link> },
    { id: "change", header: "Change", cell: (r) => <span>{humanize(r.changeType)}{r.newVersion && <span className="text-xs text-muted-foreground"> · {r.previousVersion ?? "—"} → {r.newVersion}</span>}<span className="block text-xs">{r.changeDescription}</span></span> },
    { id: "risk", header: "Change risk", cell: (r) => <SeverityBadge severity={r.changeRisk} /> },
    { id: "review", header: "Review", cell: (r) => <StatusBadge status={r.reviewStatus} /> },
    { id: "when", header: "Recorded", sortKey: "createdAt", cell: (r) => <DateText value={r.createdAt} /> },
    {
      id: "actions",
      header: "",
      cell: (r) =>
        can("ai_change.review") && r.reviewStatus === "pending_review" && r.requestedBy !== me?.user.id ? (
          <span className="flex gap-1">
            <ConfirmDialog trigger={<Button size="xs">Approve</Button>} title="Approve change" requireRationale confirmLabel="Approve" onConfirm={(n) => review.mutateAsync({ id: r.id, decision: "approved", notes: n })} />
            <ConfirmDialog trigger={<Button size="xs" variant="outline">Reject</Button>} title="Reject change" requireRationale destructive confirmLabel="Reject" onConfirm={(n) => review.mutateAsync({ id: r.id, decision: "rejected", notes: n })} />
          </span>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader title="AI change reviews" description="Model, provider, data and intended-purpose changes. Each triggers reassessment and needs an independent reviewer." crumbs={[{ label: "AI Governance" }, { label: "Change reviews" }]} />
      <FilterBar params={params} setParams={setParams} filters={[{ key: "reviewStatus", label: "Review", options: options(["pending_review", "approved", "rejected"]) }]} />
      <DataTable caption="AI model changes" columns={columns} query={query} params={params} setParams={setParams} rowKey={(r) => r.id} empty={{ title: "No changes recorded" }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Changes />
    </Suspense>
  );
}
