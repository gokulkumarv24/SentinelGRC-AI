"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleX, FilePlus2, Pencil, Rocket } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { AiSystemFormDialog, type AiSystemRecord } from "@/components/ai/ai-system-form";
import { humanize, SeverityBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText, DueDate } from "@/components/common/date-text";
import { AuditTimeline } from "@/components/common/history";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { AuditEvent, Severity } from "@/lib/types";

interface Detail extends AiSystemRecord {
  lifecycleStatus: string;
  riskTier: string;
  approvedAt: string | null;
  deploymentDate: string | null;
  isDemo: boolean;
  businessOwner: { displayName: string } | null;
  technicalOwner: { displayName: string } | null;
  riskOwner: { displayName: string } | null;
  providerVendor: { id: string; name: string; riskTier: Severity | null; status: string } | null;
  assessments: Array<{ id: string; status: string; assessmentVersion: number; riskTier: string; submittedAt: string | null; approvedAt: string | null; createdAt: string }>;
  evaluations: Array<{ id: string; evaluationType: string; methodology: string; version: string; result: string; limitations: string; executedAt: string; approvalStatus: string; metrics: Record<string, unknown> }>;
  incidents: Array<{ id: string; title: string; severity: Severity; status: string; detectedAt: string; findingId: string | null; rootCause: string | null }>;
  changes: Array<{ id: string; changeType: string; changeDescription: string; previousVersion: string | null; newVersion: string | null; changeRisk: Severity; reviewStatus: string; createdAt: string }>;
  euAiAct: { organizationRole: string | null; preliminaryClassification: string; legalReviewStatus: string; potentialProhibitedPractice: boolean | null; potentialHighRisk: boolean | null; transparencyObligations: boolean | null; rationale: string | null; reviewDate: string | null; sourceUrl: string | null } | null;
  risks: Array<{ id: string; riskKey: string; title: string; inherentRating: Severity; residualRating: Severity | null; status: string }>;
  findings: Array<{ id: string; findingKey: string; title: string; severity: Severity; status: string }>;
  evidence: Array<{ linkId: string; id: string; title: string; reviewStatus: string }>;
  history: AuditEvent[];
  allowedTransitions: string[];
  deploymentReadiness: { ready: boolean; checks: Array<{ key: string; label: string; ok: boolean }> };
}

function Readiness({ system }: { system: Detail }) {
  const can = useCan();
  const [target, setTarget] = useState<"pilot" | "production">(["pilot", "approved_for_pilot"].includes(system.lifecycleStatus) ? "production" : "pilot");
  const [nextReview, setNextReview] = useState("");
  const approve = useApiMutation({
    mutationFn: (rationale: string) => api.post(`/ai-systems/${system.id}/approve-deployment`, { target, rationale, nextReviewAt: new Date(`${nextReview}T12:00:00Z`).toISOString() }),
    success: "Deployment approved",
    invalidate: [["ai-systems"]],
  });
  const r = system.deploymentReadiness;
  return (
    <Section title="Deployment readiness" description="Every condition below must hold before an authorized approver (not the requester) can approve pilot or production use.">
      <ul className="space-y-1.5">
        {r.checks.map((c) => (
          <li key={c.key} className="flex items-center gap-2 text-sm">
            {c.ok ? <CheckCircle2 className="size-4 text-ok" aria-label="Met" /> : <CircleX className="size-4 text-sev-critical" aria-label="Not met" />}
            {c.label}
          </li>
        ))}
      </ul>
      {can("ai_assessment.decide") && !["production", "retired", "approved_for_production"].includes(system.lifecycleStatus) && (
        <ConfirmDialog
          trigger={<Button className="mt-3" disabled={!r.ready}><Rocket aria-hidden /> Approve deployment</Button>}
          title="Approve AI deployment"
          description="Records your approval, the rationale and the next review date in the audit trail."
          requireRationale
          confirmLabel="Approve"
          onConfirm={(rationale) => approve.mutateAsync(rationale)}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="target">Approve for</Label>
              <Select value={target} onValueChange={(v) => setTarget(v as "pilot" | "production")}>
                <SelectTrigger id="target" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pilot">Pilot</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="next-review">Next review</Label>
              <Input id="next-review" type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} />
            </div>
          </div>
        </ConfirmDialog>
      )}
    </Section>
  );
}

