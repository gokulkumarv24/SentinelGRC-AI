"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, PlugZap, RefreshCw } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { IllustrativeBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DataTable, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useApiMutation } from "@/hooks/use-api-mutation";
import type { ListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";
import type { Provider } from "../page";

interface Detail {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  isDemo: boolean;
  configuration: Record<string, string>;
  configurationReference: string | null;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  stale: boolean;
  createdAt: string;
  adapter: Pick<Provider, "version" | "description" | "requiredScopes" | "configurationOptions" | "isDemo"> | null;
  recordCounts: Array<{ recordType: string; count: number }>;
}
interface SyncRun {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  recordsProcessed: number;
  recordsFailed: number;
  errorSummary: string | null;
  correlationId: string;
}
interface IntegrationRecord {
  id: string;
  recordType: string;
  externalId: string;
  collectedAt: string;
  data: { displayName?: string; role?: string; mfaEnabled?: boolean; lastAccessReviewAt?: string | null };
}

/** Local (non-URL) paging for the two tables on this page; their order is fixed by the API. */
function useLocalParams() {
  const [params, set] = useState<ListParams>({ page: 1, pageSize: 10 });
  return [params, (patch: Partial<ListParams>) => set((p) => ({ ...p, ...patch }) as ListParams)] as const;
}

const runColumns: Column<SyncRun>[] = [
  { id: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
  { id: "started", header: "Started", cell: (r) => <DateText value={r.startedAt} withTime /> },
  { id: "records", header: "Records", cell: (r) => <span className="tabular-nums">{r.recordsProcessed}{r.recordsFailed > 0 && <span className="text-sev-high"> · {r.recordsFailed} rejected</span>}</span> },
  { id: "error", header: "Error", cell: (r) => (r.errorSummary ? <span className="font-mono text-xs">{r.errorSummary}</span> : "—") },
  { id: "corr", header: "Correlation ID", cell: (r) => <span className="font-mono text-[11px] text-muted-foreground">{r.correlationId.slice(0, 8)}</span>, hideOnMobile: true },
];

const recordColumns: Column<IntegrationRecord>[] = [
  { id: "account", header: "Account", cell: (r) => <span>{r.data.displayName ?? r.externalId}<span className="block font-mono text-xs text-muted-foreground">{r.externalId}</span></span> },
  { id: "role", header: "Role", cell: (r) => r.data.role ?? "—", hideOnMobile: true },
  { id: "mfa", header: "MFA", cell: (r) => (r.data.mfaEnabled === undefined ? "—" : <StatusBadge status={r.data.mfaEnabled ? "pass" : "fail"} label={r.data.mfaEnabled ? "Enabled" : "Not enabled"} />) },
  { id: "review", header: "Last access review", cell: (r) => (r.data.lastAccessReviewAt ? <DateText value={r.data.lastAccessReviewAt} /> : <span className="text-xs text-sev-high">Never reviewed</span>) },
  { id: "collected", header: "Collected", cell: (r) => <DateText value={r.collectedAt} relative />, hideOnMobile: true },
];

function Settings({ integration }: { integration: Detail }) {
  const [config, setConfig] = useState(integration.configuration);
  const [reference, setReference] = useState(integration.configurationReference ?? "");
  const save = useApiMutation({
    mutationFn: () => api.patch(`/integrations/${integration.id}`, { configuration: config, configurationReference: reference || null }),
    success: "Settings saved",
    invalidate: [["integrations"]],
  });
  return (
    <form method="post" className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      {integration.adapter?.configurationOptions.map((o) => (
        <div key={o.key} className="space-y-1">
          <Label htmlFor={`cfg-${o.key}`}>{o.label}</Label>
          <Select value={config[o.key] ?? o.default} onValueChange={(v) => setConfig({ ...config, [o.key]: v })}>
            <SelectTrigger id={`cfg-${o.key}`} className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{o.options.map((v) => <SelectItem key={v} value={v}>{v.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      ))}
      <div className="space-y-1">
        <Label htmlFor="secret-ref">Secret reference (optional)</Label>
        <Input id="secret-ref" placeholder="INTEGRATION_EXAMPLE_TOKEN" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} pattern="INTEGRATION_[A-Z0-9_]+" aria-describedby="secret-ref-help" />
        <p id="secret-ref-help" className="text-xs text-muted-foreground">The name of an environment variable on the server, never the secret itself.</p>
      </div>
      <Button type="submit" disabled={save.isPending}>Save settings</Button>
    </form>
  );
}

export default function IntegrationPage({ params }: PageProps<"/integrations/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const query = useQuery({ queryKey: ["integrations", id], queryFn: () => api.get<Detail>(`/integrations/${id}`), refetchInterval: 10_000 });
  const [runParams, setRunParams] = useLocalParams();
  const [recParams, setRecParams] = useLocalParams();
  const runs = useQuery({ queryKey: ["integrations", id, "runs", runParams], queryFn: () => api.get<Page<SyncRun>>(`/integrations/${id}/sync-runs`, runParams), refetchInterval: 10_000 });
  const records = useQuery({ queryKey: ["integrations", id, "records", recParams], queryFn: () => api.get<Page<IntegrationRecord>>(`/integrations/${id}/records`, recParams) });
  const [lastQueued, setLastQueued] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const test = useApiMutation({ mutationFn: () => api.post<{ ok: boolean; message: string }>(`/integrations/${id}/test`), onSuccess: setTestResult });
  const sync = useApiMutation({ mutationFn: () => api.post<{ workflowRunId: string }>(`/integrations/${id}/sync`), success: "Sync queued — the worker runs it shortly", invalidate: [["workflow-runs"]], onSuccess: (r) => setLastQueued(r.workflowRunId) });
  const toggle = useApiMutation({ mutationFn: (enabled: boolean) => api.patch(`/integrations/${id}`, { enabled }), success: "Integration updated", invalidate: [["integrations"]] });

  if (query.isPending) return <LoadingState rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const i = query.data;
  const disabled = i.status === "disabled";

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Integrations", href: "/integrations" }, { label: i.displayName }]}
        title={i.displayName}
        meta={<><StatusBadge status={i.status} />{i.isDemo && <IllustrativeBadge label="Demo data" />}<span className="font-mono text-xs text-muted-foreground">{i.provider} v{i.adapter?.version}</span></>}
        actions={
          <>
            {can("integration.sync") && <Button variant="outline" onClick={() => test.mutate()} disabled={disabled || test.isPending}><PlugZap /> Test connection</Button>}
            {can("integration.sync") && <Button onClick={() => sync.mutate()} disabled={disabled || sync.isPending}><RefreshCw /> Sync now</Button>}
            {can("integration.manage") &&
              (disabled ? (
                <Button variant="outline" onClick={() => toggle.mutate(true)}>Enable</Button>
              ) : (
                <ConfirmDialog trigger={<Button variant="outline">Disable</Button>} title="Disable this integration?" description="Scheduled syncs stop and checks that depend on it report unknown. Collected records are kept." confirmLabel="Disable" destructive onConfirm={() => toggle.mutateAsync(false)} />
              ))}
          </>
        }
      />
      {i.stale && (
        <div role="alert" className="mb-4 flex gap-2 rounded-lg border border-sev-high/40 bg-sev-high-bg p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-sev-high" aria-hidden />
          <p>The last sync failed (<span className="font-mono">{i.lastErrorCode}</span>) <DateText value={i.lastFailureAt} relative />. Records below are from the last successful sync and checks using them report <strong>unknown</strong> until a sync succeeds.</p>
        </div>
      )}
      {testResult && (
        <p role="status" className={`mb-4 rounded-lg border p-3 text-sm ${testResult.ok ? "border-ok/40 bg-ok-bg" : "border-sev-critical/40 bg-sev-critical-bg"}`}>
          Connection test {testResult.ok ? "passed" : "failed"}: {testResult.message}
        </p>
      )}
      {lastQueued && (
        <p role="status" className="mb-4 text-sm">
          Sync queued. <Link className="text-primary hover:underline" href={`/workflows/runs/${lastQueued}`}>Follow the workflow run</Link>.
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Tabs defaultValue="records" className="min-w-0">
          <TabsList className="mb-3">
            <TabsTrigger value="records">Records ({i.recordCounts.reduce((n, c) => n + c.count, 0)})</TabsTrigger>
            <TabsTrigger value="runs">Sync history</TabsTrigger>
          </TabsList>
          <TabsContent value="records">
            <DataTable caption="Collected records" columns={recordColumns} query={records} params={recParams} setParams={setRecParams} rowKey={(r) => r.id} empty={{ title: "No records yet", description: "Run a sync to collect records." }} />
          </TabsContent>
          <TabsContent value="runs">
            <DataTable caption="Sync history" columns={runColumns} query={runs} params={runParams} setParams={setRunParams} rowKey={(r) => r.id} empty={{ title: "Never synced" }} />
          </TabsContent>
        </Tabs>
        <div className="space-y-4">
          <Section title="About">
            <p className="mb-3 text-sm">{i.adapter?.description}</p>
            <DetailList
              items={[
                { label: "Scopes", value: i.adapter?.requiredScopes.join(", ") ?? "—" },
                { label: "Last success", value: <DateText value={i.lastSuccessAt} withTime /> },
                { label: "Last failure", value: <DateText value={i.lastFailureAt} withTime /> },
                { label: "Configured", value: <DateText value={i.createdAt} /> },
              ]}
            />
          </Section>
          {can("integration.manage") && (
            <Section title="Settings">
              <Settings key={JSON.stringify(i.configuration) + i.configurationReference} integration={i} />
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
