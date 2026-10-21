"use client";

import { AiAssist, useAiStatus } from "@/components/ai/ai-assist";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Link2, Sparkles } from "lucide-react";
import Link from "next/link";
import { use, useMemo, useState } from "react";
import { IllustrativeBadge, StatusBadge } from "@/components/common/badges";
import { DateText } from "@/components/common/date-text";
import { LinkDialog } from "@/components/common/link-dialog";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { controlOption } from "@/components/common/record-picker";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";

interface Requirement {
  id: string;
  requirementCode: string;
  parentCode: string | null;
  groupName: string | null;
  title: string;
  summary: string | null;
  officialReference: string | null;
  controls: Array<{ id: string; controlCode: string; title: string; reviewStatus: string }>;
}
interface FrameworkDetail {
  id: string;
  key: string;
  name: string;
  publisher: string;
  version: string;
  sourceUrl: string | null;
  retrievedAt: string | null;
  releaseDate: string | null;
  licenseNotes: string | null;
  description: string | null;
  isIllustrative: boolean;
  scope: string;
  inScope: boolean;
  importProvenance: { obligationSchedule?: { checkedAt: string; sources: string[]; verifyBeforeRelying: boolean; items: Array<{ key: string; label: string; appliesFrom: string; provision: string }> } | null };
  requirements: Requirement[];
}
interface FrameworkCompliance {
  requirementCoverage: number | null;
  metrics: { controls: number; implementationCoverage: number | null; testPassRate: number | null; evidenceCurrency: number | null };
  requirementStatus: Array<{ id: string; code: string; controls: number; metrics: { testPassRate: number | null; evidenceCurrency: number | null; implementationCoverage: number | null } | null }>;
}

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);

