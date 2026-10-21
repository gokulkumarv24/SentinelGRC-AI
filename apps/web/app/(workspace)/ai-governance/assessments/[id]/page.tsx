"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { humanize, SeverityBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText } from "@/components/common/date-text";
import { AuditTimeline } from "@/components/common/history";
import { PageHeader, Section } from "@/components/common/page-header";
import { evidenceOption, RecordPicker } from "@/components/common/record-picker";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { AuditEvent, Severity } from "@/lib/types";

interface Item {
  id: string;
  category: string;
  rmfFunction: string | null;
  questionKey: string;
  prompt: string;
  required: boolean;
  response: unknown;
  result: "not_answered" | "satisfactory" | "needs_improvement" | "unsatisfactory" | "not_applicable";
  rationale: string | null;
  evidenceId: string | null;
}
interface Assessment {
  id: string;
  status: string;
  assessmentVersion: number;
  riskTier: string;
  rationale: string | null;
  residualRiskNotes: string | null;
  decisionRationale: string | null;
  assessorId: string | null;
  submittedBy: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedByName: string | null;
  aiSystem: { id: string; name: string; lifecycleStatus: string };
  items: Item[];
  risks: Array<{ id: string; riskKey: string; title: string; inherentRating: Severity; residualRating: Severity | null; status: string }>;
  findings: Array<{ id: string; findingKey: string; title: string; severity: Severity; status: string }>;
  history: AuditEvent[];
}
type Draft = Pick<Item, "response" | "result" | "rationale" | "evidenceId">;

const FUNCTIONS = ["Govern", "Map", "Measure", "Manage"];
const RESULTS: Item["result"][] = ["not_answered", "satisfactory", "needs_improvement", "unsatisfactory", "not_applicable"];

