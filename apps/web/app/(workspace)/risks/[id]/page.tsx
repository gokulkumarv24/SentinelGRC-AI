"use client";

import { AiAssist } from "@/components/ai/ai-assist";
import { useQuery } from "@tanstack/react-query";
import { Link2, Pencil, Plus, ShieldCheck, Unlink } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { SeverityBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText } from "@/components/common/date-text";
import { LinkDialog } from "@/components/common/link-dialog";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { controlOption, evidenceOption } from "@/components/common/record-picker";
import { ErrorState, LoadingState } from "@/components/common/states";
import { RiskFormDialog } from "@/components/risks/risk-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { RiskDetail } from "@/lib/types";

export default function RiskDetailPage({ params }: PageProps<"/risks/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const { data: me } = useMe();
  const query = useQuery({ queryKey: ["risks", id], queryFn: () => api.get<RiskDetail>(`/risks/${id}`) });
  const invalidate = [["risks"]];
  const [effectiveness, setEffectiveness] = useState("not_assessed");
  const [expiry, setExpiry] = useState("");

  const linkControl = useApiMutation({
    mutationFn: (vars: { controlId: string; rationale: string }) => api.put(`/risks/${id}/controls`, { controlId: vars.controlId, effectivenessRating: effectiveness, rationale: vars.rationale || undefined }),
    success: "Control linked",
    invalidate,
  });
  const unlinkControl = useApiMutation({ mutationFn: (controlId: string) => api.delete(`/risks/${id}/controls/${controlId}`), success: "Control unlinked", invalidate });
  const linkEvidence = useApiMutation({
    mutationFn: (vars: { evidenceId: string; note: string }) => api.post(`/evidence/${vars.evidenceId}/links`, { entityType: "risk", entityId: id, relevanceNotes: vars.note || undefined }),
    success: "Evidence linked",
    invalidate,
  });
  const requestAcceptance = useApiMutation({
    mutationFn: (rationale: string) => api.post(`/risks/${id}/acceptance-requests`, { rationale, expiryDate: new Date(`${expiry}T12:00:00Z`).toISOString() }),
    success: "Acceptance requested. An approver has been notified.",
    invalidate,
  });
  const decide = useApiMutation({
    mutationFn: (vars: { acceptanceId: string; decision: "approved" | "rejected"; rationale: string }) => api.post(`/risk-acceptances/${vars.acceptanceId}/decision`, vars),
    success: (r: unknown) => `Acceptance ${(r as { decision: string }).decision}`,
    invalidate,
  });

  if (query.isPending) return <LoadingState rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const risk = query.data;
  const pending = risk.acceptances.find((a) => a.decision === "pending");

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Risk register", href: "/risks" }, { label: risk.riskKey }]}
        title={
          <span>
            <span className="font-mono text-base text-muted-foreground">{risk.riskKey}</span> {risk.title}
          </span>
        }
        meta={
          <>
            <StatusBadge status={risk.status} />
            <span className="text-xs text-muted-foreground">Source: {risk.sourceType.replace(/_/g, " ")}</span>
            <span className="text-xs text-muted-foreground">Scoring policy v{risk.scoringPolicyVersion}</span>
          </>
        }
        actions={can("risk.update") && <RiskFormDialog risk={risk} trigger={<Button variant="outline"><Pencil aria-hidden /> Edit</Button>} />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Description">
            <p className="text-sm whitespace-pre-wrap">{risk.description}</p>
          </Section>

          <Section title="Scores" description="Inherent and residual risk are assessed separately; residual factors must be justified by verified mitigations.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Inherent</p>
                <div className="mt-1 flex items-center gap-2">
                  <SeverityBadge severity={risk.inherentRating} score={risk.inherentScore} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Likelihood {risk.likelihood} × impact {risk.impact}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Residual</p>
                <div className="mt-1">{risk.residualRating ? <SeverityBadge severity={risk.residualRating} score={risk.residualScore} /> : <span className="text-sm text-muted-foreground">Not yet assessed</span>}</div>
                {risk.residualLikelihood && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Likelihood {risk.residualLikelihood} × impact {risk.residualImpact}
                  </p>
                )}
                {risk.residualRationale && <p className="mt-2 text-xs">{risk.residualRationale}</p>}
              </div>
            </div>
          </Section>

          <Section
            title="Mitigating controls"
            actions={
              can("risk.update") && (
                <LinkDialog
                  trigger={<Button size="sm" variant="outline"><Link2 aria-hidden /> Link control</Button>}
                  title="Link a control"
                  description="Record how this control relates to the risk and how effective it currently is."
                  endpoint="/controls"
                  toOption={controlOption}
                  noteLabel="Rationale"
                  onLink={(opt, note) => linkControl.mutateAsync({ controlId: opt.id, rationale: note })}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="effectiveness">Effectiveness</Label>
                    <Select value={effectiveness} onValueChange={setEffectiveness}>
                      <SelectTrigger id="effectiveness" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["not_assessed", "ineffective", "partially_effective", "effective"].map((v) => (
                          <SelectItem key={v} value={v}>
                            {v.replace(/_/g, " ")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </LinkDialog>
              )
            }
          >
            {risk.controls.length === 0 ? (
              <p className="text-sm text-muted-foreground">No controls linked. Link the controls that mitigate or detect this risk.</p>
            ) : (
              <ul className="divide-y">
                {risk.controls.map((c) => (
                  <li key={c.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link href={`/controls/${c.control.id}`} className="text-sm font-medium text-primary hover:underline">
                        <ShieldCheck className="mr-1 inline size-4" aria-hidden />
                        {c.control.controlCode} · {c.control.title}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {c.relationship} · <StatusBadge status={c.effectivenessRating} />
                      </p>
                      {c.rationale && <p className="mt-1 text-xs">{c.rationale}</p>}
                    </div>
                    {can("risk.update") && (
                      <Button size="icon-sm" variant="ghost" aria-label={`Unlink ${c.control.controlCode}`} onClick={() => unlinkControl.mutate(c.control.id)}>
                        <Unlink aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Findings" description="Findings linked to this risk.">
            {risk.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No linked findings.</p>
            ) : (
              <ul className="divide-y">
                {risk.findings.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/findings/${f.id}`} className="truncate text-primary hover:underline">
                      {f.findingKey} · {f.title}
                    </Link>
                    <span className="flex shrink-0 gap-1">
                      <SeverityBadge severity={f.severity} />
                      <StatusBadge status={f.status} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Evidence"
            actions={
              can("evidence.link") && (
                <LinkDialog
                  trigger={<Button size="sm" variant="outline"><Plus aria-hidden /> Link evidence</Button>}
                  title="Link evidence"
                  endpoint="/evidence"
                  toOption={evidenceOption}
                  noteLabel="Relevance notes"
                  onLink={(opt, note) => linkEvidence.mutateAsync({ evidenceId: opt.id, note })}
                />
              )
            }
          >
            {risk.evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">No evidence linked.</p>
            ) : (
              <ul className="divide-y">
                {risk.evidence.map((e) => (
                  <li key={e.linkId} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <Link href={`/evidence/${e.id}`} className="truncate text-primary hover:underline">
                      {e.title}
                    </Link>
                    <StatusBadge status={e.reviewStatus} />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="AI assistance">
            <AiAssist artifactType="risk_summary" targetId={risk.id} />
          </Section>

          <Section title="History" description="Every change to scores, owner, status and treatment.">
            {risk.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">No history.</p>
            ) : (
              <ol className="space-y-3">
                {risk.history.map((h) => (
                  <li key={h.id} className="rounded-md border p-2.5 text-xs">
                    <p className="text-muted-foreground">
                      <DateText value={h.changedAt} withTime />
                      {h.rationale && <span className="ml-2 italic text-foreground">“{h.rationale}”</span>}
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {Object.keys(h.newValues).map((k) => (
                        <li key={k}>
                          <span className="font-medium">{k}</span>: <span className="text-muted-foreground line-through">{String(h.previousValues[k] ?? "—")}</span> → {String(h.newValues[k] ?? "—")}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Category", value: risk.category },
                { label: "Owner", value: risk.owner?.displayName },
                { label: "Treatment", value: risk.treatment.replace(/_/g, " ") },
                { label: "Next review", value: <DateText value={risk.reviewDate} /> },
                { label: "Created", value: <DateText value={risk.createdAt} /> },
                { label: "Updated", value: <DateText value={risk.updatedAt} withTime /> },
              ]}
            />
            {risk.treatmentPlan && (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">Treatment plan</p>
                <p className="text-sm whitespace-pre-wrap">{risk.treatmentPlan}</p>
              </div>
            )}
          </Section>

          {risk.links.length > 0 && (
            <Section title="Linked records">
              <ul className="space-y-1 text-sm">
                {risk.links.map((l) => (
                  <li key={l.id}>
                    <span className="text-xs text-muted-foreground">{l.entityType.replace(/_/g, " ")}:</span> {l.label}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Risk acceptance" description="A request is not an approval. High and critical risks need a different approver.">
            {risk.status === "accepted" && (
              <p className="mb-3 rounded-md bg-info-bg p-2 text-xs text-info">
                Accepted until <DateText value={risk.acceptanceExpiresAt} />. {risk.acceptanceRationale}
              </p>
            )}
            {pending ? (
              <div className="space-y-2 rounded-md border p-3 text-sm">
                <p>
                  <StatusBadge status="pending" /> Requested by {pending.requestedByRef?.displayName} on <DateText value={pending.requestedAt} />
                </p>
                <p className="text-xs">Expires <DateText value={pending.expiryDate} /></p>
                <p className="text-xs whitespace-pre-wrap">{pending.rationale}</p>
                {can("risk.acceptance.decide") && pending.requestedBy !== me?.user.id && (
                  <div className="flex gap-2 pt-1">
                    <ConfirmDialog trigger={<Button size="sm">Approve</Button>} title="Approve risk acceptance" requireRationale confirmLabel="Approve" onConfirm={(rationale) => decide.mutateAsync({ acceptanceId: pending.id, decision: "approved", rationale })} />
                    <ConfirmDialog trigger={<Button size="sm" variant="outline">Reject</Button>} title="Reject risk acceptance" requireRationale destructive confirmLabel="Reject" onConfirm={(rationale) => decide.mutateAsync({ acceptanceId: pending.id, decision: "rejected", rationale })} />
                  </div>
                )}
              </div>
            ) : (
              can("risk.acceptance.request") &&
              risk.status !== "accepted" &&
              risk.status !== "closed" && (
                <ConfirmDialog
                  trigger={<Button size="sm" variant="outline">Request acceptance</Button>}
                  title="Request risk acceptance"
                  description="Explain why the residual risk should be accepted and until when. An authorized approver must decide."
                  requireRationale
                  confirmLabel="Submit request"
                  onConfirm={(rationale) => requestAcceptance.mutateAsync(rationale)}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="acceptance-expiry">Acceptance expires on</Label>
                    <Input id="acceptance-expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} required />
                  </div>
                </ConfirmDialog>
              )
            )}
            {risk.acceptances.filter((a) => a.decision !== "pending").length > 0 && (
              <ul className="mt-3 space-y-2 text-xs">
                {risk.acceptances
                  .filter((a) => a.decision !== "pending")
                  .map((a) => (
                    <li key={a.id} className="rounded border p-2">
                      <StatusBadge status={a.decision} /> <DateText value={a.decidedAt ?? a.requestedAt} />
                      {a.decidedByRef && <span> by {a.decidedByRef.displayName}</span>}
                      {a.decisionRationale && <p className="mt-1 italic">“{a.decisionRationale}”</p>}
                    </li>
                  ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
