"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IllustrativeBadge, StatusBadge } from "@/components/common/badges";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, QueryState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";

export interface Provider {
  provider: string;
  version: string;
  displayName: string;
  description: string;
  isDemo: boolean;
  requiredScopes: string[];
  recordTypes: string[];
  configurationOptions: Array<{ key: string; label: string; options: string[]; default: string }>;
}
interface Integration {
  id: string;
  provider: string;
  displayName: string;
  status: string;
  isDemo: boolean;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  stale: boolean;
  lastRun: { status: string; recordsProcessed: number; startedAt: string } | null;
}

function AddIntegration({ providers, configured }: { providers: Provider[]; configured: Set<string> }) {
  const router = useRouter();
  const available = providers.filter((p) => !configured.has(p.provider));
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(available[0]?.provider ?? "");
  const selected = providers.find((p) => p.provider === provider);
  const [config, setConfig] = useState<Record<string, string>>({});
  const create = useApiMutation({
    mutationFn: () => api.post<{ id: string }>("/integrations", { provider, configuration: config }),
    success: "Integration configured",
    invalidate: [["integrations"]],
    onSuccess: (r) => router.push(`/integrations/${r.id}`),
  });
  if (!available.length) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> Add integration</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add integration</DialogTitle>
          <DialogDescription>Only connectors listed here are implemented. Credentials are never stored in SentinelGRC; a connector that needs one references an INTEGRATION_* environment variable.</DialogDescription>
        </DialogHeader>
        <form method="post" className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <div className="space-y-1">
            <Label htmlFor="provider">Connector</Label>
            <Select value={provider} onValueChange={(v) => { setProvider(v); setConfig({}); }}>
              <SelectTrigger id="provider" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{available.map((p) => <SelectItem key={p.provider} value={p.provider}>{p.displayName}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {selected && (
            <>
              <p className="text-xs text-muted-foreground">{selected.description}</p>
              {selected.configurationOptions.map((o) => (
                <div key={o.key} className="space-y-1">
                  <Label htmlFor={o.key}>{o.label}</Label>
                  <Select value={config[o.key] ?? o.default} onValueChange={(v) => setConfig({ ...config, [o.key]: v })}>
                    <SelectTrigger id={o.key} className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>{o.options.map((v) => <SelectItem key={v} value={v}>{v.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </>
          )}
          <DialogFooter><Button type="submit" disabled={!provider || create.isPending}>Add</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function IntegrationsPage() {
  const can = useCan();
  const integrations = useQuery({ queryKey: ["integrations"], queryFn: () => api.get<Integration[]>("/integrations"), refetchInterval: 15_000 });
  const providers = useQuery({ queryKey: ["integrations", "providers"], queryFn: () => api.get<Provider[]>("/integrations/providers") });
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connectors collect facts that automated control checks use. When a sync fails, dependent checks report unknown instead of trusting stale data."
        crumbs={[{ label: "Automation" }, { label: "Integrations" }]}
        actions={can("integration.manage") && providers.data && integrations.data && <AddIntegration providers={providers.data} configured={new Set(integrations.data.map((i) => i.provider))} />}
      />
      <QueryState query={integrations}>
        {(items) =>
          items.length === 0 ? (
            <EmptyState title="No integrations configured" description="Add the demo identity provider to see how synced facts drive control checks such as MFA and privileged access reviews." />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((i) => (
                <li key={i.id}>
                  <Link href={`/integrations/${i.id}`} className="block h-full rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{i.displayName}</span>
                      <StatusBadge status={i.status} />
                      {i.isDemo && <IllustrativeBadge label="Demo data" />}
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">{i.provider}</p>
                    {i.stale && (
                      <p className="mt-2 flex items-center gap-1 text-xs font-medium text-sev-high">
                        <AlertTriangle className="size-3.5" aria-hidden /> Last sync failed ({i.lastErrorCode ?? "error"}) — data may be out of date
                      </p>
                    )}
                    <dl className="mt-3 grid grid-cols-2 gap-1 text-xs">
                      <dt className="text-muted-foreground">Last success</dt>
                      <dd><DateText value={i.lastSuccessAt} relative /></dd>
                      <dt className="text-muted-foreground">Last run</dt>
                      <dd>{i.lastRun ? <>{i.lastRun.recordsProcessed} records · <DateText value={i.lastRun.startedAt} relative /></> : "Never synced"}</dd>
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </>
  );
}
