"use client";

import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use } from "react";
import { humanize, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText } from "@/components/common/date-text";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";

interface Step {
  id: string;
  stepKey: string;
  status: string;
  outputSummary: Record<string, unknown> | null;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  retryCount: number;
}
interface RunDetail {
  id: string;
  status: string;
  triggerSource: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  correlationId: string;
  initiatedByName: string | null;
  retryOfRunId: string | null;
  resultSummary: Record<string, unknown> | null;
  definition: { id: string; key: string; name: string; triggerType: string };
  steps: Step[];
  retries: Array<{ id: string; status: string; createdAt: string }>;
}

export default function RunPage({ params }: PageProps<"/workflows/runs/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const router = useRouter();
  const query = useQuery({
    queryKey: ["workflow-runs", id],
    queryFn: () => api.get<RunDetail>(`/workflow-runs/${id}`),
    refetchInterval: (q) => (q.state.data && ["queued", "running"].includes(q.state.data.status) ? 5_000 : false),
  });
  const retry = useApiMutation({
    mutationFn: () => api.post<{ id: string }>(`/workflow-runs/${id}/retry`),
    success: "Retry queued",
    invalidate: [["workflow-runs"], ["workflows"]],
    onSuccess: (r) => router.push(`/workflows/runs/${r.id}`),
  });
  if (query.isPending) return <LoadingState rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const r = query.data;
  const retryable = ["failed", "partially_succeeded"].includes(r.status) && !r.retries.some((x) => ["queued", "running"].includes(x.status));
  const { result, ...trigger } = r.resultSummary ?? {};

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Workflows", href: "/workflows" }, { label: "Runs", href: "/workflows/runs" }, { label: r.definition.name }]}
        title={r.definition.name}
        meta={<><StatusBadge status={r.status} /><span className="text-xs text-muted-foreground">{humanize(r.triggerSource)} run · attempt {r.attemptCount} of {r.maxAttempts}</span></>}
        actions={
          can("workflow.retry") && retryable && (
            <ConfirmDialog
              trigger={<Button><RotateCcw /> Retry</Button>}
              title="Retry this run?"
              description="A new linked run is queued with the same input. Workflows are idempotent: findings and notifications that already exist are not duplicated."
              confirmLabel="Queue retry"
              onConfirm={() => retry.mutateAsync()}
            />
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-4">
          {r.errorCode && (
            <div role="alert" className="rounded-lg border border-sev-critical/40 bg-sev-critical-bg p-4 text-sm">
              <p className="font-medium text-sev-critical">{r.status === "queued" ? "Last attempt failed — will retry" : "Run failed"}: <span className="font-mono">{r.errorCode}</span></p>
              {r.errorMessage && <p className="mt-1">{r.errorMessage}</p>}
              {r.status === "queued" && r.nextAttemptAt && <p className="mt-1 text-xs">Next attempt <DateText value={r.nextAttemptAt} withTime /></p>}
            </div>
          )}
          <Section title="Steps" description="Steps that succeeded are not repeated when an attempt is retried.">
            {r.steps.length ? (
              <ol className="divide-y text-sm">
                {r.steps.map((s) => (
                  <li key={s.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={s.status} />
                      <span className="font-mono text-xs">{s.stepKey}</span>
                      {s.retryCount > 0 && <span className="text-xs text-muted-foreground">retried {s.retryCount}×</span>}
                      {s.errorCode && <span className="font-mono text-xs text-sev-critical">{s.errorCode}</span>}
                      <DateText value={s.startedAt} withTime className="ml-auto text-xs text-muted-foreground" />
                    </div>
                    {s.outputSummary && Object.keys(s.outputSummary).length > 0 && (
                      <pre className="mt-1 overflow-x-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(s.outputSummary, null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground">{r.status === "queued" ? "Waiting for the worker." : "No steps recorded."}</p>
            )}
          </Section>
          {result !== undefined && (
            <Section title="Outcome">
              <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>
            </Section>
          )}
        </div>
        <div className="space-y-4">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Workflow", value: <Link href="/workflows" className="text-primary hover:underline">{r.definition.name}</Link> },
                { label: "Trigger", value: humanize(r.triggerSource) },
                { label: "Initiated by", value: r.initiatedByName ?? "System" },
                { label: "Queued", value: <DateText value={r.createdAt} withTime /> },
                { label: "Started", value: <DateText value={r.startedAt} withTime /> },
                { label: "Finished", value: <DateText value={r.completedAt} withTime /> },
                { label: "Correlation ID", value: <span className="font-mono text-xs break-all">{r.correlationId}</span> },
              ]}
            />
          </Section>
          {Object.keys(trigger).length > 0 && (
            <Section title="Input">
              <pre className="overflow-x-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(trigger, null, 2)}</pre>
            </Section>
          )}
          {(r.retryOfRunId || r.retries.length > 0) && (
            <Section title="Retry history">
              <ul className="space-y-1 text-sm">
                {r.retryOfRunId && <li><Link href={`/workflows/runs/${r.retryOfRunId}`} className="text-primary hover:underline">Original run</Link></li>}
                {r.retries.map((x) => (
                  <li key={x.id} className="flex items-center gap-2">
                    <Link href={`/workflows/runs/${x.id}`} className="text-primary hover:underline">Retry · <DateText value={x.createdAt} withTime /></Link>
                    <StatusBadge status={x.status} />
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
