"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot, Check, CheckCheck, Download, Library, Pencil, RefreshCw, RotateCcw } from "lucide-react";
import { use, useState } from "react";
import { humanize, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { QueryState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";

type ItemStatus = "pending" | "drafted" | "needs_input" | "approved";
interface Item {
  id: string;
  sortOrder: number;
  section: string | null;
  questionText: string;
  answerStatus: ItemStatus;
  shortAnswer: string | null;
  draftAnswer: string | null;
  finalAnswer: string | null;
  confidence: string | null;
  answerSource: "library" | "agent" | "manual" | null;
  sources: Array<{ type: string; label: string }> | null;
  reviewedAt: string | null;
}
interface Questionnaire {
  id: string;
  title: string;
  customerName: string;
  status: string;
  dueDate: string | null;
  createdAt: string;
  items: Item[];
}

const SHORT = ["yes", "no", "partial", "not_applicable", "unknown"] as const;
const FILTERS: Array<{ key: "all" | ItemStatus; label: string }> = [
  { key: "all", label: "All" },
  { key: "needs_input", label: "Needs input" },
  { key: "drafted", label: "Drafted" },
  { key: "approved", label: "Approved" },
  { key: "pending", label: "Being answered" },
];

function ItemRow({ q, item }: { q: Questionnaire; item: Item }) {
  const can = useCan();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.finalAnswer ?? item.draftAnswer ?? "");
  const [short, setShort] = useState<string>(item.shortAnswer ?? "unknown");
  const update = useApiMutation({
    mutationFn: (v: { action: "save" | "approve" | "reopen"; finalAnswer?: string; shortAnswer?: string }) => api.patch(`/trust/questionnaires/${q.id}/items/${item.id}`, v),
    success: "Answer updated",
    invalidate: [["trust"]],
    onSuccess: () => setEditing(false),
  });
  const answer = item.finalAnswer ?? item.draftAnswer;
  const manage = can("trust.manage");
  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 font-medium">
          <span className="text-muted-foreground">{item.sortOrder}.</span> {item.section && <span className="text-xs text-muted-foreground">[{item.section}] </span>}
          {item.questionText}
        </p>
        <span className="flex shrink-0 items-center gap-1.5 text-xs">
          {item.answerSource === "library" && <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5"><Library className="size-3" aria-hidden /> From library</span>}
          {item.answerSource === "agent" && <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5"><Bot className="size-3" aria-hidden /> AI draft · {item.confidence ?? "low"} confidence</span>}
          <StatusBadge status={item.answerStatus === "approved" ? "approved" : item.answerStatus === "needs_input" ? "rejected" : "pending_review"} label={humanize(item.answerStatus)} />
        </span>
      </div>
      {editing ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Short answer">
            {SHORT.map((s) => (
              <Button key={s} type="button" size="xs" variant={short === s ? "default" : "outline"} role="radio" aria-checked={short === s} onClick={() => setShort(s)}>
                {humanize(s)}
              </Button>
            ))}
          </div>
          <Textarea aria-label="Answer" rows={4} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button size="xs" disabled={update.isPending || !text.trim()} onClick={() => update.mutate({ action: "approve", finalAnswer: text.trim(), shortAnswer: short })}>
              <Check aria-hidden /> Save and approve
            </Button>
            <Button size="xs" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ action: "save", finalAnswer: text.trim(), shortAnswer: short })}>
              Save draft
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {answer ? (
            <p className="whitespace-pre-line text-sm">
              {item.shortAnswer && <span className="font-medium">{humanize(item.shortAnswer)} — </span>}
              {answer}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{item.answerStatus === "pending" ? "The AI agent is answering…" : "No answer found in your controls or evidence. Write it yourself."}</p>
          )}
          {item.sources?.length ? <p className="text-xs text-muted-foreground">Based on: {item.sources.map((s) => s.label).join("; ")}</p> : null}
          {manage && item.answerStatus !== "pending" && (
            <div className="flex flex-wrap gap-2">
              {item.answerStatus !== "approved" && answer && item.shortAnswer !== "unknown" && (
                <Button size="xs" disabled={update.isPending} onClick={() => update.mutate({ action: "approve" })}>
                  <Check aria-hidden /> Approve
                </Button>
              )}
              {item.answerStatus !== "approved" && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => {
                    setText(answer ?? "");
                    setShort(item.shortAnswer ?? "yes");
                    setEditing(true);
                  }}
                >
                  <Pencil aria-hidden /> {answer ? "Edit" : "Write answer"}
                </Button>
              )}
              {item.answerStatus === "approved" && (
                <Button size="xs" variant="ghost" disabled={update.isPending} onClick={() => update.mutate({ action: "reopen" })}>
                  <RotateCcw aria-hidden /> Reopen
                </Button>
              )}
              {item.reviewedAt && <span className="text-xs text-muted-foreground">Approved <DateText value={item.reviewedAt} relative /></span>}
            </div>
          )}
        </>
      )}
    </li>
  );
}

