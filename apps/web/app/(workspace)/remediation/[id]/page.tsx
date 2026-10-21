"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { SeverityBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText, DueDate } from "@/components/common/date-text";
import { AuditTimeline } from "@/components/common/history";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { evidenceOption, RecordPicker, type PickerOption } from "@/components/common/record-picker";
import { ErrorState, LoadingState } from "@/components/common/states";
import { UserSelect } from "@/components/common/user-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { AuditEvent, RemediationTask } from "@/lib/types";

const TRANSITIONS: Record<string, string[]> = { open: ["in_progress", "blocked", "cancelled"], in_progress: ["blocked", "open", "cancelled"], blocked: ["in_progress", "open", "cancelled"], completed: ["in_progress"], cancelled: ["open"] };

export default function TaskDetail({ params }: PageProps<"/remediation/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const query = useQuery({ queryKey: ["remediation", id], queryFn: () => api.get<RemediationTask & { history: AuditEvent[] }>(`/remediation-tasks/${id}`) });
  const [evidence, setEvidence] = useState<PickerOption | null>(null);
  const [vendorResponse, setVendorResponse] = useState<string | null>(null);
  const invalidate = [["remediation"], ["findings"]];
  const update = useApiMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/remediation-tasks/${id}`, { ...body, version: query.data?.version }), success: "Task updated", invalidate });
  const complete = useApiMutation({ mutationFn: (notes: string) => api.post(`/remediation-tasks/${id}/complete`, { completionNotes: notes, completionEvidenceId: evidence?.id ?? null, version: query.data?.version }), success: "Task completed", invalidate });

  if (query.isPending) return <LoadingState rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const t = query.data;
  const editable = can("remediation.update") && t.status !== "completed" && t.status !== "cancelled";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Remediation", href: "/remediation" }, { label: t.title }]}
        title={t.title}
        meta={
          <>
            <StatusBadge status={t.status} />
            <StatusBadge status={t.priority} label={`${t.priority} priority`} />
          </>
        }
        actions={
          can("remediation.update") && (
            <>
              {TRANSITIONS[t.status]?.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => update.mutate({ status: s })} disabled={update.isPending}>
                  Mark {s.replace(/_/g, " ")}
                </Button>
              ))}
              {editable && (
                <ConfirmDialog trigger={<Button size="sm">Complete</Button>} title="Complete remediation task" description="Describe what was done. Attach evidence so the finding can be validated." requireRationale rationaleLabel="Completion notes" confirmLabel="Complete" onConfirm={(notes) => complete.mutateAsync(notes)}>
                  <div className="space-y-1.5">
                    <Label htmlFor="completion-evidence">Completion evidence</Label>
                    <RecordPicker id="completion-evidence" endpoint="/evidence" toOption={evidenceOption} value={evidence} onChange={setEvidence} placeholder="Optional" />
                  </div>
                </ConfirmDialog>
              )}
            </>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Plan">
            <p className="text-sm whitespace-pre-wrap">{t.description || <span className="text-muted-foreground">No description.</span>}</p>
            {t.completionNotes && (
              <p className="mt-3 rounded-md bg-ok-bg p-2 text-xs text-ok">
                Completed <DateText value={t.completedAt} />: {t.completionNotes}
                {t.completionEvidenceId && (
                  <>
                    {" · "}
                    <Link href={`/evidence/${t.completionEvidenceId}`} className="underline">
                      evidence
                    </Link>
                  </>
                )}
              </p>
            )}
          </Section>
          <Section title="Vendor response" description="For vendor-owned remediation: the vendor's status is tracked separately from internal review.">
            {can("remediation.update") ? (
              <div className="space-y-2">
                <Textarea aria-label="Vendor response" rows={3} defaultValue={t.vendorResponse ?? ""} onChange={(e) => setVendorResponse(e.target.value)} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" disabled={vendorResponse === null} onClick={() => update.mutate({ vendorResponse })}>
                    Save response
                  </Button>
                  <Select value={t.internalReviewStatus} onValueChange={(v) => update.mutate({ internalReviewStatus: v })}>
                    <SelectTrigger className="h-8 w-48" aria-label="Internal review status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["unreviewed", "pending_review", "approved", "rejected"].map((s) => (
                        <SelectItem key={s} value={s}>
                          Internal: {s.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ) : (
              <p className="text-sm">{t.vendorResponse ?? "—"}</p>
            )}
          </Section>
          <Section title="History">
            <AuditTimeline events={t.history} />
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Finding", value: t.finding && <Link className="text-primary hover:underline" href={`/findings/${t.finding.id}`}>{t.finding.findingKey} · {t.finding.title}</Link> },
                { label: "Finding severity", value: t.finding && <SeverityBadge severity={t.finding.severity} /> },
                { label: "Due", value: <DueDate value={t.dueDate} done={t.status === "completed"} /> },
                { label: "Internal review", value: <StatusBadge status={t.internalReviewStatus} /> },
                { label: "Created", value: <DateText value={t.createdAt} /> },
              ]}
            />
          </Section>
          {editable && (
            <Section title="Assignment">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="task-owner">Owner</Label>
                  <UserSelect id="task-owner" value={t.ownerId} onChange={(v) => update.mutate({ ownerId: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="task-due">Due date</Label>
                  <Input id="task-due" type="date" defaultValue={t.dueDate?.slice(0, 10)} onBlur={(e) => e.target.value !== t.dueDate?.slice(0, 10) && update.mutate({ dueDate: e.target.value ? new Date(`${e.target.value}T12:00:00Z`).toISOString() : null })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="task-priority">Priority</Label>
                  <Select value={t.priority} onValueChange={(v) => update.mutate({ priority: v })}>
                    <SelectTrigger id="task-priority" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["low", "medium", "high", "urgent"].map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
