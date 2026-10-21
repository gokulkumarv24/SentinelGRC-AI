"use client";

import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard, ChartTooltip } from "@/components/charts/chart-card";
import { humanize, SeverityBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText, DueDate } from "@/components/common/date-text";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { ErrorState, LoadingState } from "@/components/common/states";
import { UserSelect } from "@/components/common/user-select";
import { VendorFormDialog, type VendorRecord } from "@/components/vendors/vendor-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Severity } from "@/lib/types";

interface VendorDetail extends VendorRecord {
  status: string;
  inherentRiskScore: number | null;
  residualRiskScore: number | null;
  riskTier: Severity | null;
  lastAssessedAt: string | null;
  nextAssessmentAt: string | null;
  isDemo: boolean;
  businessOwner: { displayName: string } | null;
  contacts: Array<{ id: string; name: string; email: string; role: string | null; contactType: string }> | null;
  inherent: { score: number; breakdown: Array<{ factor: string; value: string | number; weight: number; contribution: number }> };
  assessments: Array<{ id: string; status: string; assessmentVersion: number; residualRisk: number | null; riskTier: Severity | null; decision: string | null; dueDate: string | null; decidedAt: string | null; createdAt: string }>;
  riskHistory: Array<{ recordedAt: string; inherentScore: number | null; residualScore: number | null; tier: string | null }>;
  risks: Array<{ id: string; riskKey: string; title: string; inherentRating: Severity; residualRating: Severity | null; status: string }>;
  findings: Array<{ id: string; findingKey: string; title: string; severity: Severity; status: string; dueDate: string | null }>;
  aiSystems: Array<{ id: string; name: string; lifecycleStatus: string; riskTier: string }>;
  allowedTransitions: string[];
}