export default function QuestionnairePage({ params }: PageProps<"/trust/questionnaires/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const [filter, setFilter] = useState<"all" | ItemStatus>("all");
  const query = useQuery({
    queryKey: ["trust", "questionnaire", id],
    queryFn: () => api.get<Questionnaire>(`/trust/questionnaires/${id}`),
    refetchInterval: (q) => (q.state.data?.items.some((i) => i.answerStatus === "pending") ? 4000 : false),
  });
  const reanswer = useApiMutation({ mutationFn: () => api.post(`/trust/questionnaires/${id}/reanswer`), success: "The AI agent is trying the unanswered questions again", invalidate: [["trust"]] });
  const bulk = useApiMutation({ mutationFn: () => api.post<{ approved: number }>(`/trust/questionnaires/${id}/approve-drafted`), success: (r) => `${r.approved} answer(s) approved`, invalidate: [["trust"]] });
  return (
    <QueryState query={query} rows={8}>
      {(q) => {
        const count = (s: ItemStatus) => q.items.filter((i) => i.answerStatus === s).length;
        const items = filter === "all" ? q.items : q.items.filter((i) => i.answerStatus === filter);
        return (
          <>
            <PageHeader
              title={q.customerName}
              description={`${q.title} · ${q.items.length} question(s)${q.dueDate ? ` · due ${new Date(q.dueDate).toLocaleDateString()}` : ""}`}
              crumbs={[{ label: "AI Agent" }, { label: "Customer questionnaires", href: "/trust/questionnaires" }, { label: q.customerName }]}
              meta={<StatusBadge status={q.status} label={humanize(q.status)} />}
              actions={
                <span className="flex flex-wrap gap-2">
                  {can("trust.manage") && count("drafted") > 0 && (
                    <ConfirmDialog
                      trigger={<Button variant="outline"><CheckCheck aria-hidden /> Approve all drafted ({count("drafted")})</Button>}
                      title="Approve every drafted answer?"
                      description="Only drafted answers with a definite short answer are approved; “unknown” ones stay open. Approved answers are added to your answer library and reused for future customers. Read them first."
                      confirmLabel="Approve"
                      onConfirm={() => bulk.mutateAsync(undefined)}
                    />
                  )}
                  {can("trust.manage") && count("needs_input") > 0 && (
                    <Button variant="outline" onClick={() => reanswer.mutate(undefined)} disabled={reanswer.isPending}>
                      <RefreshCw aria-hidden /> Try again with AI
                    </Button>
                  )}
                  <Button asChild>
                    <a href={`/api/v1/trust/questionnaires/${id}/export.csv`}>
                      <Download aria-hidden /> Export CSV
                    </a>
                  </Button>
                </span>
              }
            />
            <div className="mb-3 flex flex-wrap gap-1" role="tablist" aria-label="Filter answers">
              {FILTERS.map((f) => (
                <Button key={f.key} size="xs" role="tab" aria-selected={filter === f.key} variant={filter === f.key ? "default" : "outline"} onClick={() => setFilter(f.key)}>
                  {f.label} ({f.key === "all" ? q.items.length : count(f.key)})
                </Button>
              ))}
            </div>
            {count("pending") > 0 && <p className="mb-3 text-sm text-muted-foreground" role="status">The AI agent is answering {count("pending")} question(s). This page updates automatically.</p>}
            <ul className="divide-y rounded-md border">
              {items.map((i) => (
                <ItemRow key={`${i.id}-${i.answerStatus}-${i.finalAnswer ?? ""}`} q={q} item={i} />
              ))}
              {!items.length && <li className="p-3 text-sm text-muted-foreground">No questions in this view.</li>}
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Received <DateText value={q.createdAt} />. Export includes approved answers and, for the rest, the current draft marked with its status.</p>
          </>
        );
      }}
    </QueryState>
  );
}
