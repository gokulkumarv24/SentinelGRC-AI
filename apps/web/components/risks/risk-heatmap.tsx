"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Heatmap {
  basis: "inherent" | "residual";
  policyVersion: number;
  tiers: { low: number; medium: number; high: number };
  cells: Array<{ likelihood: number; impact: number; count: number }>;
}

const TIER_CLASS = {
  low: "bg-sev-low-bg text-sev-low",
  medium: "bg-sev-medium-bg text-sev-medium",
  high: "bg-sev-high-bg text-sev-high",
  critical: "bg-sev-critical-bg text-sev-critical",
};

/** 5×5 likelihood × impact matrix. Each cell prints its count and tier name, so colour is not the only signal. */
export function RiskHeatmap() {
  const [basis, setBasis] = useState<"inherent" | "residual">("inherent");
  const query = useQuery({ queryKey: ["risks", "heatmap", basis], queryFn: () => api.get<Heatmap>("/risks/heatmap", { basis }) });
  if (query.isPending) return <LoadingState rows={3} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const { tiers, cells, policyVersion } = query.data;
  const count = (l: number, i: number) => cells.find((c) => c.likelihood === l && c.impact === i)?.count ?? 0;
  const tier = (score: number) => (score <= tiers.low ? "low" : score <= tiers.medium ? "medium" : score <= tiers.high ? "high" : "critical");

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Open risks by {basis} likelihood × impact · scoring policy v{policyVersion}</p>
        <div role="group" aria-label="Score basis" className="flex rounded-md border p-0.5">
          {(["inherent", "residual"] as const).map((b) => (
            <Button key={b} size="xs" variant={basis === b ? "secondary" : "ghost"} aria-pressed={basis === b} onClick={() => setBasis(b)}>
              {b === "inherent" ? "Inherent" : "Residual"}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex items-center">
          <span className="-rotate-90 text-xs whitespace-nowrap text-muted-foreground">Likelihood →</span>
        </div>
        <div className="flex-1">
          <table className="w-full table-fixed border-separate border-spacing-1" aria-label={`Risk heatmap, ${basis} scores`}>
            <tbody>
              {[5, 4, 3, 2, 1].map((l) => (
                <tr key={l}>
                  <th scope="row" className="w-6 text-xs font-normal text-muted-foreground">
                    {l}
                  </th>
                  {[1, 2, 3, 4, 5].map((i) => {
                    const n = count(l, i);
                    const t = tier(l * i);
                    return (
                      <td key={i} className="p-0">
                        <Link
                          href={`/risks?${basis === "inherent" ? "likelihood" : "residualLikelihood"}=${l}&${basis === "inherent" ? "impact" : "residualImpact"}=${i}`}
                          // Empty cells are subdued with muted colours rather than opacity, so their text keeps AA contrast.
                          className={cn("flex h-12 flex-col items-center justify-center rounded-md text-sm font-semibold hover:ring-2 hover:ring-ring", n === 0 ? "bg-muted text-muted-foreground" : TIER_CLASS[t])}
                        >
                          {n}
                          <span className="text-[10px] font-normal capitalize">{t}</span>
                          {/* The accessible name comes from the visible content plus this context (WCAG 2.5.3). */}
                          <span className="sr-only">: likelihood {l}, impact {i}, {n} risk{n === 1 ? "" : "s"}</span>
                        </Link>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td />
                {[1, 2, 3, 4, 5].map((i) => (
                  <th key={i} scope="col" className="text-xs font-normal text-muted-foreground">
                    {i}
                  </th>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="text-center text-xs text-muted-foreground">Impact →</p>
        </div>
      </div>
    </div>
  );
}
