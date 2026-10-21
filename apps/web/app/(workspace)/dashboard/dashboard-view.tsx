"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, FilePlus2, Play, Plus, RefreshCw, ShieldAlert, Upload } from "lucide-react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { humanize, SeverityBadge, StatusBadge } from "@/components/common/badges";
import { DateText } from "@/components/common/date-text";
import { PageHeader, Section } from "@/components/common/page-header";
import { ErrorState, LoadingState } from "@/components/common/states";
import { ChartCard, ChartTooltip, StatTile } from "@/components/charts/chart-card";
import { GettingStarted } from "@/components/onboarding/getting-started";
import { Button } from "@/components/ui/button";
import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveOrg, useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { AuditEvent, Severity } from "@/lib/types";

interface Summary {
  refreshedAt: string;
  risks: { active: number; bySeverity: Record<Severity, number>; basis: string };
  findings: { open: number; overdue: number; bySeverity: Record<Severity, number> };
  remediation: { overdue: number };
  controls: { total: number; missingEvidence: number; expiredEvidence: number; expiringEvidence: number; tests: Record<string, number>; testPassRate: number | null; implementationCoverage: number | null };
  vendors: { byTier: Record<string, number>; byStatus: Record<string, number>; assessmentsByStatus: Record<string, number> };
  aiSystems: { byLifecycle: Record<string, number>; byTier: Record<string, number> };
  upcoming: Array<{ type: string; id: string; label: string; due: string; href: string; overdue: boolean }>;
}
interface Trend {
  method: string;
  points: Array<{ month: string; openRisks: number; inherentTotal: number; residualTotal: number }>;
}
interface Compliance {
  measuredAt: string;
  definitions: Record<string, { label: string; formula: string; excludes: string }>;
  frameworks: Array<{
    framework: { id: string; key: string; name: string; version: string; isIllustrative: boolean };
    metrics: { controls: number; applicable: number; implementationCoverage: number | null; testPassRate: number | null; evidenceCurrency: number | null; tests: Record<string, number> };
    requirementCoverage: number | null;
    requirements: { leaves: number; covered: number; pendingReviewMappings: number };
  }>;
}
interface Recent {
  events: AuditEvent[];
  workflowFailures: Array<{ id: string; workflow: string; status: string; errorCode: string | null; errorMessage: string | null; attemptCount: number; createdAt: string }>;
}

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const SEV_COLOR: Record<string, string> = { low: "var(--sev-low)", medium: "var(--sev-medium)", high: "var(--sev-high)", critical: "var(--sev-critical)", not_assessed: "var(--muted-foreground)" };
const pct = (v: number | null) => (v == null ? "—" : `${v}%`);
const axis = { stroke: "var(--muted-foreground)", fontSize: 11, tickLine: false, axisLine: false } as const;

function Definition({ k, defs }: { k: string; defs: Compliance["definitions"] }) {
  const d = defs[k];
  if (!d) return null;
  return (
    <UiTooltip>
      <TooltipTrigger asChild>
        <button type="button" className="cursor-help border-b border-dotted border-muted-foreground text-xs text-muted-foreground">
          {d.label}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <p className="font-medium">{d.formula}</p>
        <p className="mt-1 opacity-90">Excludes: {d.excludes}</p>
      </TooltipContent>
    </UiTooltip>
  );
}