export default function AiAssessmentPage({ params }: PageProps<"/ai-governance/assessments/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const { data: me } = useMe();
  const query = useQuery({ queryKey: ["ai-assessments", id], queryFn: () => api.get<Assessment>(`/ai-assessments/${id}`) });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [dirty, setDirty] = useState(false);
  const [tier, setTier] = useState("limited");
  const [residual, setResidual] = useState("");
  const [loaded, setLoaded] = useState<Assessment | undefined>(undefined);
  if (query.data && query.data !== loaded) {
    setLoaded(query.data);
    setDrafts(Object.fromEntries(query.data.items.map((i) => [i.id, { response: i.response, result: i.result, rationale: i.rationale, evidenceId: i.evidenceId }])));
    setDirty(false);
  }
  const inv = [["ai-assessments"], ["ai-systems"], ["risks"], ["findings"]];
  const save = useApiMutation({ mutationFn: () => api.post(`/ai-assessments/${id}/items`, { items: Object.entries(drafts).map(([itemId, d]) => ({ itemId, response: d.response === "" ? undefined : d.response, result: d.result, rationale: d.rationale || null, evidenceId: d.evidenceId })) }), success: "Saved", invalidate: inv, onSuccess: () => setDirty(false) });
  const submit = useApiMutation({ mutationFn: (rationale: string) => api.post<{ riskId: string | null; unsatisfactory: number }>(`/ai-assessments/${id}/submit`, { riskTier: tier, rationale, residualRiskNotes: residual || null }), success: (r) => (r.riskId ? `Submitted · ${r.unsatisfactory} gap(s) linked to a shared risk` : "Submitted for approval"), invalidate: inv });
  const decide = useApiMutation({ mutationFn: (v: { decision: string; rationale: string }) => api.post(`/ai-assessments/${id}/decision`, v), success: "Decision recorded", invalidate: inv });

  const counts = useMemo(() => {
    const values = Object.values(drafts);
    return { answered: values.filter((d) => d.result !== "not_answered").length, unsatisfactory: values.filter((d) => d.result === "unsatisfactory").length };
  }, [drafts]);
  if (query.isPending) return <LoadingState rows={10} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const a = query.data;
  const editable = ["draft", "in_progress"].includes(a.status) && can("ai_assessment.manage");
  const canDecide = a.status === "submitted" && can("ai_assessment.decide") && a.submittedBy !== me?.user.id && a.assessorId !== me?.user.id;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "AI assessments", href: "/ai-governance/assessments" }, { label: `${a.aiSystem.name} v${a.assessmentVersion}` }]}
        title={`${a.aiSystem.name} — AI risk assessment v${a.assessmentVersion}`}
        description="Rate each area with a rationale. Unsatisfactory areas create or link a shared enterprise risk. AI-generated text never decides any rating."
        meta={
          <>
            <StatusBadge status={a.status} />
            <span className="text-xs text-muted-foreground">{counts.answered}/{a.items.length} rated · {counts.unsatisfactory} unsatisfactory · proposed tier {humanize(a.riskTier)}</span>
          </>
        }
        actions={editable && <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>Save progress</Button>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Tabs defaultValue="Govern">
          <TabsList className="mb-3">
            {FUNCTIONS.map((f) => (
              <TabsTrigger key={f} value={f}>
                {f} ({a.items.filter((i) => i.rmfFunction === f).length})
              </TabsTrigger>
            ))}
          </TabsList>
          {FUNCTIONS.map((f) => (
            <TabsContent key={f} value={f} className="space-y-3">
              {a.items.filter((i) => i.rmfFunction === f).map((i) => {
                const d = drafts[i.id] ?? { response: "", result: "not_answered", rationale: "", evidenceId: null };
                const set = (patch: Partial<Draft>) => { setDrafts({ ...drafts, [i.id]: { ...d, ...patch } }); setDirty(true); };
                return (
                  <section key={i.id} className="rounded-lg border bg-card p-4" aria-label={i.questionKey}>
                    <p className="text-xs text-muted-foreground">{i.category} · <span className="font-mono">{i.questionKey}</span>{i.required && " · required"}</p>
                    <p className="mt-1 text-sm font-medium">{i.prompt}</p>
                    <div className="mt-3 space-y-2">
                      <Textarea rows={3} placeholder="Current state" aria-label="Current state" value={(d.response as string) ?? ""} disabled={!editable} onChange={(e) => set({ response: e.target.value })} />
                      <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
                        <Select value={d.result} disabled={!editable} onValueChange={(v) => set({ result: v as Item["result"] })}>
                          <SelectTrigger aria-label="Rating"><SelectValue /></SelectTrigger>
                          <SelectContent>{RESULTS.map((r) => <SelectItem key={r} value={r}>{humanize(r)}</SelectItem>)}</SelectContent>
                        </Select>
                        <Textarea rows={1} placeholder={["unsatisfactory", "needs_improvement", "not_applicable"].includes(d.result) ? "Rationale (required)" : "Rationale"} aria-label="Rationale" value={d.rationale ?? ""} disabled={!editable} onChange={(e) => set({ rationale: e.target.value })} />
                      </div>
                      {editable ? (
                        <RecordPicker endpoint="/evidence" toOption={evidenceOption} value={d.evidenceId ? { id: d.evidenceId, label: "Attached evidence" } : null} onChange={(o) => set({ evidenceId: o?.id ?? null })} placeholder="Attach supporting evidence (optional)" />
                      ) : (
                        d.evidenceId && <Link href={`/evidence/${d.evidenceId}`} className="text-xs text-primary hover:underline">View evidence</Link>
                      )}
                    </div>
                  </section>
                );
              })}
            </TabsContent>
          ))}
        </Tabs>
        <div className="space-y-4">
          {editable && (
            <Section title="Submit for approval" description="Every required item must be rated. Approval needs someone other than you.">
              <div className="space-y-2">
                <Label htmlFor="tier">Proposed risk tier</Label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger id="tier" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{["minimal", "limited", "high", "unacceptable", "undetermined"].map((t) => <SelectItem key={t} value={t}>{humanize(t)}</SelectItem>)}</SelectContent>
                </Select>
                {counts.unsatisfactory > 0 && (
                  <>
                    <Label htmlFor="residual">Residual risk for unsatisfactory items</Label>
                    <Textarea id="residual" rows={3} value={residual} onChange={(e) => setResidual(e.target.value)} />
                  </>
                )}
                <ConfirmDialog trigger={<Button className="w-full" disabled={dirty}>Submit</Button>} title="Submit AI assessment" requireRationale rationaleLabel="Overall rationale" confirmLabel="Submit" onConfirm={(r) => submit.mutateAsync(r)} />
                {dirty && <p className="text-xs text-muted-foreground">Save your progress first.</p>}
              </div>
            </Section>
          )}
          {a.status === "submitted" && (
            <Section title="Decision" description="An authorized approver other than the assessor and submitter decides.">
              <p className="text-sm">Submitted <DateText value={a.submittedAt} withTime /></p>
              {a.rationale && <p className="mt-1 text-xs">{a.rationale}</p>}
              {a.residualRiskNotes && <p className="mt-1 text-xs text-muted-foreground">Residual risk: {a.residualRiskNotes}</p>}
              {canDecide ? (
                <div className="mt-3 flex gap-2">
                  <ConfirmDialog trigger={<Button>Approve</Button>} title="Approve AI assessment" requireRationale confirmLabel="Approve" onConfirm={(r) => decide.mutateAsync({ decision: "approved", rationale: r })} />
                  <ConfirmDialog trigger={<Button variant="outline">Reject</Button>} title="Reject AI assessment" requireRationale destructive confirmLabel="Reject" onConfirm={(r) => decide.mutateAsync({ decision: "rejected", rationale: r })} />
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">Waiting for an approver who did not assess or submit it.</p>
              )}
            </Section>
          )}
          {["approved", "rejected", "superseded"].includes(a.status) && (
            <Section title="Decision">
              <p className="text-sm"><StatusBadge status={a.status} /> {a.approvedByName && <>by {a.approvedByName} on <DateText value={a.approvedAt} /></>}</p>
              {a.decisionRationale && <p className="mt-2 text-sm">{a.decisionRationale}</p>}
            </Section>
          )}
          {(a.risks.length > 0 || a.findings.length > 0) && (
            <Section title="Shared risk and findings">
              <ul className="divide-y text-sm">
                {a.risks.map((r) => <li key={r.id} className="py-2"><Link href={`/risks/${r.id}`} className="text-primary hover:underline">{r.riskKey} · {r.title}</Link> <SeverityBadge severity={r.residualRating ?? r.inherentRating} /></li>)}
                {a.findings.map((f) => <li key={f.id} className="py-2"><Link href={`/findings/${f.id}`} className="text-primary hover:underline">{f.findingKey}</Link> {f.title} <SeverityBadge severity={f.severity} /></li>)}
              </ul>
            </Section>
          )}
          <Section title="History"><AuditTimeline events={a.history} /></Section>
        </div>
      </div>
    </>
  );
}
