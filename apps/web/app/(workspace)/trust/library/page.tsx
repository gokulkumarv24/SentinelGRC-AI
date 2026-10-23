"use client";

import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { humanize } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DataTable, FilterBar, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

interface Row {
  id: string;
  questionText: string;
  shortAnswer: string | null;
  answer: string;
  usageCount: number;
  updatedAt: string;
}

function Library() {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "updatedAt", order: "desc" });
  const query = useQuery({ queryKey: ["trust", "library", params], queryFn: () => api.get<Page<Row>>("/trust/answers", params) });
  const retire = useApiMutation({ mutationFn: (id: string) => api.delete(`/trust/answers/${id}`), success: "Answer removed from the library", invalidate: [["trust"]] });
  const columns: Column<Row>[] = [
    { id: "question", header: "Question", cell: (r) => <span className="font-medium">{r.questionText}</span> },
    { id: "answer", header: "Approved answer", cell: (r) => <span className="text-sm">{r.shortAnswer && <span className="font-medium">{humanize(r.shortAnswer)} — </span>}{r.answer}</span> },
    { id: "used", header: "Reused", sortKey: "usageCount", cell: (r) => `${r.usageCount}×` },
    { id: "updated", header: "Last approved", sortKey: "updatedAt", cell: (r) => <DateText value={r.updatedAt} /> },
    {
      id: "actions",
      header: "",
      cell: (r) =>
        can("trust.manage") ? (
          <ConfirmDialog trigger={<Button size="xs" variant="ghost">Remove</Button>} title="Remove this answer from the library?" description="Future questionnaires will no longer reuse it. Questionnaires already answered are not changed." destructive confirmLabel="Remove" onConfirm={() => retire.mutateAsync(r.id)} />
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader title="Answer library" description="Every answer a person approved. The AI agent reuses these first — free, instant and consistent — before drafting anything new." crumbs={[{ label: "AI Agent" }, { label: "Answer library" }]} />
      <FilterBar params={params} setParams={setParams} filters={[]} />
      <DataTable caption="Approved answers" columns={columns} query={query} params={params} setParams={setParams} rowKey={(r) => r.id} empty={{ title: "No approved answers yet", description: "Approve answers in a customer questionnaire and they appear here." }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Library />
    </Suspense>
  );
}
