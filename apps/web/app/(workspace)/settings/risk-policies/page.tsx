"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { StatusBadge } from "@/components/common/badges";
import { DateText } from "@/components/common/date-text";
import { PageHeader, Section } from "@/components/common/page-header";
import { QueryState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";

interface Policy {
  id: string;
  kind: "risk" | "vendor";
  version: number;
  config: Record<string, unknown>;
  active: boolean;
  rationale: string | null;
  createdAt: string;
}

function RiskTiersForm({ policy }: { policy: Policy }) {
  const can = useCan();
  const cfg = policy.config as { tiers: { low: number; medium: number; high: number }; acceptanceMaxDays: number; sodRequiredFrom: string };
  const [tiers, setTiers] = useState(cfg.tiers);
  const [maxDays, setMaxDays] = useState(cfg.acceptanceMaxDays);
  const [rationale, setRationale] = useState("");
  const save = useApiMutation({
    mutationFn: () => api.post("/scoring-policies", { kind: "risk", config: { ...cfg, tiers, acceptanceMaxDays: maxDays }, rationale }),
    success: "New risk policy version saved",
    invalidate: [["policies"], ["risks"]],
    onSuccess: () => setRationale(""),
  });
  const valid = tiers.low < tiers.medium && tiers.medium < tiers.high && tiers.high < 25;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Score = likelihood × impact (1–25). Upper bounds are inclusive; everything above “High” is Critical. These are configurable defaults, not a universal standard.</p>
      <div className="grid gap-3 sm:grid-cols-4">
        {(["low", "medium", "high"] as const).map((k) => (
          <div key={k} className="space-y-1.5">
            <Label htmlFor={k}>{k[0].toUpperCase() + k.slice(1)} up to</Label>
            <Input id={k} type="number" min={1} max={24} value={tiers[k]} disabled={!can("risk_policy.manage")} onChange={(e) => setTiers({ ...tiers, [k]: Number(e.target.value) })} />
          </div>
        ))}
        <div className="space-y-1.5">
          <Label htmlFor="maxDays">Max acceptance (days)</Label>
          <Input id="maxDays" type="number" min={1} max={730} value={maxDays} disabled={!can("risk_policy.manage")} onChange={(e) => setMaxDays(Number(e.target.value))} />
        </div>
      </div>
      {!valid && <p className="text-sm text-destructive">Bounds must increase: low &lt; medium &lt; high &lt; 25.</p>}
      {can("risk_policy.manage") && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="rationale">Reason for change (audited)</Label>
            <Textarea id="rationale" rows={2} value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </div>
          <Button disabled={!valid || !rationale.trim() || save.isPending} onClick={() => save.mutate()}>
            Save as version {policy.version + 1}
          </Button>
          <p className="text-xs text-muted-foreground">Existing risks keep their recorded policy version until they are next re-scored.</p>
        </>
      )}
    </div>
  );
}

export default function RiskPolicies() {
  const query = useQuery({ queryKey: ["policies"], queryFn: () => api.get<Policy[]>("/scoring-policies") });
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Risk policies" description="Versioned scoring policies. Every change creates a new version and an audit event." crumbs={[{ label: "Administration" }, { label: "Risk policies" }]} />
      <QueryState query={query}>
        {(policies) => {
          const risk = policies.find((p) => p.kind === "risk" && p.active);
          const vendor = policies.find((p) => p.kind === "vendor" && p.active);
          return (
            <>
              {risk && (
                <Section title={`Risk scoring · version ${risk.version}`}>
                  <RiskTiersForm key={risk.id} policy={risk} />
                </Section>
              )}
              {vendor && (
                <Section title={`Vendor scoring · version ${vendor.version}`} description="Inherent factors and residual reduction used for vendor assessments.">
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(vendor.config, null, 2)}</pre>
                </Section>
              )}
              <Section title="Version history">
                <ul className="divide-y text-sm">
                  {policies.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span>
                        {p.kind} v{p.version} {p.active && <StatusBadge status="active" />}
                        {p.rationale && <span className="block text-xs text-muted-foreground">{p.rationale}</span>}
                      </span>
                      <DateText value={p.createdAt} withTime />
                    </li>
                  ))}
                </ul>
              </Section>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}
