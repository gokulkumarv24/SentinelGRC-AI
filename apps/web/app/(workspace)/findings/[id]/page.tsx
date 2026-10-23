"use client";

import { AiAssist, suggestionValue, type DraftOutput } from "@/components/ai/ai-assist";
import { useQuery } from "@tanstack/react-query";
import { Plus, Wand2 } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { SeverityBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText, DueDate } from "@/components/common/date-text";
import { LinkDialog } from "@/components/common/link-dialog";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { evidenceOption, RecordPicker, riskOption, type PickerOption } from "@/components/common/record-picker";
import { ErrorState, LoadingState } from "@/components/common/states";
import { UserSelect } from "@/components/common/user-select";
import { TaskFormDialog } from "@/components/remediation/task-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan, useDirectory } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { FindingDetail } from "@/lib/types";

/** Mirrors the API state machine to offer only valid next steps (the API re-validates). */
const NEXT: Record<string, string[]> = {
  open: ["triaged", "in_remediation", "closed", "accepted"],
  triaged: ["in_remediation", "pending_validation", "closed", "accepted"],
  in_remediation: ["pending_validation", "triaged", "accepted"],
  pending_validation: ["closed", "in_remediation"],
  closed: ["reopened"],
  accepted: ["reopened"],
  reopened: ["triaged", "in_remediation", "pending_validation", "closed", "accepted"],
};
const LABELS: Record<string, string> = { triaged: "Triage", in_remediation: "Start remediation", pending_validation: "Request validation", closed: "Close", accepted: "Accept risk", reopened: "Reopen" };

