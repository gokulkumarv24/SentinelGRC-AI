"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot, FilePlus2, Play, Send, ShieldPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DraftView, isDraft, type AiArtifact, type ArtifactType, type DraftOutput } from "@/components/ai/ai-assist";
import { humanize, StatusBadge } from "@/components/common/badges";
import { DateText } from "@/components/common/date-text";
import { PageHeader, Section } from "@/components/common/page-header";
import { QueryState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

interface Job {
  id: string;
  version: number;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  triggerType: "event" | "schedule" | "manual";
  eventType: string | null;
  intervalHours: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRun: { id: string; status: string; createdAt: string; resultSummary: { result?: Record<string, unknown> } | null } | null;
}
interface Overview {
  draftsLast24h: number;
  tokensLast24h: number;
  dailyTokenBudget: number;
  budgetRemaining: number;
  blockedReason: string | null;
  jobs: Job[];
  pendingReview: Partial<Record<ArtifactType, number>>;
}

const BLOCKED: Record<string, string> = {
  ai_disabled: "AI is switched off on this platform (AI_ENABLED). The agent does nothing until it is switched on.",
  ai_disabled_for_organization: "AI is switched off for this organization (Organization Settings).",
  data_sharing_not_approved: "Sending data to the AI provider has not been approved (AI_DATA_SHARING_APPROVED).",
  budget_exhausted: "Today's AI token budget is used up. The agent continues automatically when it frees up.",
};

/** Where to review a draft, by the kind of record it is about. */
function recordLink(a: AiArtifact): string | null {
  const id = a.targetId;
  if (!id) return null;
  switch (a.artifactType) {
    case "evidence_review":
    case "vendor_document_analysis":
    case "evidence_request":
      return `/evidence/${id}`;
    case "finding_triage":
      return `/findings/${id}`;
    case "vendor_response_review":
    case "vendor_decision_memo":
    case "vendor_observations":
      return `/vendors/assessments/${id}`;
    case "vendor_profile_review":
    case "vendor_followup":
      return `/vendors/${id}`;
    case "ai_system_prefill":
      return `/ai-governance/${id}`;
    case "ai_change_impact":
      return "/ai-governance/changes";
    case "report_draft":
      return "/reports";
    case "questionnaire_answers":
      return `/trust/questionnaires/${id}`;
    case "mapping_suggestions":
      return "/compliance/mappings";
    default:
      return null;
  }
}

const trigger = (j: Job) => (j.triggerType === "event" ? `When ${humanize(j.eventType ?? "event").toLowerCase()}` : j.triggerType === "schedule" ? `Every ${j.intervalHours && j.intervalHours >= 24 ? `${j.intervalHours / 24} day(s)` : `${j.intervalHours} hour(s)`}` : "On request");

function Ask() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AiArtifact | null>(null);
  const ask = useApiMutation({ mutationFn: (q: string) => api.post<AiArtifact>("/ai/ask", { question: q }), onSuccess: (a) => setAnswer(a) });
  return (
    <Section title="Ask the platform" description="Questions about your own records, answered with links to the sources. Only records you may read are used.">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length >= 3) ask.mutate(question.trim());
        }}
      >
        <Input aria-label="Question" placeholder="e.g. Which vendors have overdue reassessments? What evidence expires this month?" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} />
        <Button type="submit" disabled={ask.isPending || question.trim().length < 3}>
          <Send aria-hidden /> {ask.isPending ? "Thinking…" : "Ask"}
        </Button>
      </form>
      {answer && <div className="mt-3"><DraftView artifact={answer} /></div>}
    </Section>
  );
}

function RiskProposals() {
  const can = useCan();
  const query = useQuery({ queryKey: ["ai", "drafts", "risk_proposals", "latest"], queryFn: () => api.get<Page<AiArtifact>>("/ai/drafts", { artifactType: "risk_proposals", pageSize: 1, page: 1, sort: "createdAt", order: "desc" }) });
  const [created, setCreated] = useState<Set<string>>(new Set());
  const create = useApiMutation({
    mutationFn: (p: { title: string; category: string; likelihood: number; impact: number; description?: string }) => api.post("/risks", { title: p.title, category: p.category, likelihood: p.likelihood, impact: p.impact, description: p.description || p.title }),
    success: "Risk created in the register",
    invalidate: [["risks"]],
    onSuccess: (_r, p) => setCreated((s) => new Set(s).add(p.title)),
  });
  const latest = query.data?.items[0];
  if (!latest) return <p className="text-sm text-muted-foreground">No risk proposals yet. The agent looks for new risks every week, or run “AI agent: risk spotting” below.</p>;
  const actions = (o: DraftOutput) =>
    can("risk.create")
      ? o.suggestions
          .filter((s) => s.label === "new_risk")
          .map((s) => {
            let p: { title: string; category: string; likelihood: number; impact: number; description?: string };
            try {
              p = JSON.parse(s.value);
            } catch {
              return null;
            }
            return (
              <Button key={s.value} size="xs" variant="outline" disabled={created.has(p.title) || create.isPending} onClick={() => create.mutate(p)}>
                <ShieldPlus aria-hidden /> {created.has(p.title) ? "Created" : `Create risk: ${p.title.slice(0, 40)}`}
              </Button>
            );
          })
      : null;
  return <DraftView artifact={latest} actions={actions} />;
}