export function DashboardView() {
  const org = useActiveOrg();
  const can = useCan();
  const summary = useQuery({ queryKey: ["dashboard", "summary"], queryFn: () => api.get<Summary>("/dashboard/summary") });
  const trends = useQuery({ queryKey: ["dashboard", "trends"], queryFn: () => api.get<Trend>("/dashboard/risk-trends") });
  const compliance = useQuery({ queryKey: ["dashboard", "compliance"], queryFn: () => api.get<Compliance>("/dashboard/compliance") });
  const recent = useQuery({ queryKey: ["dashboard", "recent"], queryFn: () => api.get<Recent>("/dashboard/recent-events") });
  const refetchAll = () => [summary, trends, compliance, recent].forEach((q) => q.refetch());

  if (summary.isPending) return <LoadingState rows={8} label="Loading dashboard" />;
  if (summary.isError) return <ErrorState error={summary.error} onRetry={refetchAll} />;
  const s = summary.data;

  const severityData = SEVERITIES.map((sev) => ({ severity: sev, label: humanize(sev), risks: s.risks.bySeverity[sev] ?? 0, findings: s.findings.bySeverity[sev] ?? 0 }));
  const vendorData = ["critical", "high", "medium", "low", "not_assessed"].map((t) => ({ tier: t, label: humanize(t), vendors: s.vendors.byTier[t] ?? 0 })).filter((d) => d.vendors > 0);
  const aiOrder = ["proposed", "under_assessment", "approved_for_pilot", "pilot", "approved_for_production", "production", "suspended", "retired"];
  const aiData = aiOrder.map((l) => ({ stage: humanize(l), systems: s.aiSystems.byLifecycle[l] ?? 0 })).filter((d) => d.systems > 0);

  const quickActions = [
    can("risk.create") && { href: "/risks", label: "New risk", icon: ShieldAlert },
    can("finding.create") && { href: "/findings", label: "New finding", icon: Plus },
    can("evidence.upload") && { href: "/evidence", label: "Add evidence", icon: Upload },
    can("control_test.run") && { href: "/compliance/control-tests", label: "Run control tests", icon: Play },
    can("vendor.create") && { href: "/vendors", label: "Add vendor", icon: FilePlus2 },
    can("risk.acceptance.decide") && { href: "/risks/acceptance", label: "Review acceptances", icon: BadgeCheck },
  ].filter(Boolean) as Array<{ href: string; label: string; icon: typeof Plus }>;

  return (
    <>
      <PageHeader
        title="Executive dashboard"
        description={org ? `Governance, risk and compliance overview for ${org.name}.${org.isDemo ? " All figures are from fictional demo data." : ""}` : undefined}
        meta={
          <span className="text-xs text-muted-foreground">
            Data refreshed <DateText value={s.refreshedAt} withTime />
          </span>
        }
        actions={
          <Button variant="outline" size="sm" onClick={refetchAll}>
            <RefreshCw aria-hidden /> Refresh
          </Button>
        }
      />

      {quickActions.length > 0 && (
        <nav aria-label="Quick actions" className="mb-4 flex flex-wrap gap-2">
          {quickActions.map((a) => (
            <Button key={a.href + a.label} asChild variant="secondary" size="sm">
              <Link href={a.href}>
                <a.icon aria-hidden /> {a.label}
              </Link>
            </Button>
          ))}
        </nav>
      )}
      <div className="mb-4">
        <GettingStarted />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Active risks" value={s.risks.active} sub={`${s.risks.bySeverity.critical} critical · ${s.risks.bySeverity.high} high`} href="/risks" />
        <StatTile label="Open findings" value={s.findings.open} sub={`${s.findings.overdue} overdue`} href="/findings?openOnly=true" tone={s.findings.overdue ? "danger" : undefined} />
        <StatTile label="Overdue remediation" value={s.remediation.overdue} href="/remediation?view=list&overdue=true" tone={s.remediation.overdue ? "warn" : undefined} />
        <StatTile label="Controls missing evidence" value={s.controls.missingEvidence} sub={`${s.controls.expiredEvidence} expired · ${s.controls.expiringEvidence} expiring`} href="/controls?evidence=missing" tone={s.controls.missingEvidence ? "warn" : undefined} />
        <StatTile label="Latest test pass rate" value={pct(s.controls.testPassRate)} sub={`${s.controls.tests.unknown ?? 0} unknown excluded`} href="/compliance/control-tests" />
        <StatTile label="Implementation coverage" value={pct(s.controls.implementationCoverage)} sub={`${s.controls.total} controls`} href="/controls" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Risks and findings by severity"
          description={`Open items. Risks use ${s.risks.basis}.`}
          empty={s.risks.active + s.findings.open === 0}
          table={{ headers: ["Severity", "Risks", "Findings"], rows: severityData.map((d) => [<SeverityBadge key={d.severity} severity={d.severity} />, d.risks, d.findings]) }}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={severityData} layout="vertical" margin={{ left: 8, right: 16 }} barGap={2}>
              <CartesianGrid horizontal={false} stroke="var(--border)" />
              <XAxis type="number" allowDecimals={false} {...axis} />
              <YAxis type="category" dataKey="label" width={64} {...axis} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
              <Legend iconType="square" wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="risks" name="Risks" fill="var(--chart-1)" radius={[0, 4, 4, 0]} maxBarSize={14} />
              <Bar dataKey="findings" name="Findings" fill="var(--chart-2)" radius={[0, 4, 4, 0]} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Inherent vs residual risk"
          description={trends.data?.method ?? "Monthly totals of open-risk scores."}
          empty={!trends.data || trends.data.points.every((p) => p.openRisks === 0)}
          table={{ headers: ["Month", "Open risks", "Inherent total", "Residual total"], rows: (trends.data?.points ?? []).map((p) => [p.month, p.openRisks, p.inherentTotal, p.residualTotal]) }}
        >
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trends.data?.points ?? []} margin={{ left: 0, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="month" {...axis} />
              <YAxis allowDecimals={false} {...axis} width={36} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="inherentTotal" name="Inherent" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} />
              <Line type="monotone" dataKey="residualTotal" name="Residual" stroke="var(--chart-2)" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 4 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="mt-4">
        <Section title="Compliance by framework" description="Measured per in-scope framework version. Hover a metric for its definition and exclusions. These are tracking measures, not certification or attestation.">
          {compliance.isPending ? (
            <LoadingState rows={2} />
          ) : compliance.isError ? (
            <ErrorState error={compliance.error} onRetry={() => compliance.refetch()} />
          ) : compliance.data.frameworks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No frameworks are in scope. {can("framework.manage") && <Link className="text-primary hover:underline" href="/settings/frameworks">Choose frameworks</Link>}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Compliance metrics per framework</caption>
                <thead>
                  <tr className="text-left">
                    <th className="py-2 pr-3 text-xs font-medium text-muted-foreground">Framework</th>
                    <th className="py-2 pr-3"><Definition k="requirementCoverage" defs={compliance.data.definitions} /></th>
                    <th className="py-2 pr-3"><Definition k="implementationCoverage" defs={compliance.data.definitions} /></th>
                    <th className="py-2 pr-3"><Definition k="testPassRate" defs={compliance.data.definitions} /></th>
                    <th className="py-2 pr-3"><Definition k="evidenceCurrency" defs={compliance.data.definitions} /></th>
                    <th className="py-2 pr-3 text-xs font-medium text-muted-foreground">Latest tests (pass / fail / unknown / untested)</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {compliance.data.frameworks.map((f) => (
                    <tr key={f.framework.id}>
                      <td className="py-2 pr-3">
                        <Link href={`/compliance/frameworks/${f.framework.id}`} className="font-medium text-primary hover:underline">
                          {f.framework.name} {f.framework.version}
                        </Link>
                        <span className="block text-xs text-muted-foreground">
                          {f.metrics.controls} mapped controls · {f.requirements.pendingReviewMappings} mappings pending review
                        </span>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{pct(f.requirementCoverage)} <span className="text-xs text-muted-foreground">({f.requirements.covered}/{f.requirements.leaves})</span></td>
                      <td className="py-2 pr-3 tabular-nums">{pct(f.metrics.implementationCoverage)}</td>
                      <td className="py-2 pr-3 tabular-nums">{pct(f.metrics.testPassRate)}</td>
                      <td className="py-2 pr-3 tabular-nums">{pct(f.metrics.evidenceCurrency)}</td>
                      <td className="py-2 pr-3 text-xs tabular-nums">
                        <span className="text-ok">{f.metrics.tests.pass ?? 0} pass</span> · <span className="text-sev-critical">{f.metrics.tests.fail ?? 0} fail</span> · {f.metrics.tests.unknown ?? 0} unknown · {f.metrics.tests.notTested ?? 0} untested
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-muted-foreground">
                Measured <DateText value={compliance.data.measuredAt} withTime />.
              </p>
            </div>
          )}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Vendors by risk tier"
          description="Residual tier from the latest reviewed assessment."
          empty={vendorData.length === 0}
          table={{ headers: ["Tier", "Vendors"], rows: vendorData.map((d) => [d.tier === "not_assessed" ? "Not assessed" : <SeverityBadge key={d.tier} severity={d.tier as Severity} />, d.vendors]) }}
          action={<Link href="/vendors" className="text-xs text-primary hover:underline">Vendors</Link>}
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={vendorData} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" {...axis} />
              <YAxis allowDecimals={false} {...axis} width={28} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="vendors" name="Vendors" radius={[4, 4, 0, 0]} maxBarSize={36}>
                {vendorData.map((d) => (
                  <Cell key={d.tier} fill={SEV_COLOR[d.tier]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="AI systems by lifecycle stage"
          description={`Risk tiers: ${Object.entries(s.aiSystems.byTier).map(([k, v]) => `${humanize(k)} ${v}`).join(" · ") || "none"}`}
          empty={aiData.length === 0}
          table={{ headers: ["Stage", "Systems"], rows: aiData.map((d) => [d.stage, d.systems]) }}
          action={<Link href="/ai-governance" className="text-xs text-primary hover:underline">AI inventory</Link>}
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={aiData} margin={{ left: 0, right: 8, top: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="stage" {...axis} interval={0} />
              <YAxis allowDecimals={false} {...axis} width={28} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="systems" name="AI systems" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title="Upcoming reviews and deadlines" description="Next 30 days, including overdue items.">
          {s.upcoming.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing due in the next 30 days.</p>
          ) : (
            <ul className="divide-y">
              {s.upcoming.map((u) => (
                <li key={`${u.type}-${u.id}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <Link href={u.href} className="truncate text-primary hover:underline">
                    {u.label}
                  </Link>
                  <span className={`shrink-0 text-xs ${u.overdue ? "font-medium text-sev-critical" : "text-muted-foreground"}`}>
                    {u.overdue ? "Overdue · " : ""}
                    <DateText value={u.due} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Recent important events" description="Approvals, denials, imports and other material changes.">
          {recent.isPending ? (
            <LoadingState rows={3} />
          ) : (recent.data?.events.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No recent events.</p>
          ) : (
            <ul className="divide-y">
              {recent.data!.events.slice(0, 8).map((e) => (
                <li key={e.id} className="py-2 text-sm">
                  <p className="font-mono text-xs">{e.action}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.actor?.displayName ?? e.actorType} · <DateText value={e.timestamp} relative />
                    {e.outcome !== "success" && <span className="ml-1 text-sev-critical">({e.outcome})</span>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {can("audit.read") && (
            <Link href="/audit-log" className="mt-2 inline-block text-xs text-primary hover:underline">
              Full audit log
            </Link>
          )}
        </Section>
        <Section title="Recent workflow failures" description="Failed automation is shown here instead of presenting stale data as current.">
          {recent.isPending ? (
            <LoadingState rows={3} />
          ) : (recent.data?.workflowFailures.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No recent failures.</p>
          ) : (
            <ul className="divide-y">
              {recent.data!.workflowFailures.map((f) => (
                <li key={f.id} className="py-2 text-sm">
                  <Link href={`/workflows/runs/${f.id}`} className="text-primary hover:underline">
                    {f.workflow}
                  </Link>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <StatusBadge status={f.status} /> {f.errorCode} · attempt {f.attemptCount} · <DateText value={f.createdAt} relative />
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