export default function FindingDetailPage({ params }: PageProps<"/findings/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const directory = useDirectory();
  const query = useQuery({ queryKey: ["findings", id], queryFn: () => api.get<FindingDetail>(`/findings/${id}`) });
  const [closureEvidence, setClosureEvidence] = useState<PickerOption | null>(null);
  const invalidate = [["findings"], ["remediation"], ["risks"], ["controls"]];
  const transition = useApiMutation({
    mutationFn: (vars: { toStatus: string; rationale: string }) => api.post(`/findings/${id}/transition`, { ...vars, closureEvidenceId: closureEvidence?.id, version: query.data?.version }),
    success: "Status updated",
    invalidate,
    onSuccess: () => setClosureEvidence(null),
  });
  const update = useApiMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/findings/${id}`, { ...body, version: query.data?.version }), success: "Finding updated", invalidate });
  const linkEvidence = useApiMutation({ mutationFn: (vars: { evidenceId: string; note: string }) => api.post(`/evidence/${vars.evidenceId}/links`, { entityType: "finding", entityId: id, relevanceNotes: vars.note || undefined }), success: "Evidence linked", invalidate });

  if (query.isPending) return <LoadingState rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const f = query.data;
  const done = f.status === "closed" || f.status === "accepted";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Findings", href: "/findings" }, { label: f.findingKey }]}
        title={<span><span className="font-mono text-base text-muted-foreground">{f.findingKey}</span> {f.title}</span>}
        meta={
          <>
            <SeverityBadge severity={f.severity} />
            <StatusBadge status={f.status} />
            <span className="text-xs text-muted-foreground">Source: {f.sourceType.replace(/_/g, " ")}</span>
            {f.detectionCount > 1 && <span className="text-xs text-muted-foreground">Detected {f.detectionCount} times</span>}
          </>
        }
        actions={
          can("finding.update") &&
          NEXT[f.status]
            ?.filter((s) => (s === "closed" || s === "accepted" ? can("finding.close") : true))
            .map((s) => (
              <ConfirmDialog
                key={s}
                trigger={<Button variant={s === "closed" ? "default" : "outline"} size="sm">{LABELS[s]}</Button>}
                title={`${LABELS[s]}: ${f.findingKey}`}
                description={s === "accepted" ? "Accepting requires a linked risk with an approved, unexpired acceptance." : s === "closed" ? "Closing requires a rationale and evidence of the fix (or a passing automated check)." : undefined}
                requireRationale
                confirmLabel={LABELS[s]}
                onConfirm={(rationale) => transition.mutateAsync({ toStatus: s, rationale })}
              >
                {s === "closed" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="closure-evidence">Closure evidence</Label>
                    <RecordPicker id="closure-evidence" endpoint="/evidence" toOption={evidenceOption} value={closureEvidence} onChange={setClosureEvidence} placeholder="Select evidence of the fix" />
                  </div>
                )}
              </ConfirmDialog>
            ))
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Description">
            <p className="text-sm whitespace-pre-wrap">{f.description}</p>
            {f.severityRationale && <p className="mt-3 text-xs text-muted-foreground">Severity rationale: {f.severityRationale}</p>}
            {f.closureRationale && (
              <p className="mt-3 rounded-md bg-ok-bg p-2 text-xs text-ok">
                Closed <DateText value={f.closedAt} />: {f.closureRationale}
              </p>
            )}
          </Section>

          <Section
            title="Remediation tasks"
            actions={can("remediation.create") && !done && <TaskFormDialog findingId={f.id} trigger={<Button size="sm" variant="outline"><Plus aria-hidden /> Add task</Button>} />}
          >
            {f.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No remediation tasks yet.</p>
            ) : (
              <ul className="divide-y">
                {f.tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/remediation/${t.id}`} className="text-primary hover:underline">
                      {t.title}
                    </Link>
                    <span className="flex items-center gap-2 text-xs">
                      {t.owner?.displayName ?? "Unassigned"} · <DueDate value={t.dueDate} done={t.status === "completed"} /> <StatusBadge status={t.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Evidence"
            actions={can("evidence.link") && <LinkDialog trigger={<Button size="sm" variant="outline"><Plus aria-hidden /> Link evidence</Button>} title="Link evidence" endpoint="/evidence" toOption={evidenceOption} noteLabel="Relevance notes" onLink={(o, note) => linkEvidence.mutateAsync({ evidenceId: o.id, note })} />}
          >
            {f.evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">No evidence linked.</p>
            ) : (
              <ul className="divide-y">
                {f.evidence.map((e) => (
                  <li key={e.linkId} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/evidence/${e.id}`} className="text-primary hover:underline">
                      {e.title}
                    </Link>
                    <StatusBadge status={e.reviewStatus} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {f.recentTests.length > 0 && (
            <Section title="Recent control test results" description="The rule outcome behind this automated finding.">
              <ul className="divide-y">
                {f.recentTests.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                    <span>{t.summary}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      <DateText value={t.startedAt} withTime /> <StatusBadge status={t.result} />
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="AI assistance" description="Advisory drafts. Severity and status change only through the normal, audited actions above.">
            <div className="space-y-4">
              <AiAssist
                artifactType="finding_triage"
                targetId={f.id}
                title="Triage (prepared by the AI agent)"
                labelFor={(value, label) => (label === "owner" ? (directory.data?.find((u) => u.id === value)?.displayName ?? value) : label === "linkRisk" ? (value === "none" ? "No related risk" : "Existing risk (see rationale)") : value)}
                actions={(o: DraftOutput) => {
                  const due = Number(suggestionValue(o, "dueInDays") ?? 30);
                  const owner = suggestionValue(o, "owner") ?? null;
                  const risk = suggestionValue(o, "linkRisk");
                  return (
                    <>
                      {can("finding.update") && (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={update.isPending}
                          onClick={() =>
                            update.mutate({
                              category: suggestionValue(o, "category")?.replace(/_/g, " "),
                              ...(owner && !f.assignedTo ? { assignedTo: owner } : {}),
                              ...(risk && risk !== "none" && !f.riskId ? { riskId: risk } : {}),
                              ...(!f.dueDate ? { dueDate: new Date(Date.now() + due * 86_400_000).toISOString() } : {}),
                            })
                          }
                        >
                          <Wand2 aria-hidden /> Apply triage
                        </Button>
                      )}
                      {can("remediation.create") && (
                        <TaskFormDialog
                          findingId={f.id}
                          defaults={{ title: suggestionValue(o, "remediationTitle") ?? "", description: suggestionValue(o, "remediationPlan") ?? "", ownerId: owner, priority: (suggestionValue(o, "priority") as "low" | "medium" | "high" | "urgent") ?? "medium" }}
                          dueInDays={due}
                          trigger={<Button size="xs" variant="outline"><Plus aria-hidden /> Create suggested remediation task</Button>}
                        />
                      )}
                    </>
                  );
                }}
              />
              <AiAssist artifactType="finding_draft" targetId={f.id} />
              <AiAssist artifactType="remediation_options" targetId={f.id} />
            </div>
          </Section>

          <Section title="Timeline">
            <ol className="relative space-y-3 border-l pl-4">
              {f.events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary" aria-hidden />
                  <p className="font-medium">
                    {e.eventType === "transition" ? (
                      <>
                        {e.fromStatus?.replace(/_/g, " ")} → {e.toStatus?.replace(/_/g, " ")}
                      </>
                    ) : (
                      e.eventType.replace(/_/g, " ")
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    <DateText value={e.createdAt} withTime />
                  </p>
                  {e.rationale && <p className="mt-0.5 text-xs">{e.rationale}</p>}
                </li>
              ))}
            </ol>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Assignee", value: f.assignee?.displayName },
                { label: "Due date", value: f.dueDate ? <DueDate value={f.dueDate} done={done} /> : f.noDueDateReason ?? "—" },
                { label: "Control", value: f.control && <Link className="text-primary hover:underline" href={`/controls/${f.control.id}`}>{f.control.controlCode} · {f.control.title}</Link> },
                { label: "Risk", value: f.risk && <Link className="text-primary hover:underline" href={`/risks/${f.risk.id}`}>{f.risk.riskKey} · {f.risk.title}</Link> },
                { label: "First detected", value: <DateText value={f.firstDetectedAt} withTime /> },
                { label: "Last detected", value: <DateText value={f.lastDetectedAt} withTime /> },
              ]}
            />
          </Section>
          {can("finding.update") && !done && (
            <Section title="Assignment">
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="assignee">Assignee</Label>
                  <UserSelect id="assignee" value={f.assignedTo} onChange={(v) => update.mutate({ assignedTo: v })} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="risk-link">Linked risk</Label>
                  <RecordPicker id="risk-link" endpoint="/risks" toOption={riskOption} value={f.risk ? riskOption(f.risk) : null} onChange={(o) => update.mutate({ riskId: o?.id ?? null })} placeholder="Link to a risk" />
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
