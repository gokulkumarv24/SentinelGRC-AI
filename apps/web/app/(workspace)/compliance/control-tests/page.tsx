"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Suspense } from "react";
import { StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader, Section } from "@/components/common/page-header";
import { QueryState } from "@/components/common/states";
import { useListParams } from "@/hooks/use-list-params";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

interface TestRow {
  id: string;
  testType: string;
  ruleKey: string | null;
  testRuleVersion: string | null;
  result: string;
  summary: string;
  startedAt: string;
  findingId: string | null;
  control: { id: string; controlCode: string; title: string };
}
interface Rule {
  key: string;
  version: string;
  name: string;
  description: string;
  parameters: string[];
}

const columns: Column<TestRow>[] = [
  { id: "control", header: "Control", cell: (t) => <Link href={`/controls/${t.control.id}`} className="text-primary hover:underline"><span className="font-mono text-xs">{t.control.controlCode}</span> {t.control.title}</Link> },
  { id: "rule", header: "Rule", cell: (t) => <span className="font-mono text-xs">{t.ruleKey}{t.testRuleVersion !== "manual" && `@${t.testRuleVersion}`}</span>, hideOnMobile: true },
  { id: "result", header: "Result", cell: (t) => <StatusBadge status={t.result} /> },
  { id: "summary", header: "Summary", cell: (t) => <span className="text-xs">{t.summary}{t.findingId && <Link href={`/findings/${t.findingId}`} className="ml-1 text-primary hover:underline">finding</Link>}</span> },
  { id: "when", header: "When", cell: (t) => <DateText value={t.startedAt} withTime /> },
];

function ControlTests() {
  const [params, setParams] = useListParams({});
  const query = useQuery({ queryKey: ["control-tests", params], queryFn: () => api.get<Page<TestRow>>("/control-tests", params) });
  const rules = useQuery({ queryKey: ["control-tests", "rules"], queryFn: () => api.get<Rule[]>("/control-tests/rules") });
  return (
    <>
      <PageHeader
        title="Control tests"
        description="Every automated and manual test result. Missing or unreviewed evidence produces unknown — never a pass and never an automatic fail."
        crumbs={[{ label: "Compliance" }, { label: "Control tests" }]}
      />
      <FilterBar params={params} setParams={setParams} filters={[{ key: "result", label: "Result", options: options(["pass", "fail", "unknown", "error", "not_applicable"]) }, { key: "testType", label: "Type", options: options(["automated", "manual"]) }]} />
      <DataTable caption="Control test results" columns={columns} query={query} params={params} setParams={setParams} rowKey={(t) => t.id} empty={{ title: "No tests yet", description: "Configure rules on a control, or let the scheduler run due tests." }} />
      <div className="mt-6">
        <Section title="Available rules" description="Deterministic, versioned rules. Configure them on a control's Tests tab.">
          <QueryState query={rules}>
            {(list) => (
              <ul className="grid gap-3 md:grid-cols-2">
                {list.map((r) => (
                  <li key={r.key} className="rounded-md border p-3 text-sm">
                    <p className="font-medium">
                      {r.name} <span className="font-mono text-xs text-muted-foreground">{r.key}@{r.version}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{r.description}</p>
                    {r.parameters.length > 0 && <p className="mt-1 text-xs">Parameters: <span className="font-mono">{r.parameters.join(", ")}</span></p>}
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        </Section>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ControlTests />
    </Suspense>
  );
}
