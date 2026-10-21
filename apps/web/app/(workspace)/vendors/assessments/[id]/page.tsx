"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, Paperclip, Save, Send, Undo2 } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { humanize, SeverityBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText, DueDate } from "@/components/common/date-text";
import { AuditTimeline } from "@/components/common/history";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { evidenceOption, RecordPicker } from "@/components/common/record-picker";
import { ErrorState, LoadingState } from "@/components/common/states";
import { byCategory, isVisible, QuestionInput, type AnswerDraft, type QuestionView } from "@/components/vendors/question-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { AuditEvent, Severity } from "@/lib/types";

interface Response {
  questionId: string;
  answer: unknown;
  notApplicable: boolean;
  naRationale: string | null;
  comments: string | null;
  evidenceId: string | null;
  reviewerStatus: "pending" | "accepted" | "insufficient" | "rejected";
  reviewerNotes: string | null;
  answeredBy: string | null;
}
interface Breakdown {
  inherentFactors: Array<{ factor: string; value: string | number; contribution: number }>;
  categories: Array<{ category: string; effectiveness: number; weight: number }>;
  questions: Array<{ questionKey: string; outcome: string; credit: number | null; weight: number }>;
  assumptions: string[];
}
interface Assessment {
  id: string;
  status: string;
  assessmentVersion: number;
  dueDate: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  decision: string | null;
  decisionRationale: string | null;
  internalNotes: string | null;
  inherentRisk: number | null;
  residualRisk: number | null;
  riskTier: Severity | null;
  scoreBreakdown: Breakdown | null;
  scoringPolicyVersion: number | null;
  reportStatus: string;
  assessorId: string | null;
  assessorRef: { displayName: string } | null;
  vendor: { id: string; name: string; criticality: Severity };
  templateRef: { name: string; version: number };
  questions: Array<QuestionView & { weight: number; important: boolean; response: Response | null }>;
  scorePreview: { inherentScore: number; residualScore: number; tier: Severity; controlEffectiveness: number; breakdown: Breakdown } | null;
  invitations: Array<{ id: string; contactEmail: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null }>;
  findings: Array<{ id: string; findingKey: string; title: string; severity: Severity; status: string }>;
  history: AuditEvent[];
}

const OUTCOME_LABEL: Record<string, string> = {
  met: "Meets criterion",
  met_evidence_missing: "Met, evidence missing",
  met_insufficient: "Met, awaiting/insufficient review",
  not_met: "Does not meet",
  unanswered: "Unanswered",
  rejected: "Rejected by reviewer",
  not_applicable: "Not applicable",
  na_needs_review: "N/A needs accepted rationale",
  informational: "Informational",
};

