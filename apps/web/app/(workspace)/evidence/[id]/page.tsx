"use client";

import { AiAssist } from "@/components/ai/ai-assist";
import { useQuery } from "@tanstack/react-query";
import { Archive, Download, Eye, Link2, Unlink } from "lucide-react";
import { use, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DateText } from "@/components/common/date-text";
import { AuditTimeline } from "@/components/common/history";
import { DetailList, PageHeader, Section } from "@/components/common/page-header";
import { controlOption, findingOption, RecordPicker, riskOption, type PickerOption } from "@/components/common/record-picker";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import type { EvidenceDetail } from "@/lib/types";
import { formatBytes } from "@/lib/format";

const PREVIEWABLE = new Set(["application/pdf", "image/png", "image/jpeg", "text/plain", "text/csv"]);
const LINK_TARGETS: Record<string, { endpoint: string; toOption: (row: never) => PickerOption; href: string }> = {
  control: { endpoint: "/controls", toOption: controlOption as never, href: "/controls" },
  risk: { endpoint: "/risks", toOption: riskOption as never, href: "/risks" },
  finding: { endpoint: "/findings", toOption: findingOption as never, href: "/findings" },
  vendor: { endpoint: "/vendors", toOption: ((v: { id: string; name: string }) => ({ id: v.id, label: v.name })) as never, href: "/vendors" },
  ai_system: { endpoint: "/ai-systems", toOption: ((s: { id: string; name: string }) => ({ id: s.id, label: s.name })) as never, href: "/ai-governance" },
};