export default function FrameworkDetailPage({ params }: PageProps<"/compliance/frameworks/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const [filter, setFilter] = useState("");
  const [suggestFor, setSuggestFor] = useState<string | null>(null);
  const ai = useAiStatus();
  const query = useQuery({ queryKey: ["frameworks", id], queryFn: () => api.get<FrameworkDetail>(`/frameworks/${id}`) });
  const compliance = useQuery({ queryKey: ["compliance", id], queryFn: () => api.get<FrameworkCompliance>(`/compliance/frameworks/${id}`) });
  const map = useApiMutation({
    mutationFn: (v: { requirementId: string; controlId: string; rationale: string }) => api.post("/control-mappings", { sourceRequirementId: v.requirementId, controlId: v.controlId, mappingType: "supports", rationale: v.rationale || "Proposed from framework view", confidence: 50 }),
    success: "Mapping proposed — it needs review by another person",
    invalidate: [["frameworks"], ["compliance"], ["mappings"]],
  });
  const statusBy = useMemo(() => new Map((compliance.data?.requirementStatus ?? []).map((r) => [r.id, r])), [compliance.data]);

  if (query.isPending) return <LoadingState rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const fw = query.data;
  const parents = new Set(fw.requirements.map((r) => r.parentCode).filter(Boolean));
  const visible = fw.requirements.filter((r) => !filter || `${r.requirementCode} ${r.title}`.toLowerCase().includes(filter.toLowerCase()));
  const schedule = fw.importProvenance?.obligationSchedule;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Frameworks", href: "/compliance/frameworks" }, { label: `${fw.name} ${fw.version}` }]}
        title={`${fw.name}`}
        description={fw.description}
        meta={
          <>
            <span className="text-xs text-muted-foreground">
              {fw.publisher} · version {fw.version}
            </span>
            {fw.inScope ? <StatusBadge status="active" label="In scope" /> : <StatusBadge status="unreviewed" label="Not in scope" />}
            {fw.isIllustrative && <IllustrativeBadge />}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Requirements" description="Mapped controls are reviewable assertions. Group headings are not scored.">
            <Input placeholder="Filter by code or text" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter requirements" className="mb-3 h-9 sm:w-72" />
            <ul className="divide-y">
              {visible.map((r) => {
                const isGroup = parents.has(r.requirementCode) || !r.parentCode;
                const st = statusBy.get(r.id);
                return (
                  <li key={r.id} className={`py-2 ${isGroup ? "bg-muted/40 px-2" : ""}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className={`text-sm ${isGroup ? "font-semibold" : ""}`}>
                        <span className="font-mono text-xs">{r.requirementCode}</span> {r.title}
                      </p>
                      {!isGroup && can("mapping.manage") && (
                        <LinkDialog
                          trigger={<Button size="xs" variant="ghost"><Link2 aria-hidden /> Map control</Button>}
                          title={`Map a control to ${r.requirementCode}`}
                          description="The mapping is proposed for review; it does not claim equivalence."
                          endpoint="/controls"
                          toOption={controlOption}
                          noteLabel="Rationale"
                          onLink={(o, note) => map.mutateAsync({ requirementId: r.id, controlId: o.id, rationale: note })}
                        />
                      )}
                    </div>
                    {r.summary && !isGroup && <p className="text-xs text-muted-foreground">{r.summary}</p>}
                    {!isGroup && r.controls.length === 0 && can("mapping.manage") && ai.data?.enabled && (
                      suggestFor === r.id ? (
                        <div className="mt-2"><AiAssist artifactType="mapping_suggestions" targetId={r.id} title="Candidate controls (AI draft)" /></div>
                      ) : (
                        <Button size="xs" variant="link" className="h-auto px-0" onClick={() => setSuggestFor(r.id)}><Sparkles aria-hidden /> Suggest controls</Button>
                      )
                    )}
                    {!isGroup && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                        {r.controls.length === 0 ? (
                          <span className="text-muted-foreground">No mapped controls</span>
                        ) : (
                          r.controls.map((c) => (
                            <Link key={c.id} href={`/controls/${c.id}`} className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 hover:border-primary">
                              <span className="font-mono">{c.controlCode}</span>
                              {c.reviewStatus !== "approved" && <span className="text-muted-foreground">({c.reviewStatus.replace(/_/g, " ")})</span>}
                            </Link>
                          ))
                        )}
                        {st?.metrics && (
                          <span className="text-muted-foreground">
                            · pass rate {pct(st.metrics.testPassRate)} · evidence {pct(st.metrics.evidenceCurrency)}
                          </span>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Compliance (this framework)" description="Over controls mapped to this framework version.">
            {compliance.isPending ? (
              <LoadingState rows={2} />
            ) : compliance.isError ? (
              <ErrorState error={compliance.error} />
            ) : (
              <DetailList
                items={[
                  { label: "Requirement coverage", value: pct(compliance.data.requirementCoverage) },
                  { label: "Mapped controls", value: compliance.data.metrics.controls },
                  { label: "Implementation coverage", value: pct(compliance.data.metrics.implementationCoverage) },
                  { label: "Latest test pass rate", value: pct(compliance.data.metrics.testPassRate) },
                  { label: "Evidence currency", value: pct(compliance.data.metrics.evidenceCurrency) },
                ]}
              />
            )}
          </Section>
          <Section title="Provenance">
            <DetailList
              items={[
                { label: "Scope", value: fw.scope === "platform" ? "Platform reference data" : "Organization-specific" },
                { label: "Release date", value: <DateText value={fw.releaseDate} /> },
                { label: "Retrieved", value: <DateText value={fw.retrievedAt} /> },
                { label: "Source", value: fw.sourceUrl && <a href={fw.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Official source <ExternalLink className="size-3" aria-hidden /></a> },
              ]}
            />
            {fw.licenseNotes && <p className="mt-3 text-xs text-muted-foreground">{fw.licenseNotes}</p>}
          </Section>
          {schedule && (
            <Section title="Obligation schedule" description={`Configurable dates, checked ${schedule.checkedAt}. Preliminary — verify against the official text and obtain legal review.`}>
              <ul className="space-y-2 text-xs">
                {schedule.items.map((i) => (
                  <li key={i.key}>
                    <p className="font-medium">{i.label}</p>
                    <p className="text-muted-foreground">
                      Applies from <DateText value={i.appliesFrom} /> · {i.provision}
                    </p>
                  </li>
                ))}
              </ul>
              <ul className="mt-3 space-y-1 text-xs">
                {schedule.sources.map((s) => (
                  <li key={s}>
                    <a href={s} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
                      {s}
                    </a>
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