function EuAiActForm({ system }: { system: Detail }) {
  const can = useCan();
  const schedule = useQuery({ queryKey: ["ai", "eu-schedule"], queryFn: () => api.get<{ schedule: { checkedAt: string; sources: string[]; items: Array<{ key: string; label: string; appliesFrom: string; provision: string }> } | null }>("/ai-systems/eu-ai-act-schedule") });
  const e = system.euAiAct;
  const [form, setForm] = useState({
    organizationRole: e?.organizationRole ?? "unknown",
    preliminaryClassification: e?.preliminaryClassification ?? "undetermined",
    legalReviewStatus: e?.legalReviewStatus ?? "preliminary",
    potentialProhibitedPractice: !!e?.potentialProhibitedPractice,
    potentialHighRisk: !!e?.potentialHighRisk,
    transparencyObligations: !!e?.transparencyObligations,
    rationale: e?.rationale ?? "",
  });
  const save = useApiMutation({
    mutationFn: () => api.put(`/ai-systems/${system.id}/eu-ai-act`, { ...form, checklist: { prohibited: form.potentialProhibitedPractice, highRisk: form.potentialHighRisk, transparency: form.transparencyObligations }, sourceUrl: "https://eur-lex.europa.eu/eli/reg/2024/1689/oj", sourceCheckedAt: schedule.data?.schedule?.checkedAt ? new Date(schedule.data.schedule.checkedAt).toISOString() : undefined }),
    success: "Applicability record saved (preliminary)",
    invalidate: [["ai-systems"]],
  });
  const flag = (key: "potentialProhibitedPractice" | "potentialHighRisk" | "transparencyObligations", label: string) => (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <Checkbox checked={form[key]} disabled={!can("ai_assessment.manage")} onCheckedChange={(c) => setForm({ ...form, [key]: !!c })} />
      {label}
    </label>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="Applicability checklist" description="A tracking record, not a legal verdict. Results stay preliminary until a qualified legal or compliance professional reviews them.">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="role">Our role</Label>
              <Select value={form.organizationRole} onValueChange={(v) => setForm({ ...form, organizationRole: v })} disabled={!can("ai_assessment.manage")}>
                <SelectTrigger id="role" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["provider", "deployer", "importer", "distributor", "unknown"].map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cls">Preliminary classification</Label>
              <Select value={form.preliminaryClassification} onValueChange={(v) => setForm({ ...form, preliminaryClassification: v })} disabled={!can("ai_assessment.manage")}>
                <SelectTrigger id="cls" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["minimal", "limited", "high", "unacceptable", "undetermined"].map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {flag("potentialProhibitedPractice", "May fall under a prohibited practice (Art. 5)")}
          {flag("potentialHighRisk", "May be high-risk (Art. 6 / Annex III or Annex I)")}
          {flag("transparencyObligations", "Transparency obligations may apply (Art. 50)")}
          <div className="space-y-1.5">
            <Label htmlFor="eu-rationale">Rationale and assumptions</Label>
            <Textarea id="eu-rationale" rows={3} value={form.rationale} onChange={(ev) => setForm({ ...form, rationale: ev.target.value })} disabled={!can("ai_assessment.manage")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="legal">Legal review status</Label>
            <Select value={form.legalReviewStatus} onValueChange={(v) => setForm({ ...form, legalReviewStatus: v })} disabled={!can("ai_assessment.manage")}>
              <SelectTrigger id="legal" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["not_started", "preliminary", "under_legal_review", "reviewed"].map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {can("ai_assessment.manage") && <Button onClick={() => save.mutate()} disabled={save.isPending}>Save applicability record</Button>}
          {e?.reviewDate && <p className="text-xs text-muted-foreground">Last updated <DateText value={e.reviewDate} />.</p>}
        </div>
      </Section>
      <Section title="Obligation schedule" description={schedule.data?.schedule ? `Configurable dates, checked ${schedule.data.schedule.checkedAt}. Verify against EUR-Lex before relying on them.` : undefined}>
        {schedule.data?.schedule ? (
          <ul className="space-y-2 text-xs">
            {schedule.data.schedule.items.map((i) => (
              <li key={i.key}>
                <p className="font-medium">{i.label}</p>
                <p className="text-muted-foreground">From <DateText value={i.appliesFrom} /> · {i.provision}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">EU AI Act reference data is not loaded.</p>
        )}
      </Section>
    </div>
  );
}

function RecordDialogs({ system }: { system: Detail }) {
  const can = useCan();
  const inv = [["ai-systems"]];
  const [incident, setIncident] = useState({ title: "", severity: "medium", description: "" });
  const [change, setChange] = useState({ changeType: "model_version", changeDescription: "", newVersion: "", changeRisk: "medium" });
  const [evaluation, setEvaluation] = useState({ evaluationType: "security", methodology: "", datasetOrMethodDescription: "", version: "1", result: "pass", limitations: "" });
  const reportIncident = useApiMutation({ mutationFn: () => api.post(`/ai-systems/${system.id}/incidents`, { ...incident, detectedAt: new Date().toISOString() }), success: "Incident recorded", invalidate: inv });
  const recordChange = useApiMutation({ mutationFn: () => api.post(`/ai-systems/${system.id}/changes`, { ...change, newVersion: change.newVersion || null, requiresReassessment: true }), success: "Change recorded; reassessment flagged", invalidate: inv });
  const recordEval = useApiMutation({ mutationFn: () => api.post(`/ai-systems/${system.id}/evaluations`, { ...evaluation, metrics: {}, executedAt: new Date().toISOString() }), success: "Evaluation recorded", invalidate: inv });
  return (
    <div className="flex flex-wrap gap-2">
      {can("ai_evaluation.manage") && (
        <ConfirmDialog trigger={<Button size="sm" variant="outline">Record evaluation</Button>} title="Record an evaluation" description="Document the methodology and limitations; an evaluation without methodology is not meaningful." confirmLabel="Record" onConfirm={() => recordEval.mutateAsync()}>
          <div className="space-y-2">
            <Select value={evaluation.evaluationType} onValueChange={(v) => setEvaluation({ ...evaluation, evaluationType: v })}>
              <SelectTrigger className="w-full" aria-label="Evaluation type"><SelectValue /></SelectTrigger>
              <SelectContent>{["security", "quality_reliability", "fairness", "privacy", "explainability", "human_review", "drift_monitoring"].map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}</SelectContent>
            </Select>
            <Textarea placeholder="Methodology" aria-label="Methodology" rows={2} value={evaluation.methodology} onChange={(e) => setEvaluation({ ...evaluation, methodology: e.target.value })} />
            <Textarea placeholder="Dataset or method description" aria-label="Dataset" rows={2} value={evaluation.datasetOrMethodDescription} onChange={(e) => setEvaluation({ ...evaluation, datasetOrMethodDescription: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Version" aria-label="Version" value={evaluation.version} onChange={(e) => setEvaluation({ ...evaluation, version: e.target.value })} />
              <Select value={evaluation.result} onValueChange={(v) => setEvaluation({ ...evaluation, result: v })}>
                <SelectTrigger aria-label="Result"><SelectValue /></SelectTrigger>
                <SelectContent>{["pass", "fail", "inconclusive", "informational"].map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Textarea placeholder="Limitations (required)" aria-label="Limitations" rows={2} value={evaluation.limitations} onChange={(e) => setEvaluation({ ...evaluation, limitations: e.target.value })} />
          </div>
        </ConfirmDialog>
      )}
      {can("ai_incident.manage") && (
        <ConfirmDialog trigger={<Button size="sm" variant="outline">Report incident</Button>} title="Report an AI incident" description="High and critical incidents create a finding automatically." confirmLabel="Report" onConfirm={() => reportIncident.mutateAsync()}>
          <div className="space-y-2">
            <Input placeholder="Title" aria-label="Incident title" value={incident.title} onChange={(e) => setIncident({ ...incident, title: e.target.value })} />
            <Select value={incident.severity} onValueChange={(v) => setIncident({ ...incident, severity: v })}>
              <SelectTrigger className="w-full" aria-label="Severity"><SelectValue /></SelectTrigger>
              <SelectContent>{["low", "medium", "high", "critical"].map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}</SelectContent>
            </Select>
            <Textarea placeholder="What happened?" aria-label="Description" rows={3} value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })} />
          </div>
        </ConfirmDialog>
      )}
      {can("ai_change.manage") && (
        <ConfirmDialog trigger={<Button size="sm" variant="outline">Record change</Button>} title="Record a model, provider or purpose change" description="The system is flagged for reassessment and the change must be reviewed by someone else." confirmLabel="Record" onConfirm={() => recordChange.mutateAsync()}>
          <div className="space-y-2">
            <Select value={change.changeType} onValueChange={(v) => setChange({ ...change, changeType: v })}>
              <SelectTrigger className="w-full" aria-label="Change type"><SelectValue /></SelectTrigger>
              <SelectContent>{["model_version", "provider", "intended_purpose", "data", "other"].map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}</SelectContent>
            </Select>
            <Textarea placeholder="Describe the change" aria-label="Change description" rows={3} value={change.changeDescription} onChange={(e) => setChange({ ...change, changeDescription: e.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="New version" aria-label="New version" value={change.newVersion} onChange={(e) => setChange({ ...change, newVersion: e.target.value })} />
              <Select value={change.changeRisk} onValueChange={(v) => setChange({ ...change, changeRisk: v })}>
                <SelectTrigger aria-label="Change risk"><SelectValue /></SelectTrigger>
                <SelectContent>{["low", "medium", "high", "critical"].map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}

export default function AiSystemPage({ params }: PageProps<"/ai-governance/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const router = useRouter();
  const query = useQuery({ queryKey: ["ai-systems", id], queryFn: () => api.get<Detail>(`/ai-systems/${id}`) });
  const templates = useQuery({ queryKey: ["questionnaires", "ai"], queryFn: () => api.get<Array<{ id: string; key: string; name: string; version: number }>>("/questionnaires", { purpose: "ai_system" }) });
  const [to, setTo] = useState("");
  const inv = [["ai-systems"]];
  const startAssessment = useApiMutation({ mutationFn: () => api.post<{ id: string }>(`/ai-systems/${id}/assessments`, { templateId: templates.data![0].id }), success: "Assessment started", invalidate: inv, onSuccess: (a) => router.push(`/ai-governance/assessments/${a.id}`) });
  const transition = useApiMutation({ mutationFn: (rationale: string) => api.post(`/ai-systems/${id}/transition`, { to, rationale }), success: "Lifecycle updated", invalidate: inv });
  const reviewChange = useApiMutation({ mutationFn: (v: { id: string; decision: string; notes: string }) => api.post(`/ai-model-changes/${v.id}/review`, { decision: v.decision, notes: v.notes }), success: "Change reviewed", invalidate: inv });
  const reviewEval = useApiMutation({ mutationFn: (v: { id: string; decision: string; notes: string }) => api.post(`/ai-evaluations/${v.id}/review`, { decision: v.decision, notes: v.notes }), success: "Evaluation reviewed", invalidate: inv });

  if (query.isPending) return <LoadingState rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const s = query.data;
  const openAssessment = s.assessments.find((a) => ["draft", "in_progress", "submitted"].includes(a.status));

  return (
    <>
      <PageHeader
        crumbs={[{ label: "AI inventory", href: "/ai-governance" }, { label: s.name }]}
        title={s.name}
        description={s.description}
        meta={
          <>
            <StatusBadge status={s.lifecycleStatus} />
            <span className="text-xs text-muted-foreground">Risk tier: {humanize(s.riskTier)}</span>
            {s.isDemo && <StatusBadge status="stale" label="Fictional demo system" />}
          </>
        }
        actions={
          <>
            {can("ai_system.update") && <AiSystemFormDialog system={s} trigger={<Button variant="outline"><Pencil aria-hidden /> Edit</Button>} />}
            {can("ai_assessment.manage") && (openAssessment ? (
              <Button asChild variant="outline"><Link href={`/ai-governance/assessments/${openAssessment.id}`}>Open assessment</Link></Button>
            ) : (
              <Button onClick={() => startAssessment.mutate()} disabled={!templates.data?.length || startAssessment.isPending}><FilePlus2 aria-hidden /> Start assessment</Button>
            ))}
          </>
        }
      />
      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="assessments">Assessments ({s.assessments.length})</TabsTrigger>
          <TabsTrigger value="monitoring">Evaluations & incidents</TabsTrigger>
          <TabsTrigger value="changes">Changes ({s.changes.length})</TabsTrigger>
          <TabsTrigger value="eu">EU AI Act</TabsTrigger>
          <TabsTrigger value="risk">Risks & findings</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <Section title="Purpose and ownership">
                <DetailList items={[
                  { label: "Business purpose", value: s.businessPurpose },
                  { label: "Justification", value: s.businessJustification },
                  { label: "Business owner", value: s.businessOwner?.displayName },
                  { label: "Technical owner", value: s.technicalOwner?.displayName },
                  { label: "Risk owner", value: s.riskOwner?.displayName },
                  { label: "Provider", value: s.providerVendor && <Link className="text-primary hover:underline" href={`/vendors/${s.providerVendor.id}`}>{s.providerVendor.name}</Link> },
                  { label: "Model", value: [s.modelName, s.modelVersion].filter(Boolean).join(" · ") || null },
                  { label: "Deployment", value: `${humanize(s.deploymentType)}${s.deploymentEnvironment ? ` · ${s.deploymentEnvironment}` : ""}` },
                ]} />
              </Section>
              <Section title="People and data">
                <DetailList items={[
                  { label: "Intended users", value: s.intendedUsers },
                  { label: "Affected people", value: s.affectedPeople },
                  { label: "Input data", value: s.inputDataCategories.join(", ") || null },
                  { label: "Output data", value: s.outputDataCategories.join(", ") || null },
                  { label: "Personal / sensitive data", value: `${s.personalDataProcessed ? "Personal" : "No personal"} · ${s.sensitiveDataProcessed ? "sensitive" : "no sensitive"}` },
                  { label: "Decisions about people", value: s.influencesDecisionsAboutPeople ? "Outputs influence decisions about people" : "No" },
                  { label: "Retention / location", value: [s.dataRetention, s.dataLocation].filter(Boolean).join(" · ") || null },
                ]} />
              </Section>
              <Section title="Oversight and limitations">
                <DetailList items={[
                  { label: "Human oversight", value: s.humanOversight },
                  { label: "Override and appeal", value: s.overrideAndAppeal },
                  { label: "Escalation", value: s.escalationPath },
                  { label: "Rollback plan", value: s.rollbackPlan },
                  { label: "Known limitations", value: s.knownLimitations },
                  { label: "Foreseeable misuse", value: s.foreseeableMisuse },
                ]} />
              </Section>
            </div>
            <div className="space-y-4">
              <Readiness system={s} />
              <Section title="Lifecycle">
                <DetailList items={[
                  { label: "Approved", value: <DateText value={s.approvedAt} /> },
                  { label: "Deployed", value: <DateText value={s.deploymentDate} /> },
                  { label: "Next review", value: <DueDate value={s.nextReviewAt} done={s.lifecycleStatus === "retired"} /> },
                ]} />
                {can("ai_system.lifecycle") && s.allowedTransitions.length > 0 && (
                  <div className="mt-3 flex gap-2">
                    <Select value={to} onValueChange={setTo}>
                      <SelectTrigger className="flex-1" aria-label="Move to"><SelectValue placeholder="Move to…" /></SelectTrigger>
                      <SelectContent>{s.allowedTransitions.map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}</SelectContent>
                    </Select>
                    <ConfirmDialog trigger={<Button variant="outline" disabled={!to}>Apply</Button>} title={`Move to ${humanize(to || "")}`} requireRationale confirmLabel="Confirm" onConfirm={(r) => transition.mutateAsync(r)} />
                  </div>
                )}
              </Section>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="assessments">
          <Section title="Risk assessments" description="Organized by NIST AI RMF function. An approved assessment is required before deployment.">
            {s.assessments.length === 0 ? <p className="text-sm text-muted-foreground">No assessments yet.</p> : (
              <ul className="divide-y">
                {s.assessments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/ai-governance/assessments/${a.id}`} className="text-primary hover:underline">Assessment v{a.assessmentVersion} · <DateText value={a.createdAt} /></Link>
                    <span className="flex gap-2"><span className="text-xs text-muted-foreground">tier {humanize(a.riskTier)}</span><StatusBadge status={a.status} /></span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="monitoring">
          <div className="mb-3"><RecordDialogs system={s} /></div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Evaluations" description="Method, dataset, limitations and independent approval.">
              {s.evaluations.length === 0 ? <p className="text-sm text-muted-foreground">No evaluations recorded.</p> : (
                <ul className="divide-y">
                  {s.evaluations.map((e) => (
                    <li key={e.id} className="py-2 text-sm">
                      <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{humanize(e.evaluationType)}</span> v{e.version} <StatusBadge status={e.result === "pass" ? "pass" : e.result === "fail" ? "fail" : "unknown"} label={e.result} /> <StatusBadge status={e.approvalStatus} /></p>
                      <p className="text-xs text-muted-foreground">{e.methodology} · <DateText value={e.executedAt} /></p>
                      <p className="text-xs">Limitations: {e.limitations}</p>
                      {can("ai_assessment.decide") && e.approvalStatus === "pending_review" && (
                        <div className="mt-1 flex gap-1">
                          <ConfirmDialog trigger={<Button size="xs">Approve</Button>} title="Approve evaluation" requireRationale confirmLabel="Approve" onConfirm={(n) => reviewEval.mutateAsync({ id: e.id, decision: "approved", notes: n })} />
                          <ConfirmDialog trigger={<Button size="xs" variant="outline">Reject</Button>} title="Reject evaluation" requireRationale destructive confirmLabel="Reject" onConfirm={(n) => reviewEval.mutateAsync({ id: e.id, decision: "rejected", notes: n })} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Incidents">
              {s.incidents.length === 0 ? <p className="text-sm text-muted-foreground">No incidents.</p> : (
                <ul className="divide-y">
                  {s.incidents.map((i) => (
                    <li key={i.id} className="py-2 text-sm">
                      <Link href={`/ai-governance/incidents?aiSystemId=${s.id}`} className="font-medium text-primary hover:underline">{i.title}</Link>
                      <p className="mt-1 flex items-center gap-1"><SeverityBadge severity={i.severity} /><StatusBadge status={i.status} /><span className="text-xs text-muted-foreground"><DateText value={i.detectedAt} /></span></p>
                      {i.findingId && <Link href={`/findings/${i.findingId}`} className="text-xs text-primary hover:underline">Linked finding</Link>}
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="changes">
          <Section title="Model, provider and purpose changes" description="Each change flags the system for reassessment and needs review by someone other than the requester.">
            {s.changes.length === 0 ? <p className="text-sm text-muted-foreground">No changes recorded.</p> : (
              <ul className="divide-y">
                {s.changes.map((c) => (
                  <li key={c.id} className="py-2 text-sm">
                    <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{humanize(c.changeType)}</span>{c.newVersion && <span className="text-xs">{c.previousVersion ?? "—"} → {c.newVersion}</span>}<SeverityBadge severity={c.changeRisk} /><StatusBadge status={c.reviewStatus} /></p>
                    <p className="text-xs">{c.changeDescription}</p>
                    {can("ai_change.review") && c.reviewStatus === "pending_review" && (
                      <div className="mt-1 flex gap-1">
                        <ConfirmDialog trigger={<Button size="xs">Approve</Button>} title="Approve change" requireRationale confirmLabel="Approve" onConfirm={(n) => reviewChange.mutateAsync({ id: c.id, decision: "approved", notes: n })} />
                        <ConfirmDialog trigger={<Button size="xs" variant="outline">Reject</Button>} title="Reject change" requireRationale destructive confirmLabel="Reject" onConfirm={(n) => reviewChange.mutateAsync({ id: c.id, decision: "rejected", notes: n })} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="eu"><EuAiActForm system={s} /></TabsContent>

        <TabsContent value="risk">
          <div className="grid gap-4 lg:grid-cols-3">
            <Section title="Linked risks">
              {s.risks.length === 0 ? <p className="text-sm text-muted-foreground">No linked risks.</p> : (
                <ul className="divide-y">{s.risks.map((r) => <li key={r.id} className="py-2 text-sm"><Link href={`/risks/${r.id}`} className="text-primary hover:underline">{r.riskKey} · {r.title}</Link><span className="mt-1 flex gap-1"><SeverityBadge severity={r.residualRating ?? r.inherentRating} /><StatusBadge status={r.status} /></span></li>)}</ul>
              )}
            </Section>
            <Section title="Findings">
              {s.findings.length === 0 ? <p className="text-sm text-muted-foreground">No findings.</p> : (
                <ul className="divide-y">{s.findings.map((f) => <li key={f.id} className="py-2 text-sm"><Link href={`/findings/${f.id}`} className="text-primary hover:underline">{f.findingKey}</Link> {f.title}<span className="mt-1 flex gap-1"><SeverityBadge severity={f.severity} /><StatusBadge status={f.status} /></span></li>)}</ul>
              )}
            </Section>
            <Section title="Evidence">
              {s.evidence.length === 0 ? <p className="text-sm text-muted-foreground">No evidence linked. Link evidence from the evidence library.</p> : (
                <ul className="divide-y">{s.evidence.map((e) => <li key={e.linkId} className="flex justify-between py-2 text-sm"><Link href={`/evidence/${e.id}`} className="text-primary hover:underline">{e.title}</Link><StatusBadge status={e.reviewStatus} /></li>)}</ul>
              )}
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="history"><Section title="History"><AuditTimeline events={s.history} /></Section></TabsContent>
      </Tabs>
    </>
  );
}
