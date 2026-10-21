"use client";

import { useQuery } from "@tanstack/react-query";
import { FlaskConical, Link2, Play, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { IllustrativeBadge, SeverityBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText } from "@/components/common/date-text";
import { AuditTimeline } from "@/components/common/history";
import { LinkDialog } from "@/components/common/link-dialog";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { evidenceOption } from "@/components/common/record-picker";
import { ErrorState, LoadingState } from "@/components/common/states";
import { ImplementationForm } from "@/components/controls/implementation-form";
import { RuleConfigDialog } from "@/components/controls/rule-config-dialog";
import { EvidenceUploadDialog } from "@/components/evidence/upload-dialog";
import { FindingFormDialog } from "@/components/findings/finding-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { ControlDetail } from "@/lib/types";

export default function ControlDetailPage({ params }: PageProps<"/controls/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const query = useQuery({ queryKey: ["controls", id], queryFn: () => api.get<ControlDetail>(`/controls/${id}`) });
  const [manualResult, setManualResult] = useState("pass");
  const invalidate = [["controls"], ["findings"], ["dashboard"]];
  const runTests = useApiMutation({
    mutationFn: () => api.post<{ results: Array<{ result: string }> }>(`/controls/${id}/tests`, { mode: "automated" }),
    success: (r) => `Test run complete: ${r.results.map((x) => x.result).join(", ") || "no rules configured"}`,
    invalidate,
  });
  const manualTest = useApiMutation({
    mutationFn: (rationale: string) => api.post(`/controls/${id}/tests`, { mode: "manual", result: manualResult, summary: `Manual assessment: ${manualResult}`, rationale }),
    success: "Manual test recorded",
    invalidate,
  });
  const linkEvidence = useApiMutation({
    mutationFn: (vars: { evidenceId: string; note: string }) => api.post(`/evidence/${vars.evidenceId}/links`, { entityType: "control", entityId: id, purpose: "control_evidence", relevanceNotes: vars.note || undefined }),
    success: "Evidence linked",
    invalidate,
  });

  if (query.isPending) return <LoadingState rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const c = query.data;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Controls", href: "/controls" }, { label: c.controlCode }]}
        title={<span><span className="font-mono text-base text-muted-foreground">{c.controlCode}</span> {c.title}</span>}
        description={c.description}
        meta={
          <>
            <StatusBadge status={c.implementation?.status} />
            <span className="text-xs text-muted-foreground">{c.category}</span>
            {c.isIllustrative && <IllustrativeBadge />}
            {!c.active && <StatusBadge status="retired" />}
          </>
        }
        actions={
          <>
            {can("control_test.run") && (
              <Button variant="outline" onClick={() => runTests.mutate()} disabled={runTests.isPending}>
                <Play aria-hidden /> {runTests.isPending ? "Running…" : "Run automated tests"}
              </Button>
            )}
            {can("control_test.manual") && (
              <ConfirmDialog trigger={<Button variant="outline"><FlaskConical aria-hidden /> Record manual test</Button>} title="Record manual test" description="Manual results require a recorded rationale and are attributed to you." requireRationale confirmLabel="Record result" onConfirm={(r) => manualTest.mutateAsync(r)}>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-result">Result</Label>
                  <Select value={manualResult} onValueChange={setManualResult}>
                    <SelectTrigger id="manual-result" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["pass", "fail", "unknown", "not_applicable"].map((r) => (
                        <SelectItem key={r} value={r}>
                          {r.replace(/_/g, " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </ConfirmDialog>
            )}
          </>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tests">Tests ({c.tests.length})</TabsTrigger>
          <TabsTrigger value="evidence">Evidence ({c.evidence.length})</TabsTrigger>
          <TabsTrigger value="frameworks">Frameworks ({c.frameworkReferences.length})</TabsTrigger>
          <TabsTrigger value="risks">Risks & findings</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Section title="Implementation and applicability">{c.implementation && <ImplementationForm control={c} />}</Section>
            </div>
            <Section title="Details">
              <DetailList
                items={[
                  { label: "Owner", value: c.implementation?.owner?.displayName },
                  { label: "Review frequency", value: `Every ${c.reviewFrequencyDays} days` },
                  { label: "Last reviewed", value: <DateText value={c.implementation?.lastReviewedAt} /> },
                  { label: "Next review", value: <DateText value={c.implementation?.nextReviewAt} /> },
                  { label: "Statement of Applicability", value: c.implementation?.soaIncluded ? "Included" : `Excluded — ${c.implementation?.soaJustification}` },
                ]}
              />
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="tests">
          <Section
            title="Test history"
            description="Pass, fail, unknown and error are kept distinct. Missing evidence produces unknown, not fail."
            actions={can("control.update") && <RuleConfigDialog controlId={c.id} trigger={<Button size="sm" variant="outline"><Plus aria-hidden /> Add rule</Button>} />}
          >
            {c.testConfigs.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2 text-xs">
                {c.testConfigs.map((t) => (
                  <span key={t.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
                    Rule <span className="font-mono">{t.ruleKey}</span> · every {t.frequencyHours}h · next <DateText value={t.nextRunAt} withTime /> {!t.enabled && "(disabled)"}
                    {can("control.update") && <RuleConfigDialog controlId={c.id} initial={t} trigger={<Button size="xs" variant="ghost">Edit</Button>} />}
                  </span>
                ))}
              </div>
            )}
            {c.tests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tests have run yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Control test history</caption>
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">When</th>
                      <th className="py-2 pr-3 font-medium">Type</th>
                      <th className="py-2 pr-3 font-medium">Result</th>
                      <th className="py-2 pr-3 font-medium">Summary</th>
                      <th className="py-2 font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {c.tests.map((t) => (
                      <tr key={t.id} className="align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <DateText value={t.startedAt} withTime />
                        </td>
                        <td className="py-2 pr-3">
                          {t.testType}
                          {t.ruleKey && <span className="block font-mono text-xs text-muted-foreground">{t.ruleKey}@{t.testRuleVersion}</span>}
                        </td>
                        <td className="py-2 pr-3">
                          <StatusBadge status={t.result} />
                        </td>
                        <td className="py-2 pr-3">
                          {t.summary}
                          {t.manualRationale && <span className="block text-xs italic text-muted-foreground">“{t.manualRationale}”</span>}
                          {t.findingId && (
                            <Link href={`/findings/${t.findingId}`} className="block text-xs text-primary hover:underline">
                              View finding
                            </Link>
                          )}
                        </td>
                        <td className="py-2 text-xs text-muted-foreground">{t.initiatedByName ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="evidence">
          <Section
            title="Evidence"
            description="Evidence currency drives automated checks. Rejected evidence does not count."
            actions={
              <div className="flex gap-2">
                {can("evidence.upload") && <EvidenceUploadDialog link={{ entityType: "control", entityId: c.id, label: c.controlCode }} trigger={<Button size="sm" variant="outline"><Upload aria-hidden /> Upload</Button>} />}
                {can("evidence.link") && <LinkDialog trigger={<Button size="sm" variant="outline"><Link2 aria-hidden /> Link existing</Button>} title="Link evidence to this control" endpoint="/evidence" toOption={evidenceOption} noteLabel="Relevance notes" onLink={(o, note) => linkEvidence.mutateAsync({ evidenceId: o.id, note })} />}
              </div>
            }
          >
            {c.evidence.length === 0 ? (
              <p className="text-sm text-muted-foreground">No evidence linked. Automated evidence checks will report this control as unknown.</p>
            ) : (
              <ul className="divide-y">
                {c.evidence.map((e) => (
                  <li key={e.linkId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <Link href={`/evidence/${e.id}`} className="text-primary hover:underline">
                      {e.title}
                    </Link>
                    <span className="flex items-center gap-2 text-xs">
                      {e.expiresAt && (
                        <span className="text-muted-foreground">
                          expires <DateText value={e.expiresAt} />
                        </span>
                      )}
                      <StatusBadge status={e.state} /> <StatusBadge status={e.reviewStatus} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="frameworks">
          <Section title="Framework references" description="Mappings are reviewable assertions, not equivalence. Unreviewed mappings are illustrative.">
            {c.frameworkReferences.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not mapped to any framework requirement yet.</p>
            ) : (
              <ul className="divide-y">
                {c.frameworkReferences.map((m) => (
                  <li key={m.mappingId} className="py-2 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        {m.framework.name} {m.framework.version}
                      </span>
                      <span className="font-mono text-xs">{m.requirement.code}</span> {m.requirement.title}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {m.mappingType.replace(/_/g, " ")} · confidence {m.confidence}% <StatusBadge status={m.reviewStatus} /> {m.isIllustrative && <IllustrativeBadge />}
                    </p>
                    <p className="mt-1 text-xs">{m.rationale}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="risks">
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Linked risks">
              {c.risks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No risks reference this control.</p>
              ) : (
                <ul className="divide-y">
                  {c.risks.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <Link href={`/risks/${r.id}`} className="truncate text-primary hover:underline">
                        {r.riskKey} · {r.title}
                      </Link>
                      <span className="flex shrink-0 gap-1">
                        <SeverityBadge severity={r.residualRating ?? r.inherentRating} />
                        <StatusBadge status={r.effectivenessRating} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Findings" actions={can("finding.create") && <FindingFormDialog defaults={{ controlId: c.id }} trigger={<Button size="sm" variant="outline"><Plus aria-hidden /> New finding</Button>} />}>
              {c.findings.length === 0 ? (
                <p className="text-sm text-muted-foreground">No findings for this control.</p>
              ) : (
                <ul className="divide-y">
                  {c.findings.map((f) => (
                    <li key={f.id} className="flex items-center justify-between gap-2 py-2 text-sm">
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
          </div>
        </TabsContent>

        <TabsContent value="history">
          <Section title="Change history">
            <AuditTimeline events={c.history} />
          </Section>
        </TabsContent>
      </Tabs>
    </>
  );
}
