"use client";

import { useQuery } from "@tanstack/react-query";
import { Bot, Check, Sparkles, X } from "lucide-react";
import type { ReactNode } from "react";
import { DateText } from "@/components/common/date-text";
import { humanize, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

export type ArtifactType =
  | "evidence_summary"
  | "evidence_statements"
  | "vendor_observations"
  | "finding_draft"
  | "remediation_options"
  | "risk_summary"
  | "report_draft"
  | "mapping_suggestions"
  | "control_failure_explanation"
  | "evidence_review"
  | "vendor_document_analysis"
  | "vendor_response_review"
  | "vendor_decision_memo"
  | "vendor_profile_review"
  | "vendor_followup"
  | "vendor_portfolio_digest"
  | "finding_triage"
  | "evidence_request"
  | "risk_proposals"
  | "ai_system_prefill"
  | "ai_change_impact"
  | "policy_draft"
  | "platform_answer"
  | "questionnaire_answers";

export interface SourceRef {
  sourceId: string;
  locator?: string;
}
export interface DraftOutput {
  summary: string;
  points: Array<{ text: string; sourceRefs: SourceRef[] }>;
  suggestions: Array<{ label: string; value: string; rationale: string; sourceRefs: SourceRef[] }>;
  limitations: string[];
  confidence: "low" | "medium" | "high";
}
export interface AiArtifact {
  id: string;
  artifactType: ArtifactType;
  status: "draft" | "failed";
  schemaValid: boolean;
  decision: "pending" | "accepted" | "edited_and_accepted" | "rejected";
  origin: "user" | "agent";
  agentJob: string | null;
  targetId: string | null;
  provider: string;
  model: string;
  promptVersion: string;
  output: DraftOutput | { raw: string } | null;
  errorCode: string | null;
  validationErrors: string[] | null;
  limitations: string | null;
  sourceRecords: Array<{ ref: string; type: string; label: string; recordId?: string }>;
  usedInRecordId: string | null;
  createdAt: string;
  reviewedAt: string | null;
}
interface AiStatus {
  enabled: boolean;
  provider: string;
  model: string;
  sendsDataExternally: boolean;
  tasks: Array<{ type: ArtifactType; title: string; allowed: boolean }>;
}

export function useAiStatus() {
  const can = useCan();
  return useQuery({ queryKey: ["ai", "status"], queryFn: () => api.get<AiStatus>("/ai/status"), enabled: can("assistant.use"), staleTime: 60_000 });
}

export const isDraft = (o: AiArtifact["output"]): o is DraftOutput => !!o && "summary" in o;

/** Values the agent encodes as JSON (risk proposals) are shown as readable fields. */
function readableValue(value: string): ReactNode {
  if (!value.startsWith("{")) return value;
  try {
    const v = JSON.parse(value) as Record<string, unknown>;
    return (
      <span className="block">
        {typeof v.title === "string" && <span className="font-medium">{v.title}</span>}
        <span className="block text-xs text-muted-foreground">
          {Object.entries(v)
            .filter(([k]) => k !== "title" && k !== "riskId")
            .map(([k, x]) => `${humanize(k)}: ${String(x)}`)
            .join(" · ")}
        </span>
      </span>
    );
  } catch {
    return value;
  }
}

const SUGGESTION_LABELS: Partial<Record<ArtifactType, string>> = {
  mapping_suggestions: "Candidate control",
  vendor_response_review: "Question",
  questionnaire_answers: "Question",
};

/** Renders one AI draft. Always labelled as a draft; sources and limitations are always visible (spec §11). */
export function DraftView({ artifact, labelFor, actions }: { artifact: AiArtifact; labelFor?: (value: string, label: string) => string; actions?: (output: DraftOutput, artifact: AiArtifact) => ReactNode }) {
  const can = useCan();
  const review = useApiMutation({
    mutationFn: (v: { decision: "accepted" | "rejected"; rationale: string }) => api.post(`/ai/drafts/${artifact.id}/review`, v),
    success: "Review recorded",
    invalidate: [["ai"]],
  });
  const refLabel = (r: SourceRef) => {
    const s = artifact.sourceRecords.find((x) => x.ref === r.sourceId);
    return `${s?.label ?? r.sourceId}${r.locator && r.locator !== s?.label ? ` · ${r.locator.length > 40 ? `${r.locator.slice(0, 8)}…` : r.locator}` : ""}`;
  };
  if (artifact.status === "failed" || !isDraft(artifact.output)) {
    return (
      <div role="alert" className="rounded-md border border-sev-high/40 bg-sev-high-bg p-3 text-sm">
        <p className="font-medium">The AI draft could not be produced ({artifact.errorCode ?? "invalid output"}).</p>
        {artifact.validationErrors?.length ? <ul className="mt-1 list-disc pl-5 text-xs">{artifact.validationErrors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
        <p className="mt-1 text-xs text-muted-foreground">Nothing was changed. You can continue without AI.</p>
      </div>
    );
  }
  const o = artifact.output;
  const special = SUGGESTION_LABELS[artifact.artifactType];
  return (
    <article className="space-y-3 rounded-md border border-dashed bg-muted/30 p-3 text-sm" aria-label="AI draft">
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 font-medium">
          {artifact.origin === "agent" ? <Bot className="size-3" aria-hidden /> : <Sparkles className="size-3" aria-hidden />}
          {artifact.origin === "agent" ? "Prepared by the AI agent" : "AI draft"} — {artifact.decision === "pending" ? "not reviewed" : artifact.decision.replace(/_/g, " ")}
        </span>
        <span className="text-muted-foreground">Confidence {o.confidence} · {artifact.provider}/{artifact.model} · <DateText value={artifact.createdAt} relative /></span>
      </header>
      <p className="whitespace-pre-line">{o.summary}</p>
      {o.points.length > 0 && (
        <ul className="space-y-1.5">
          {o.points.map((p, i) => (
            <li key={i} className="border-l-2 pl-2">
              {p.text}
              <span className="block text-xs text-muted-foreground">Source: {p.sourceRefs.map(refLabel).join("; ") || "none cited"}</span>
            </li>
          ))}
        </ul>
      )}
      {o.suggestions.length > 0 && (
        <dl className="space-y-1.5">
          {o.suggestions.map((s, i) => (
            <div key={i}>
              <dt className="text-xs font-medium text-muted-foreground">{artifact.artifactType === "mapping_suggestions" ? "Candidate control" : special && labelFor ? labelFor(s.label, "label") : humanize(s.label)}</dt>
              <dd>
                <span className="font-medium">{artifact.artifactType === "mapping_suggestions" ? s.label : labelFor ? labelFor(s.value, s.label) : readableValue(s.value)}</span>
                <span className="block text-xs whitespace-pre-line text-muted-foreground">{s.rationale}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      {o.limitations.length > 0 && (
        <div className="text-xs">
          <p className="font-medium">Limitations</p>
          <ul className="list-disc pl-5 text-muted-foreground">{o.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      )}
      {actions && <div className="flex flex-wrap gap-2 border-t pt-2">{actions(o, artifact)}</div>}
      {artifact.decision === "pending" && can("assistant.review") && (
        <div className="flex gap-2">
          <ConfirmDialog trigger={<Button size="xs" variant="outline"><Check /> Accept draft</Button>} title="Accept this AI draft?" description="Accepting records your review. It does not change any record; apply the content yourself where it is useful." requireRationale rationaleLabel="Review note" confirmLabel="Accept" onConfirm={(r) => review.mutateAsync({ decision: "accepted", rationale: r })} />
          <ConfirmDialog trigger={<Button size="xs" variant="ghost"><X /> Reject</Button>} title="Reject this AI draft?" requireRationale rationaleLabel="Why is it wrong or unhelpful?" confirmLabel="Reject" onConfirm={(r) => review.mutateAsync({ decision: "rejected", rationale: r })} />
        </div>
      )}
    </article>
  );
}

/** "Draft with AI" panel for a record. Hidden entirely when AI is disabled or the user lacks permission. */
export function AiAssist({
  artifactType,
  targetId,
  controlId,
  title,
  labelFor,
  actions,
}: {
  artifactType: ArtifactType;
  targetId: string;
  controlId?: string;
  title?: string;
  labelFor?: (value: string, label: string) => string;
  /** One-click ways to apply the draft through the normal, permission-checked APIs. */
  actions?: (output: DraftOutput, artifact: AiArtifact) => ReactNode;
}) {
  const status = useAiStatus();
  const task = status.data?.tasks.find((t) => t.type === artifactType);
  const drafts = useQuery({
    queryKey: ["ai", "drafts", artifactType, targetId],
    queryFn: () => api.get<Page<AiArtifact>>("/ai/drafts", { recordId: targetId, artifactType, pageSize: 1, page: 1, sort: "createdAt", order: "desc" }),
    enabled: !!status.data?.enabled && !!task?.allowed,
  });
  const generate = useApiMutation({
    mutationFn: () => api.post<AiArtifact>("/ai/drafts", { artifactType, targetId, controlId }),
    success: (a) => (a.status === "draft" ? "Draft ready — review before using it" : "The AI draft failed; nothing was changed"),
    invalidate: [["ai", "drafts", artifactType, targetId]],
  });
  if (!status.data?.enabled || !task?.allowed) return null;
  const latest = drafts.data?.items[0];
  return (
    <section className="space-y-2" aria-label={title ?? task.title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{title ?? task.title}</p>
        <Button size="xs" variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending}>
          <Sparkles /> {generate.isPending ? "Drafting…" : latest ? "Draft again" : "Draft with AI"}
        </Button>
      </div>
      {status.data.sendsDataExternally && <p className="text-xs text-muted-foreground">Redacted content is sent to {status.data.provider} ({status.data.model}). Restricted evidence is never sent.</p>}
      {latest ? <DraftView artifact={latest} labelFor={labelFor} actions={actions} /> : <p className="text-xs text-muted-foreground">AI drafts are suggestions only and never change records.</p>}
      {latest && latest.decision !== "pending" && <StatusBadge status={latest.decision === "rejected" ? "rejected" : "approved"} label={`Reviewed: ${latest.decision.replace(/_/g, " ")}`} />}
    </section>
  );
}

/** Reads one structured suggestion from a draft. */
export const suggestionValue = (o: DraftOutput, label: string) => o.suggestions.find((s) => s.label === label)?.value;