function AddLinkDialog({ evidenceId }: { evidenceId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("control");
  const [target, setTarget] = useState<PickerOption | null>(null);
  const mutation = useApiMutation({
    mutationFn: () => api.post(`/evidence/${evidenceId}/links`, { entityType: type, entityId: target!.id }),
    success: "Linked",
    invalidate: [["evidence"]],
    onSuccess: () => {
      setOpen(false);
      setTarget(null);
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Link2 aria-hidden /> Link to record
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Link evidence to a record</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="link-type">Record type</Label>
            <Select
              value={type}
              onValueChange={(v) => {
                setType(v);
                setTarget(null);
              }}
            >
              <SelectTrigger id="link-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(LINK_TARGETS).map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="link-target">Record</Label>
            <RecordPicker key={type} id="link-target" endpoint={LINK_TARGETS[type].endpoint} toOption={LINK_TARGETS[type].toOption} value={target} onChange={setTarget} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!target || mutation.isPending} onClick={() => mutation.mutate()}>
            Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Preview({ evidence }: { evidence: EvidenceDetail }) {
  const [state, setState] = useState<{ url: string; kind: "image" | "pdf" | "text"; text?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const open = async () => {
    setLoading(true);
    try {
      const { url } = await api.post<{ url: string }>(`/evidence/${evidence.id}/download-url`, { disposition: "inline" });
      const mt = evidence.mediaType ?? "";
      if (mt.startsWith("text/")) {
        const res = await fetch(url, { credentials: "same-origin" });
        setState({ url, kind: "text", text: (await res.text()).slice(0, 200_000) });
      } else setState({ url, kind: mt === "application/pdf" ? "pdf" : "image" });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };
  if (!state)
    return (
      <Button size="sm" variant="outline" onClick={open} disabled={loading}>
        <Eye aria-hidden /> {loading ? "Loading…" : "Preview"}
      </Button>
    );
  return (
    <div className="mt-3 overflow-hidden rounded-md border">
      {/* Short-lived authenticated URL: next/image optimisation cannot (and must not) fetch it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {state.kind === "image" && <img src={state.url} alt={`Preview of ${evidence.title}`} className="max-h-[600px] w-full object-contain" />}
      {state.kind === "pdf" && <iframe src={state.url} title={`Preview of ${evidence.title}`} className="h-[600px] w-full" />}
      {state.kind === "text" && <pre className="max-h-[600px] overflow-auto p-3 text-xs whitespace-pre-wrap">{state.text}</pre>}
    </div>
  );
}

export default function EvidenceDetailPage({ params }: PageProps<"/evidence/[id]">) {
  const { id } = use(params);
  const can = useCan();
  const query = useQuery({ queryKey: ["evidence", id], queryFn: () => api.get<EvidenceDetail>(`/evidence/${id}`) });
  const invalidate = [["evidence"], ["controls"]];
  const review = useApiMutation({ mutationFn: (v: { decision: "approved" | "rejected"; notes: string }) => api.post(`/evidence/${id}/review`, v), success: "Review recorded", invalidate });
  const unlink = useApiMutation({ mutationFn: (linkId: string) => api.delete(`/evidence/${id}/links/${linkId}`), success: "Unlinked", invalidate });
  const archive = useApiMutation({ mutationFn: (rationale: string) => api.post(`/evidence/${id}/archive`, { rationale }), success: "Evidence archived", invalidate });
  const download = async () => {
    try {
      const { url } = await api.post<{ url: string }>(`/evidence/${id}/download-url`, { disposition: "attachment" });
      window.location.assign(url);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  if (query.isPending) return <LoadingState rows={8} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const e = query.data;
  const archived = !!e.archivedAt;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Evidence", href: "/evidence" }, { label: e.title }]}
        title={e.title}
        meta={
          <>
            <StatusBadge status={e.reviewStatus} />
            <StatusBadge status={e.state} />
            {archived && <StatusBadge status="retired" label="Archived" />}
            {e.isDemo && <StatusBadge status="stale" label="Demo sample" />}
          </>
        }
        actions={
          <>
            {e.hasFile && can("evidence.download") && (
              <Button variant="outline" onClick={download}>
                <Download aria-hidden /> Download
              </Button>
            )}
            {can("evidence.review") && !archived && (
              <>
                <ConfirmDialog trigger={<Button>Approve</Button>} title="Approve evidence" description="Confirm the evidence is authentic, relevant and current." requireRationale rationaleLabel="Review notes" confirmLabel="Approve" onConfirm={(notes) => review.mutateAsync({ decision: "approved", notes })} />
                <ConfirmDialog trigger={<Button variant="outline">Reject</Button>} title="Reject evidence" requireRationale rationaleLabel="Why is it rejected?" destructive confirmLabel="Reject" onConfirm={(notes) => review.mutateAsync({ decision: "rejected", notes })} />
              </>
            )}
            {can("evidence.archive") && !archived && (
              <ConfirmDialog trigger={<Button variant="ghost" aria-label="Archive"><Archive aria-hidden /></Button>} title="Archive evidence" description="Archived evidence no longer counts toward control currency. History is preserved." requireRationale destructive confirmLabel="Archive" onConfirm={(r) => archive.mutateAsync(r)} />
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {e.description && (
            <Section title="Description">
              <p className="text-sm whitespace-pre-wrap">{e.description}</p>
            </Section>
          )}
          {e.hasFile && (
            <Section title="File" description={PREVIEWABLE.has(e.mediaType ?? "") ? "Preview is rendered in a sandbox." : "This file type is download-only."}>
              <DetailList
                items={[
                  { label: "Filename", value: e.originalFilename },
                  { label: "Type (verified)", value: e.mediaType },
                  { label: "Size", value: formatBytes(e.sizeBytes) },
                  { label: "SHA-256", value: <span className="font-mono text-xs break-all">{e.sha256Checksum}</span> },
                  { label: "Malware scan", value: e.scanStatus === "not_scanned" ? "Not scanned (scanner not configured)" : e.scanStatus },
                ]}
              />
              {PREVIEWABLE.has(e.mediaType ?? "") && can("evidence.download") && <div className="mt-3"><Preview evidence={e} /></div>}
            </Section>
          )}
          <Section title="AI assistance" description="The AI agent pre-reviews every upload. Drafts never change this evidence or any linked record; the reviewer decides.">
            <div className="space-y-4">
              <AiAssist artifactType="evidence_review" targetId={e.id} title="Pre-review for the reviewer" />
              <AiAssist artifactType="vendor_document_analysis" targetId={e.id} title="Third-party document analysis (SOC 2, ISO, pentest, contract)" />
              <AiAssist artifactType="evidence_request" targetId={e.id} title="Refresh request to the owner" />
              <AiAssist artifactType="evidence_summary" targetId={e.id} />
              <AiAssist artifactType="evidence_statements" targetId={e.id} />
            </div>
          </Section>
          <Section title="Linked records" actions={can("evidence.link") && !archived && <AddLinkDialog evidenceId={e.id} />}>
            {e.links.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not linked to any record.</p>
            ) : (
              <ul className="divide-y">
                {e.links.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span>
                      <span className="text-xs text-muted-foreground">{l.entityType.replace(/_/g, " ")}:</span> {l.label}
                      {l.purpose && <span className="ml-2 text-xs text-muted-foreground">({l.purpose.replace(/_/g, " ")})</span>}
                    </span>
                    {can("evidence.link") && l.purpose !== "closure" && l.purpose !== "completion" && (
                      <Button size="icon-sm" variant="ghost" aria-label={`Unlink ${l.label}`} onClick={() => unlink.mutate(l.id)}>
                        <Unlink aria-hidden />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          <Section title="History">
            <AuditTimeline events={e.history} />
          </Section>
        </div>
        <div className="space-y-4">
          <Section title="Details">
            <DetailList
              items={[
                { label: "Classification", value: <span className="capitalize">{e.classification}</span> },
                { label: "Owner", value: e.owner?.displayName },
                { label: "Uploaded by", value: e.uploadedBy?.displayName },
                { label: "Source", value: e.sourceType.replace(/_/g, " ") },
                { label: "Collected", value: <DateText value={e.collectedAt} /> },
                { label: "Valid from", value: <DateText value={e.validFrom} /> },
                { label: "Expires", value: <DateText value={e.expiresAt} /> },
                { label: "Reviewed", value: e.reviewedAt ? <DateText value={e.reviewedAt} /> : "Not yet" },
              ]}
            />
            {e.reviewNotes && <p className="mt-3 text-xs italic">“{e.reviewNotes}”</p>}
          </Section>
          <Section title="Access log" description="Download links issued and files downloaded.">
            {e.accessLog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No access recorded.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {e.accessLog.map((a) => (
                  <li key={a.id}>
                    {a.action.replace(/_/g, " ")} · <DateText value={a.createdAt} withTime />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
