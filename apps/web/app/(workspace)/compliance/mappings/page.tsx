"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";
import { IllustrativeBadge, StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { controlOption, RecordPicker, type PickerOption } from "@/components/common/record-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListParams } from "@/hooks/use-list-params";
import { useCan, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";

interface ReqRef {
  id: string;
  requirementCode: string;
  title: string;
  framework: { id: string; key: string; name: string; version: string };
}
interface Mapping {
  id: string;
  scope: "organization" | "platform";
  mappingType: string;
  rationale: string;
  confidence: number;
  reviewStatus: string;
  reviewNotes: string | null;
  isIllustrative: boolean;
  createdBy: string | null;
  version: number;
  source: ReqRef;
  target: ReqRef | null;
  control: { id: string; controlCode: string; title: string } | null;
}

const requirementOption = (r: ReqRef): PickerOption => ({ id: r.id, label: `${r.framework.key} ${r.requirementCode} · ${r.title.slice(0, 80)}`, sublabel: `${r.framework.name} ${r.framework.version}` });
const TYPES = ["supports", "partially_supports", "related", "requires_separate_evidence"];

function NewMappingDialog() {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<PickerOption | null>(null);
  const [targetKind, setTargetKind] = useState<"control" | "requirement">("control");
  const [target, setTarget] = useState<PickerOption | null>(null);
  const [type, setType] = useState("supports");
  const [confidence, setConfidence] = useState(50);
  const [rationale, setRationale] = useState("");
  const create = useApiMutation({
    mutationFn: () => api.post("/control-mappings", { sourceRequirementId: source!.id, ...(targetKind === "control" ? { controlId: target!.id } : { targetRequirementId: target!.id }), mappingType: type, confidence, rationale }),
    success: "Mapping proposed for review",
    invalidate: [["mappings"], ["frameworks"], ["controls"]],
    onSuccess: () => {
      setOpen(false);
      setSource(null);
      setTarget(null);
      setRationale("");
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> Propose mapping
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Propose a mapping</DialogTitle>
          <DialogDescription>A mapping is a reviewable assertion, not equivalence. Someone other than you must approve it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="src">Framework requirement</Label>
            <RecordPicker<ReqRef> id="src" endpoint="/frameworks/requirements" toOption={requirementOption} value={source} onChange={setSource} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kind">Maps to</Label>
            <Select value={targetKind} onValueChange={(v) => { setTargetKind(v as "control" | "requirement"); setTarget(null); }}>
              <SelectTrigger id="kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="control">One of our controls</SelectItem>
                <SelectItem value="requirement">A requirement in another framework</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tgt">{targetKind === "control" ? "Control" : "Target requirement"}</Label>
            {targetKind === "control" ? (
              <RecordPicker key="c" id="tgt" endpoint="/controls" toOption={controlOption} value={target} onChange={setTarget} />
            ) : (
              <RecordPicker<ReqRef> key="r" id="tgt" endpoint="/frameworks/requirements" toOption={requirementOption} value={target} onChange={setTarget} />
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="type">Mapping type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conf">Confidence (%)</Label>
              <Input id="conf" type="number" min={0} max={100} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rat">Rationale</Label>
            <Textarea id="rat" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!source || !target || !rationale.trim() || create.isPending} onClick={() => create.mutate()}>
            Propose
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Mappings() {
  const can = useCan();
  const { data: me } = useMe();
  const [params, setParams] = useListParams({ sort: "createdAt", order: "desc" });
  const tab = (params.queue as string) === "true" ? "queue" : params.scope === "platform" ? "platform" : "all";
  const query = useQuery({ queryKey: ["mappings", params], queryFn: () => api.get<Page<Mapping>>("/control-mappings", params) });
  const review = useApiMutation({ mutationFn: (v: { id: string; decision: string; notes: string }) => api.post(`/control-mappings/${v.id}/review`, { decision: v.decision, notes: v.notes }), success: "Review recorded", invalidate: [["mappings"], ["frameworks"], ["compliance"]] });
  const adopt = useApiMutation({ mutationFn: (id: string) => api.post(`/control-mappings/${id}/adopt`), success: "Adopted as a proposal for your organization", invalidate: [["mappings"]] });

  const ref = (r: ReqRef | null) => (r ? <span><span className="font-mono text-xs">{r.framework.key} {r.requirementCode}</span><span className="block max-w-xs truncate text-xs text-muted-foreground">{r.title}</span></span> : null);
  const columns: Column<Mapping>[] = [
    { id: "source", header: "Requirement", cell: (m) => ref(m.source) },
    { id: "target", header: "Maps to", cell: (m) => (m.control ? <Link className="text-primary hover:underline" href={`/controls/${m.control.id}`}><span className="font-mono text-xs">{m.control.controlCode}</span> {m.control.title}</Link> : ref(m.target)) },
    { id: "type", header: "Type", cell: (m) => <span className="text-xs">{m.mappingType.replace(/_/g, " ")} · {m.confidence}%</span>, hideOnMobile: true },
    { id: "review", header: "Review", cell: (m) => <span className="flex flex-wrap gap-1"><StatusBadge status={m.reviewStatus} />{m.isIllustrative && <IllustrativeBadge />}</span> },
    { id: "rationale", header: "Rationale", cell: (m) => <span className="line-clamp-2 max-w-sm text-xs">{m.rationale}</span>, hideOnMobile: true },
    {
      id: "actions",
      header: "Actions",
      cell: (m) =>
        m.scope === "platform" ? (
          can("mapping.manage") && <Button size="xs" variant="outline" onClick={() => adopt.mutate(m.id)}>Adopt</Button>
        ) : can("mapping.review") && ["unreviewed", "pending_review"].includes(m.reviewStatus) && m.createdBy !== me?.user.id ? (
          <div className="flex gap-1">
            <ConfirmDialog trigger={<Button size="xs">Approve</Button>} title="Approve mapping" description={m.rationale} requireRationale rationaleLabel="Review notes" confirmLabel="Approve" onConfirm={(notes) => review.mutateAsync({ id: m.id, decision: "approved", notes })} />
            <ConfirmDialog trigger={<Button size="xs" variant="outline">Reject</Button>} title="Reject mapping" description={m.rationale} requireRationale rationaleLabel="Why is it rejected?" destructive confirmLabel="Reject" onConfirm={(notes) => review.mutateAsync({ id: m.id, decision: "rejected", notes })} />
          </div>
        ) : m.createdBy === me?.user.id && m.reviewStatus !== "approved" ? (
          <span className="text-xs text-muted-foreground">Awaiting another reviewer</span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader title="Control mappings" description="Requirement-to-control and cross-framework mappings with rationale, confidence and review status. Unreviewed mappings are illustrative." crumbs={[{ label: "Compliance" }, { label: "Mappings" }]} actions={can("mapping.manage") && <NewMappingDialog />} />
      <Tabs value={tab} onValueChange={(v) => setParams({ queue: v === "queue" ? "true" : undefined, scope: v === "platform" ? "platform" : undefined })} className="mb-3">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="queue">Review queue</TabsTrigger>
          <TabsTrigger value="platform">Platform illustrative</TabsTrigger>
        </TabsList>
      </Tabs>
      <FilterBar params={params} setParams={setParams} searchPlaceholder="Search code, control or rationale" filters={tab === "queue" ? [] : [{ key: "reviewStatus", label: "Review", options: options(["unreviewed", "pending_review", "approved", "rejected"]) }]} />
      <DataTable caption="Control mappings" columns={columns} query={query} params={params} setParams={setParams} rowKey={(m) => m.id} empty={{ title: tab === "queue" ? "Nothing to review" : "No mappings yet", description: "Map framework requirements to your controls from a framework page or with Propose mapping." }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Mappings />
    </Suspense>
  );
}