function ScoreBreakdown({ title, score }: { title: string; score: { inherent: number; residual: number; tier: Severity; effectiveness: number; breakdown: Breakdown; policy?: number | null } }) {
  return (
    <Section title={title} description="Deterministic scoring from reviewed answers. AI summaries never change these numbers.">
      <div className="flex flex-wrap items-center gap-3">
        <SeverityBadge severity={score.tier} score={score.residual} />
        <span className="text-xs text-muted-foreground">
          inherent {score.inherent} · control effectiveness {Math.round(score.effectiveness * 100)}%{score.policy ? ` · policy v${score.policy}` : ""}
        </span>
      </div>
      <table className="mt-3 w-full text-xs">
        <caption className="sr-only">Effectiveness by category</caption>
        <tbody className="divide-y">
          {score.breakdown.categories.map((c) => (
            <tr key={c.category}>
              <th scope="row" className="py-1 text-left font-normal">{humanize(c.category)}</th>
              <td className="py-1 text-right tabular-nums">{Math.round(c.effectiveness * 100)}%</td>
              <td className="py-1 pl-2 text-right text-muted-foreground tabular-nums">weight {c.weight}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-3 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
        {score.breakdown.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </Section>
  );
}

export default function AssessmentPage({ params }: PageProps<"/vendors/assessments/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const query = useQuery({ queryKey: ["assessments", id], queryFn: () => api.get<Assessment>(`/assessments/${id}`) });
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [dirty, setDirty] = useState(false);
  const [reviews, setReviews] = useState<Record<string, { reviewerStatus: Response["reviewerStatus"]; reviewerNotes: string }>>({});
  const [notes, setNotes] = useState<string | null>(null);
  const [decision, setDecision] = useState("approved_with_conditions");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const a = query.data;
  // Re-initialise local drafts whenever fresh server data arrives (no effect needed).
  const [loaded, setLoaded] = useState<Assessment | undefined>(undefined);
  if (a && a !== loaded) {
    setLoaded(a);
    setDrafts(Object.fromEntries(a.questions.filter((q) => q.response).map((q) => [q.id, { answer: q.response!.answer, notApplicable: q.response!.notApplicable, naRationale: q.response!.naRationale, comments: q.response!.comments, evidenceId: q.response!.evidenceId }])));
    setReviews(Object.fromEntries(a.questions.filter((q) => q.response).map((q) => [q.id, { reviewerStatus: q.response!.reviewerStatus, reviewerNotes: q.response!.reviewerNotes ?? "" }])));
    setDirty(false);
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const invalidate = [["assessments"], ["vendors"], ["findings"], ["risks"]];
  const save = useApiMutation({
    mutationFn: () => api.post(`/assessments/${id}/responses`, { responses: Object.entries(drafts).map(([questionId, d]) => ({ questionId, ...d, answer: d.notApplicable ? undefined : d.answer })) }),
    success: "Answers saved",
    invalidate,
    onSuccess: () => setDirty(false),
  });
  const submit = useApiMutation({ mutationFn: () => api.post<{ evidenceGaps: string[] }>(`/assessments/${id}/submit`), success: (r) => (r.evidenceGaps.length ? `Submitted with ${r.evidenceGaps.length} evidence gap(s)` : "Submitted for review"), invalidate });
  const saveReviews = useApiMutation({ mutationFn: () => api.post(`/assessments/${id}/review`, { reviews: Object.entries(reviews).map(([questionId, r]) => ({ questionId, reviewerStatus: r.reviewerStatus, reviewerNotes: r.reviewerNotes || null })) }), success: "Review saved", invalidate });
  const returnIt = useApiMutation({ mutationFn: (message: string) => api.post(`/assessments/${id}/return`, { message }), success: "Returned for clarification", invalidate });
  const decide = useApiMutation({ mutationFn: (rationale: string) => api.post<{ findingsCreated: number; tier: string }>(`/assessments/${id}/decision`, { decision, rationale }), success: (r) => `Decision recorded · residual tier ${r.tier} · ${r.findingsCreated} finding(s) created`, invalidate });
  const saveNotes = useApiMutation({ mutationFn: () => api.put(`/assessments/${id}/internal-notes`, { internalNotes: notes ?? "" }), success: "Internal notes saved", invalidate });
  const invite = useApiMutation({ mutationFn: () => api.post<{ portalUrl: string }>(`/assessments/${id}/invitations`, { contactEmail: inviteEmail }), success: "Portal link created", invalidate, onSuccess: (r) => setInviteLink(r.portalUrl) });
  const revoke = useApiMutation({ mutationFn: (invId: string) => api.delete(`/assessments/${id}/invitations/${invId}`), success: "Link revoked", invalidate });

  const visibleQs = useMemo(() => (a ? a.questions.filter((q) => isVisible(q, a.questions, drafts)) : []), [a, drafts]);
  if (query.isPending) return <LoadingState rows={10} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const assessment = a!;
  const editable = ["draft", "returned_for_clarification"].includes(assessment.status) && can("vendor_assessment.manage");
  const reviewing = ["submitted", "under_review"].includes(assessment.status);
  const decided = !!assessment.decision;
  const outcomes = new Map((assessment.scorePreview?.breakdown ?? assessment.scoreBreakdown)?.questions.map((q) => [q.questionKey, q.outcome]) ?? []);
  const pendingReviews = visibleQs.filter((q) => q.response && reviews[q.id]?.reviewerStatus === "pending").length;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Assessments", href: "/vendors/assessments" }, { label: `${assessment.vendor.name} v${assessment.assessmentVersion}` }]}
        title={`${assessment.vendor.name} — security assessment v${assessment.assessmentVersion}`}
        meta={
          <>
            <StatusBadge status={assessment.status} />
            {assessment.decision && <StatusBadge status={assessment.decision} />}
            <span className="text-xs text-muted-foreground">
              {assessment.templateRef.name} v{assessment.templateRef.version} · report {assessment.reportStatus}
            </span>
          </>
        }
        actions={
          <>
            {editable && (
              <>
                <Button variant="outline" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                  <Save aria-hidden /> Save answers
                </Button>
                <ConfirmDialog trigger={<Button disabled={dirty}><Send aria-hidden /> Submit</Button>} title="Submit for review" description="Answers are locked once submitted and the questionnaire version is frozen." confirmLabel="Submit" onConfirm={() => submit.mutateAsync()} />
              </>
            )}
            {reviewing && can("vendor_assessment.review") && (
              <ConfirmDialog trigger={<Button variant="outline"><Undo2 aria-hidden /> Return for clarification</Button>} title="Return for clarification" requireRationale rationaleLabel="Message to the vendor" confirmLabel="Return" onConfirm={(m) => returnIt.mutateAsync(m)} />
            )}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {byCategory(visibleQs).map(([category, qs]) => (
            <Section key={category} title={humanize(category)}>
              <ol className="space-y-5">
                {qs.map((q) => {
                  const d = drafts[q.id] ?? {};
                  const r = reviews[q.id];
                  const outcome = outcomes.get(q.questionKey);
                  return (
                    <li key={q.id} className="rounded-md border p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{q.questionKey}</span>
                        <span>weight {q.weight}</span>
                        {q.important && <StatusBadge status="pending" label="Important" />}
                        {q.evidenceRequired && <span className="inline-flex items-center gap-1"><Paperclip className="size-3" aria-hidden /> evidence required</span>}
                        {outcome && <span className="ml-auto">{OUTCOME_LABEL[outcome] ?? outcome}</span>}
                      </div>
                      {editable ? (
                        <>
                          <QuestionInput q={q} value={d} onChange={(v) => { setDrafts({ ...drafts, [q.id]: v }); setDirty(true); }} />
                          <div className="mt-2 space-y-1">
                            <Label className="text-xs">Supporting evidence</Label>
                            <RecordPicker endpoint="/evidence" toOption={evidenceOption} value={d.evidenceId ? { id: d.evidenceId, label: "Attached evidence" } : null} onChange={(o) => { setDrafts({ ...drafts, [q.id]: { ...d, evidenceId: o?.id ?? null } }); setDirty(true); }} placeholder="Attach from the evidence library" />
                          </div>
                        </>
                      ) : (
                        <div className="text-sm">
                          <p className="font-medium">{q.questionText}</p>
                          <p className="mt-1">
                            {q.response ? (q.response.notApplicable ? <span className="italic">Not applicable — {q.response.naRationale}</span> : <span>{Array.isArray(q.response.answer) ? (q.response.answer as string[]).join(", ") : q.response.answer === true ? "Yes" : q.response.answer === false ? "No" : String(q.response.answer ?? "—")}</span>) : <span className="text-muted-foreground">Not answered</span>}
                          </p>
                          {q.response?.comments && <p className="text-xs text-muted-foreground">Comment: {q.response.comments}</p>}
                          {q.response?.evidenceId && <Link href={`/evidence/${q.response.evidenceId}`} className="text-xs text-primary hover:underline">View evidence</Link>}
                          {q.response?.answeredBy?.startsWith("vendor:") && <p className="text-xs text-muted-foreground">Answered by the vendor via portal</p>}
                        </div>
                      )}
                      {q.response && (reviewing || decided) && r && (
                        <div className="mt-3 grid gap-2 rounded-md bg-muted/50 p-2 sm:grid-cols-[180px_1fr]">
                          <Select value={r.reviewerStatus} disabled={!reviewing || !can("vendor_assessment.review")} onValueChange={(v) => setReviews({ ...reviews, [q.id]: { ...r, reviewerStatus: v as Response["reviewerStatus"] } })}>
                            <SelectTrigger className="h-8" aria-label="Reviewer assessment">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {["pending", "accepted", "insufficient", "rejected"].map((s) => (
                                <SelectItem key={s} value={s}>
                                  {humanize(s)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input className="h-8" placeholder="Internal reviewer note (never shown to the vendor)" value={r.reviewerNotes} disabled={!reviewing || !can("vendor_assessment.review")} onChange={(e) => setReviews({ ...reviews, [q.id]: { ...r, reviewerNotes: e.target.value } })} aria-label="Reviewer note" />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </Section>
          ))}
          {reviewing && can("vendor_assessment.review") && (
            <div className="sticky bottom-4 flex items-center justify-between gap-2 rounded-lg border bg-card p-3 shadow-sm">
              <span className="text-sm">{pendingReviews} answer(s) still pending review</span>
              <Button onClick={() => saveReviews.mutate()} disabled={saveReviews.isPending}>
                Save review
              </Button>
            </div>
          )}
          <Section title="History">
            <AuditTimeline events={assessment.history} />
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Vendor", value: <Link className="text-primary hover:underline" href={`/vendors/${assessment.vendor.id}`}>{assessment.vendor.name}</Link> },
                { label: "Assessor", value: assessment.assessorRef?.displayName },
                { label: "Due", value: <DueDate value={assessment.dueDate} done={decided} /> },
                { label: "Submitted", value: <DateText value={assessment.submittedAt} withTime /> },
              ]}
            />
          </Section>
          {assessment.scorePreview && (
            <ScoreBreakdown title="Score preview" score={{ inherent: assessment.scorePreview.inherentScore, residual: assessment.scorePreview.residualScore, tier: assessment.scorePreview.tier, effectiveness: assessment.scorePreview.controlEffectiveness, breakdown: assessment.scorePreview.breakdown }} />
          )}
          {decided && assessment.scoreBreakdown && assessment.riskTier && (
            <ScoreBreakdown title="Final score" score={{ inherent: assessment.inherentRisk ?? 0, residual: assessment.residualRisk ?? 0, tier: assessment.riskTier, effectiveness: 0, breakdown: assessment.scoreBreakdown, policy: assessment.scoringPolicyVersion }} />
          )}
          {decided && (
            <Section title="Decision">
              <p className="text-sm">
                <StatusBadge status={assessment.decision} /> on <DateText value={assessment.decidedAt} />
              </p>
              <p className="mt-2 text-sm whitespace-pre-wrap">{assessment.decisionRationale}</p>
            </Section>
          )}
          {reviewing && can("vendor_assessment.decide") && (
            <Section title="Decision" description="High residual risk requires conditions or rejection, and a decider other than the assessor.">
              <div className="space-y-2">
                <Select value={decision} onValueChange={setDecision}>
                  <SelectTrigger className="w-full" aria-label="Decision">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approved">Approve</SelectItem>
                    <SelectItem value="approved_with_conditions">Approve with conditions</SelectItem>
                    <SelectItem value="rejected">Reject</SelectItem>
                  </SelectContent>
                </Select>
                <ConfirmDialog trigger={<Button className="w-full" disabled={pendingReviews > 0}>Record decision</Button>} title={`${humanize(decision)}: ${assessment.vendor.name}`} description="Findings are created for failed or unsupported answers, and a shared risk for high residual risk." requireRationale confirmLabel="Record decision" onConfirm={(r) => decide.mutateAsync(r)} />
                {pendingReviews > 0 && <p className="text-xs text-muted-foreground">Review every answer first.</p>}
              </div>
            </Section>
          )}
          {assessment.findings.length > 0 && (
            <Section title="Findings from this assessment">
              <ul className="divide-y">
                {assessment.findings.map((f) => (
                  <li key={f.id} className="py-2 text-sm">
                    <Link href={`/findings/${f.id}`} className="text-primary hover:underline">{f.findingKey}</Link> {f.title}
                    <span className="mt-1 flex gap-1"><SeverityBadge severity={f.severity} /><StatusBadge status={f.status} /></span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {can("vendor_assessment.review") && (
            <Section title="Internal notes" description="Visible only inside your organization.">
              <Textarea rows={4} value={notes ?? assessment.internalNotes ?? ""} onChange={(e) => setNotes(e.target.value)} aria-label="Internal notes" />
              <Button className="mt-2" size="sm" variant="outline" onClick={() => saveNotes.mutate()} disabled={notes === null || saveNotes.isPending}>
                Save notes
              </Button>
            </Section>
          )}
          {can("vendor_portal.manage") && (
            <Section title="Vendor portal" description="One-time links let the vendor answer this questionnaire only. Links expire after 14 days.">
              {editable && (
                <form method="post" className="flex gap-2" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
                  <Input type="email" placeholder="vendor contact email" aria-label="Vendor contact email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                  <Button type="submit" variant="outline" disabled={!inviteEmail || invite.isPending}>
                    Create link
                  </Button>
                </form>
              )}
              {inviteLink && (
                <div className="mt-2 flex gap-2">
                  <Input readOnly value={inviteLink} aria-label="Portal link" />
                  <Button variant="outline" aria-label="Copy link" onClick={async () => { await navigator.clipboard.writeText(inviteLink); toast.success("Copied — shown only once"); }}>
                    <Copy aria-hidden />
                  </Button>
                </div>
              )}
              <ul className="mt-3 divide-y text-xs">
                {assessment.invitations.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span>
                      {i.contactEmail} · {i.revokedAt ? "revoked" : <>expires <DateText value={i.expiresAt} /></>}
                      {i.lastUsedAt && <> · used <DateText value={i.lastUsedAt} relative /></>}
                    </span>
                    {!i.revokedAt && (
                      <Button size="xs" variant="ghost" onClick={() => revoke.mutate(i.id)}>
                        Revoke
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