function StartAssessment({ vendorId }: { vendorId: string }) {
  const [templateId, setTemplateId] = useState("");
  const [due, setDue] = useState("");
  const [assessor, setAssessor] = useState<string | null>(null);
  const router = useRouter();
  const templates = useQuery({ queryKey: ["questionnaires"], queryFn: () => api.get<Array<{ id: string; name: string; version: number; organizationId: string | null }>>("/questionnaires")});
  const create = useApiMutation({
    mutationFn: () => api.post<{ id: string }>(`/vendors/${vendorId}/assessments`, { templateId, dueDate: due ? new Date(`${due}T12:00:00Z`).toISOString() : null, assessorId: assessor }),
    success: "Assessment started",
    invalidate: [["vendors"], ["assessments"]],
    onSuccess: (a) => router.push(`/vendors/assessments/${a.id}`),
  });
  return (
    <ConfirmDialog
      trigger={<Button><ClipboardCheck aria-hidden /> Start assessment</Button>}
      title="Start a security assessment"
      description="The questionnaire version is frozen once the assessment is submitted."
      confirmLabel="Start"
      onConfirm={async () => {
        if (!templateId) throw new Error("Choose a questionnaire");
        await create.mutateAsync();
      }}
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="tpl">Questionnaire</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger id="tpl" className="w-full">
              <SelectValue placeholder="Choose a questionnaire" />
            </SelectTrigger>
            <SelectContent>
              {templates.data?.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name} v{t.version} {t.organizationId ? "" : "(platform)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="due">Due date</Label>
            <Input id="due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assessor">Assessor</Label>
            <UserSelect id="assessor" value={assessor} onChange={setAssessor} placeholder="Me" />
          </div>
        </div>
      </div>
    </ConfirmDialog>
  );
}

export default function VendorDetailPage({ params }: PageProps<"/vendors/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const query = useQuery({ queryKey: ["vendors", id], queryFn: () => api.get<VendorDetail>(`/vendors/${id}`) });
  const [transitionTo, setTransitionTo] = useState("");
  const [contact, setContact] = useState({ name: "", email: "", role: "", contactType: "security" });
  const invalidate = [["vendors"]];
  const transition = useApiMutation({ mutationFn: (rationale: string) => api.post(`/vendors/${id}/transition`, { to: transitionTo, rationale }), success: "Lifecycle updated", invalidate });
  const addContact = useApiMutation({ mutationFn: () => api.post(`/vendors/${id}/contacts`, { ...contact, role: contact.role || undefined }), success: "Contact added", invalidate, onSuccess: () => setContact({ name: "", email: "", role: "", contactType: "security" }) });
  const removeContact = useApiMutation({ mutationFn: (cid: string) => api.delete(`/vendors/${id}/contacts/${cid}`), success: "Contact removed", invalidate });

  if (query.isPending) return <LoadingState rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const v = query.data;
  const openAssessment = v.assessments.find((a) => ["draft", "submitted", "under_review", "returned_for_clarification"].includes(a.status));
  const history = v.riskHistory.map((h) => ({ date: h.recordedAt.slice(0, 10), inherent: h.inherentScore, residual: h.residualScore }));

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Vendors", href: "/vendors" }, { label: v.name }]}
        title={v.name}
        description={v.serviceDescription}
        meta={
          <>
            <StatusBadge status={v.status} />
            <SeverityBadge severity={v.criticality} className="opacity-90" /> <span className="text-xs text-muted-foreground">criticality</span>
            {v.isDemo && <StatusBadge status="stale" label="Fictional demo vendor" />}
          </>
        }
        actions={
          <>
            {can("vendor.update") && <VendorFormDialog vendor={v} trigger={<Button variant="outline"><Pencil aria-hidden /> Edit</Button>} />}
            {can("vendor_assessment.manage") && (openAssessment ? (
              <Button asChild variant="outline">
                <Link href={`/vendors/assessments/${openAssessment.id}`}>Open current assessment</Link>
              </Button>
            ) : (
              <StartAssessment vendorId={v.id} />
            ))}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="Inherent risk" description="From the service profile, before controls.">
              <p className="text-2xl font-semibold tabular-nums">{v.inherent.score}<span className="text-sm text-muted-foreground"> / 100</span></p>
              <table className="mt-2 w-full text-xs">
                <caption className="sr-only">Inherent risk factors</caption>
                <tbody className="divide-y">
                  {v.inherent.breakdown.map((f) => (
                    <tr key={f.factor}>
                      <th scope="row" className="py-1 text-left font-normal text-muted-foreground">{humanize(f.factor.replace(/([A-Z])/g, " $1").toLowerCase())}</th>
                      <td className="py-1">{String(f.value)}</td>
                      <td className="py-1 text-right tabular-nums">+{f.contribution}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
            <Section title="Residual risk" description="From the latest reviewed assessment.">
              {v.riskTier ? (
                <>
                  <SeverityBadge severity={v.riskTier} score={v.residualRiskScore} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    Last assessed <DateText value={v.lastAssessedAt} />. Next assessment <DueDate value={v.nextAssessmentAt} />.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Not yet assessed.</p>
              )}
            </Section>
          </div>
          <ChartCard title="Risk score history" description="Inherent and residual scores recorded at each change and assessment." empty={history.length < 2} table={{ headers: ["Date", "Inherent", "Residual"], rows: history.map((h) => [h.date, h.inherent ?? "—", h.residual ?? "—"]) }}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={history} margin={{ left: 0, right: 16, top: 8 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} stroke="var(--muted-foreground)" fontSize={11} tickLine={false} axisLine={false} width={32} />
                <Tooltip content={<ChartTooltip />} />
                <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
                <Line dataKey="inherent" name="Inherent" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 4 }} connectNulls />
                <Line dataKey="residual" name="Residual" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 4 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
          <Section title="Assessments">
            {v.assessments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assessments yet.</p>
            ) : (
              <ul className="divide-y">
                {v.assessments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/vendors/assessments/${a.id}`} className="text-primary hover:underline">
                      Assessment v{a.assessmentVersion} · <DateText value={a.createdAt} />
                    </Link>
                    <span className="flex items-center gap-2">
                      {a.riskTier && <SeverityBadge severity={a.riskTier} score={a.residualRisk} />}
                      {a.decision ? <StatusBadge status={a.decision} /> : <StatusBadge status={a.status} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <div className="grid gap-4 sm:grid-cols-2">
            <Section title="Findings">
              {v.findings.length === 0 ? <p className="text-sm text-muted-foreground">No findings.</p> : (
                <ul className="divide-y">
                  {v.findings.map((f) => (
                    <li key={f.id} className="py-2 text-sm">
                      <Link href={`/findings/${f.id}`} className="text-primary hover:underline">{f.findingKey}</Link> {f.title}
                      <span className="mt-1 flex gap-1"><SeverityBadge severity={f.severity} /><StatusBadge status={f.status} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Linked risks">
              {v.risks.length === 0 ? <p className="text-sm text-muted-foreground">No linked risks.</p> : (
                <ul className="divide-y">
                  {v.risks.map((r) => (
                    <li key={r.id} className="py-2 text-sm">
                      <Link href={`/risks/${r.id}`} className="text-primary hover:underline">{r.riskKey} · {r.title}</Link>
                      <span className="mt-1 flex gap-1"><SeverityBadge severity={r.residualRating ?? r.inherentRating} /><StatusBadge status={r.status} /></span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
          {v.aiSystems.length > 0 && (
            <Section title="AI systems provided by this vendor">
              <ul className="divide-y">
                {v.aiSystems.map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2 text-sm">
                    <Link href={`/ai-governance/${s.id}`} className="text-primary hover:underline">{s.name}</Link>
                    <StatusBadge status={s.lifecycleStatus} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        <div className="space-y-4">
          <Section title="Profile">
            <DetailList
              items={[
                { label: "Business owner", value: v.businessOwner?.displayName },
                { label: "Data classification", value: humanize(v.dataClassification) },
                { label: "Personal data", value: v.personalDataAccess ? "Yes" : "No" },
                { label: "System access", value: humanize(v.accessLevel) },
                { label: "Data types", value: v.dataTypes.join(", ") || "—" },
                { label: "Regions", value: v.regions.join(", ") || "—" },
                { label: "Reassessment", value: `Every ${v.reassessmentFrequencyDays} days` },
                { label: "Website", value: v.website && <a className="text-primary hover:underline" href={v.website} target="_blank" rel="noopener noreferrer">{v.website}</a> },
              ]}
            />
            {v.notes && <p className="mt-3 text-xs whitespace-pre-wrap">{v.notes}</p>}
          </Section>
          {can("vendor.lifecycle") && v.allowedTransitions.length > 0 && (
            <Section title="Lifecycle" description="Approval and rejection happen through an assessment decision.">
              <div className="flex gap-2">
                <Select value={transitionTo} onValueChange={setTransitionTo}>
                  <SelectTrigger className="flex-1" aria-label="Move to">
                    <SelectValue placeholder="Move to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {v.allowedTransitions.map((t) => (
                      <SelectItem key={t} value={t}>
                        {humanize(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ConfirmDialog trigger={<Button variant="outline" disabled={!transitionTo}>Apply</Button>} title={`Move vendor to ${humanize(transitionTo || "")}`} requireRationale confirmLabel="Confirm" onConfirm={(r) => transition.mutateAsync(r)} />
              </div>
            </Section>
          )}
          <Section title="Contacts" description="Restricted to vendor managers and administrators.">
            {v.contacts === null ? (
              <p className="text-sm text-muted-foreground">You do not have access to vendor contact details.</p>
            ) : (
              <>
                {v.contacts.length === 0 && <p className="text-sm text-muted-foreground">No contacts.</p>}
                <ul className="divide-y">
                  {v.contacts.map((c) => (
                    <li key={c.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                      <span>
                        {c.name} <span className="text-xs text-muted-foreground">({c.contactType})</span>
                        <span className="block text-xs">{c.email}</span>
                      </span>
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${c.name}`} onClick={() => removeContact.mutate(c.id)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
                <form method="post" className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); addContact.mutate(); }}>
                  <Input placeholder="Name" aria-label="Contact name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                  <Input placeholder="Email" type="email" aria-label="Contact email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
                  <Button size="sm" type="submit" variant="outline" disabled={!contact.name || !contact.email || addContact.isPending}>
                    <Plus aria-hidden /> Add contact
                  </Button>
                </form>
              </>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