function LatestDraft({ type, empty }: { type: ArtifactType; empty: string }) {
  const query = useQuery({ queryKey: ["ai", "drafts", type, "latest"], queryFn: () => api.get<Page<AiArtifact>>("/ai/drafts", { artifactType: type, pageSize: 1, page: 1, sort: "createdAt", order: "desc" }) });
  const latest = query.data?.items[0];
  return latest ? <DraftView artifact={latest} /> : <p className="text-sm text-muted-foreground">{empty}</p>;
}

function PolicyDrafter() {
  const can = useCan();
  const { data: me } = useMe();
  const [topic, setTopic] = useState("");
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<AiArtifact | null>(null);
  const controls = useQuery({ queryKey: ["controls", "policy-picker"], queryFn: () => api.get<Page<{ id: string; controlCode: string; title: string }>>("/controls", { pageSize: 100, page: 1 }) });
  const generate = useApiMutation({
    mutationFn: () => api.post<AiArtifact>("/ai/drafts", { artifactType: "policy_draft", targetId: me?.activeOrganizationId, options: { topic: topic.trim(), ...(selected.size ? { controlIds: [...selected] } : {}) } }),
    onSuccess: (a) => setDraft(a),
    success: "Policy draft ready — review it, then accept it to save it as a document",
  });
  const refreshed = useQuery({ queryKey: ["ai", "drafts", "policy", draft?.id], queryFn: () => api.get<AiArtifact>(`/ai/drafts/${draft!.id}`), enabled: !!draft });
  const save = useApiMutation({ mutationFn: (id: string) => api.post<{ id: string }>(`/ai/drafts/${id}/save-policy`), success: "Saved to the evidence library for review", invalidate: [["evidence"], ["ai"]] });
  const current = refreshed.data ?? draft;
  const visible = (controls.data?.items ?? []).filter((c) => !filter || `${c.controlCode} ${c.title}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Section title="Draft a policy" description="The agent writes a policy from your own controls. Accept it, then save it to the evidence library as a policy document.">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
        <div className="space-y-2">
          <Input aria-label="Policy topic" placeholder="Topic, e.g. Access control, Backup and recovery" value={topic} maxLength={200} onChange={(e) => setTopic(e.target.value)} />
          <Button onClick={() => generate.mutate(undefined)} disabled={!topic.trim() || generate.isPending}>
            <FilePlus2 aria-hidden /> {generate.isPending ? "Drafting…" : "Draft policy"}
          </Button>
          <p className="text-xs text-muted-foreground">{selected.size ? `${selected.size} control(s) selected.` : "No controls selected: controls matching the topic are used."}</p>
        </div>
        <div className="space-y-2">
          <Input aria-label="Filter controls" placeholder="Filter controls" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul className="max-h-48 space-y-1 overflow-auto rounded-md border p-2 text-sm">
            {visible.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <Checkbox
                  id={`pc-${c.id}`}
                  checked={selected.has(c.id)}
                  onCheckedChange={(v) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (v) n.add(c.id);
                      else n.delete(c.id);
                      return n;
                    })
                  }
                />
                <label htmlFor={`pc-${c.id}`}>{c.controlCode} {c.title}</label>
              </li>
            ))}
            {!visible.length && <li className="text-muted-foreground">No controls.</li>}
          </ul>
        </div>
      </div>
      {current && (
        <div className="mt-3">
          <DraftView
            artifact={current}
            actions={(_o, a) =>
              can("evidence.upload") && (a.decision === "accepted" || a.decision === "edited_and_accepted") ? (
                <Button size="xs" disabled={!!a.usedInRecordId || save.isPending} onClick={() => save.mutate(a.id, { onSuccess: () => refreshed.refetch() })}>
                  {a.usedInRecordId ? "Saved as a policy document" : "Save as policy document"}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">Accept the draft to save it as a policy document.</span>
              )
            }
          />
          {current.usedInRecordId && <Link className="text-sm text-primary hover:underline" href={`/evidence/${current.usedInRecordId}`}>Open the policy document</Link>}
        </div>
      )}
    </Section>
  );
}

function Jobs({ jobs }: { jobs: Job[] }) {
  const can = useCan();
  const toggle = useApiMutation({ mutationFn: (j: Job) => api.patch(`/workflows/${j.id}`, { enabled: !j.enabled, version: j.version }), success: "Agent job updated", invalidate: [["agent"], ["workflows"]] });
  const run = useApiMutation({ mutationFn: (j: Job) => api.post(`/workflows/${j.id}/run`), success: "Queued — results appear here and on Runs and Failures", invalidate: [["agent"]] });
  return (
    <ul className="divide-y rounded-md border">
      {jobs.map((j) => {
        const result = j.lastRun?.resultSummary?.result;
        return (
          <li key={j.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-medium">{j.name.replace(/^AI agent: /, "")}</p>
              <p className="text-xs text-muted-foreground">{j.description}</p>
              <p className="mt-1 text-xs">
                {trigger(j)} ·{" "}
                {j.lastRun ? (
                  <>
                    last run <Link className="text-primary hover:underline" href={`/workflows/runs/${j.lastRun.id}`}><DateText value={j.lastRun.createdAt} relative /></Link> <StatusBadge status={j.lastRun.status} />
                    {result?.skipped ? <span className="text-muted-foreground"> · skipped: {humanize(String(result.skipped))}</span> : null}
                  </>
                ) : (
                  "not run yet"
                )}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {j.triggerType === "schedule" && can("workflow.run") && (
                <Button size="xs" variant="outline" disabled={!j.enabled || run.isPending} onClick={() => run.mutate(j)}>
                  <Play aria-hidden /> Run now
                </Button>
              )}
              <Switch aria-label={`${j.enabled ? "Turn off" : "Turn on"} ${j.name}`} checked={j.enabled} disabled={!can("workflow.manage") || toggle.isPending} onCheckedChange={() => toggle.mutate(j)} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Pending() {
  const query = useQuery({ queryKey: ["ai", "drafts", "agent-pending"], queryFn: () => api.get<Page<AiArtifact>>("/ai/drafts", { origin: "agent", decision: "pending", status: "draft", pageSize: 25, page: 1, sort: "createdAt", order: "desc" }) });
  return (
    <QueryState query={query} rows={3} empty={(d) => (d.items.length ? null : <p className="text-sm text-muted-foreground">Nothing waiting. Drafts appear here as the agent prepares them.</p>)}>
      {(d) => (
        <ul className="divide-y rounded-md border text-sm">
          {d.items.map((a) => {
            const href = recordLink(a);
            const summary = isDraft(a.output) ? a.output.summary : "";
            return (
              <li key={a.id} className="flex flex-col gap-1 p-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">{humanize(a.artifactType)}{a.sourceRecords[0] ? <span className="font-normal text-muted-foreground"> · {a.sourceRecords[0].label}</span> : null}</p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{summary}</p>
                </div>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <DateText value={a.createdAt} relative />
                  {href && <Link className="text-primary hover:underline" href={href}>Review</Link>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </QueryState>
  );
}

export default function AgentPage() {
  const query = useQuery({ queryKey: ["agent"], queryFn: () => api.get<Overview>("/ai/agent"), refetchInterval: 60_000 });
  return (
    <>
      <PageHeader
        title="AI agent"
        description="Background jobs that prepare reviews, triage, answers and drafts so your team only checks and decides. The agent never approves, closes or sends anything on its own."
        crumbs={[{ label: "AI Agent" }]}
      />
      <QueryState query={query} rows={6}>
        {(o) => {
          const pending = Object.values(o.pendingReview).reduce((a, b) => a + (b ?? 0), 0);
          const used = o.dailyTokenBudget ? Math.min(100, Math.round((o.tokensLast24h / o.dailyTokenBudget) * 100)) : 0;
          return (
            <div className="space-y-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border p-3">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Bot className="size-3.5" aria-hidden /> Status</p>
                  <p className="mt-1 font-medium">{o.blockedReason ? "Paused" : "Working"}</p>
                  {o.blockedReason && <p className="text-xs text-muted-foreground">{BLOCKED[o.blockedReason] ?? humanize(o.blockedReason)}</p>}
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">AI usage, last 24 hours</p>
                  <p className="mt-1 font-medium">{o.tokensLast24h.toLocaleString()} / {o.dailyTokenBudget.toLocaleString()} tokens</p>
                  <Progress value={used} aria-label="Daily AI budget used" className="mt-2" />
                  <p className="mt-1 text-xs text-muted-foreground">{o.draftsLast24h} draft(s) prepared</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Waiting for your review</p>
                  <p className="mt-1 font-medium">{pending} draft(s)</p>
                </div>
              </div>
              <Ask />
              <Section title="Waiting for review" description="Drafts the agent prepared. Open the record to apply or reject them.">
                <Pending />
              </Section>
              <div className="grid gap-6 xl:grid-cols-2">
                <Section title="Proposed risks" description="From recent findings, AI incidents and high-risk vendors.">
                  <RiskProposals />
                </Section>
                <Section title="Vendor digest" description="Vendors that need attention this week.">
                  <LatestDraft type="vendor_portfolio_digest" empty='No digest yet. It is prepared weekly, or run "AI agent: weekly vendor digest" below.' />
                </Section>
              </div>
              <PolicyDrafter />
              <Section title="Agent jobs" description="Each job can be switched off. Scheduled jobs can also be run now. Every run is recorded under Automation → Runs and Failures.">
                <Jobs jobs={o.jobs} />
              </Section>
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
