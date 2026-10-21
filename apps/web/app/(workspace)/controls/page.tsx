"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { FileSpreadsheet, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, useState } from "react";
import { FormProvider, useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { IllustrativeBadge, StatusBadge } from "@/components/common/badges";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader } from "@/components/common/page-header";
import { TextareaField, TextField, UserField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListParams } from "@/hooks/use-list-params";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Control, Page } from "@/lib/types";

const IMPL = ["not_assessed", "planned", "in_progress", "implemented", "partially_implemented", "not_applicable", "retired"] as const;

const columns: Column<Control>[] = [
  { id: "code", header: "Control", sortKey: "controlCode", cell: (c) => <span><span className="font-mono text-xs">{c.controlCode}</span> · {c.title}</span> },
  { id: "category", header: "Category", sortKey: "category", cell: (c) => c.category, hideOnMobile: true },
  { id: "impl", header: "Implementation", cell: (c) => <StatusBadge status={c.implementation?.status ?? "not_assessed"} /> },
  { id: "test", header: "Latest test", cell: (c) => (c.latestTest ? <span className="flex items-center gap-1"><StatusBadge status={c.latestTest.result} /><span className="text-xs text-muted-foreground"><DateText value={c.latestTest.startedAt} relative /></span></span> : <StatusBadge status="not_assessed" label="Not tested" />) },
  { id: "evidence", header: "Evidence", cell: (c) => <StatusBadge status={c.evidenceState} /> },
  { id: "findings", header: "Open findings", cell: (c) => (c.openFindings ? <span className="font-medium text-sev-high">{c.openFindings}</span> : <span className="text-muted-foreground">0</span>), hideOnMobile: true },
  { id: "owner", header: "Owner", cell: (c) => c.implementation?.owner?.displayName ?? <span className="text-muted-foreground">Unassigned</span>, hideOnMobile: true },
  { id: "review", header: "Next review", cell: (c) => <DateText value={c.implementation?.nextReviewAt} />, hideOnMobile: true },
];

const createSchema = z.object({
  controlCode: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/, "2–40 letters, digits, dots, dashes or underscores"),
  title: z.string().trim().min(1, "Required").max(200),
  description: z.string().trim().min(1, "Required").max(5000),
  category: z.string().trim().min(1, "Required").max(80),
  reviewFrequencyDays: z.coerce.number().int().min(1).max(1095),
  ownerId: z.string().nullable(),
});
type CreateValues = z.infer<typeof createSchema>;

function NewControlDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<CreateValues>({ resolver: zodResolver(createSchema) as never, defaultValues: { controlCode: "", title: "", description: "", category: "", reviewFrequencyDays: 90, ownerId: null } });
  const mutation = useApiMutation({
    mutationFn: (v: CreateValues) => api.post<{ id: string }>("/controls", v),
    success: "Control created",
    invalidate: [["controls"]],
    form: form as unknown as UseFormReturn<FieldValues>,
    onSuccess: (c) => router.push(`/controls/${c.id}`),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> New control
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New control</DialogTitle>
        </DialogHeader>
        <FormProvider {...form}>
          <form method="post" id="control-form" onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<CreateValues> name="controlCode" label="Control code" required placeholder="AC-01" />
                <TextField<CreateValues> name="category" label="Category" required placeholder="Access Control" />
              </div>
              <TextField<CreateValues> name="title" label="Title" required />
              <TextareaField<CreateValues> name="description" label="Description" required />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<CreateValues> name="reviewFrequencyDays" label="Review every (days)" type="number" required />
                <UserField<CreateValues> name="ownerId" label="Owner" />
              </div>
            </FieldGroup>
          </form>
        </FormProvider>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="control-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create control"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Controls() {
  const can = useCan();
  const [params, setParams] = useListParams({ sort: "controlCode", order: "asc" });
  const query = useQuery({ queryKey: ["controls", params], queryFn: () => api.get<Page<Control>>("/controls", params) });
  const categories = useQuery({ queryKey: ["controls", "categories"], queryFn: () => api.get<string[]>("/controls/categories") });
  const illustrative = query.data?.items.some((c) => c.isIllustrative);

  return (
    <>
      <PageHeader
        title="Controls"
        description="Control register: implementation status, latest test outcome and evidence currency are tracked separately."
        crumbs={[{ label: "Compliance" }, { label: "Controls" }]}
        meta={illustrative && <IllustrativeBadge label="Contains illustrative controls" />}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/controls/statement-of-applicability">
                <FileSpreadsheet aria-hidden /> Statement of Applicability
              </Link>
            </Button>
            {can("control.create") && (
              <Button variant="outline" asChild>
                <Link href="/controls/import">Bulk import</Link>
              </Button>
            )}
            {can("control.create") && <NewControlDialog />}
          </>
        }
      />
      <FilterBar
        params={params}
        setParams={setParams}
        searchPlaceholder="Search code, title or description"
        filters={[
          { key: "status", label: "Implementation", options: options(IMPL) },
          { key: "testResult", label: "Latest test", options: options(["pass", "fail", "unknown", "error", "not_applicable"]) },
          { key: "evidence", label: "Evidence", options: options(["missing", "expired", "expiring", "current"]) },
          { key: "category", label: "Category", options: (categories.data ?? []).map((c) => ({ value: c, label: c })) },
          { key: "reviewDue", label: "Review", options: [{ value: "true", label: "Review due" }] },
        ]}
      />
      <DataTable caption="Controls" columns={columns} query={query} params={params} setParams={setParams} rowKey={(c) => c.id} rowHref={(c) => `/controls/${c.id}`} empty={{ title: "No controls yet", description: "Create controls or adopt templates to start tracking implementation and evidence." }} />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Controls />
    </Suspense>
  );
}
