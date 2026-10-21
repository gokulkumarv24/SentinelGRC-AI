"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { IllustrativeBadge } from "@/components/common/badges";
import { PageHeader, Section } from "@/components/common/page-header";
import { QueryState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { FrameworkRow } from "@/lib/types";

function ScopeForm({ frameworks }: { frameworks: FrameworkRow[] }) {
  const can = useCan();
  const [selected, setSelected] = useState(() => new Set(frameworks.filter((f) => f.inScope).map((f) => f.id)));
  const save = useApiMutation({ mutationFn: () => api.put("/frameworks/scope", { frameworkIds: [...selected] }), success: "Framework scope saved", invalidate: [["frameworks"], ["compliance"], ["dashboard"]] });
  return (
    <div className="space-y-2">
      {frameworks.map((f) => (
        <label key={f.id} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/40">
          <Checkbox
            checked={selected.has(f.id)}
            disabled={!can("framework.manage")}
            onCheckedChange={(c) => {
              const next = new Set(selected);
              if (c) next.add(f.id);
              else next.delete(f.id);
              setSelected(next);
            }}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="font-medium">
              {f.name} {f.version}
            </span>
            {f.isIllustrative && <IllustrativeBadge />}
            <span className="block text-xs text-muted-foreground">{f.licenseNotes}</span>
          </span>
        </label>
      ))}
      {can("framework.manage") && (
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save scope"}
        </Button>
      )}
    </div>
  );
}

export default function FrameworkSettings() {
  const query = useQuery({ queryKey: ["frameworks"], queryFn: () => api.get<FrameworkRow[]>("/frameworks") });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Framework settings" description="Choose which framework versions your organization measures compliance against. Applicability of GDPR and the EU AI Act requires legal review." crumbs={[{ label: "Administration" }, { label: "Framework settings" }]} />
      <Section title="Frameworks in scope">
        <QueryState query={query}>{(rows) => <ScopeForm frameworks={rows} />}</QueryState>
      </Section>
    </div>
  );
}
