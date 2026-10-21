"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FormProvider, useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { DateField, SelectField, TextareaField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import type { Evidence } from "@/lib/types";

const MAX_MB = 25;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.txt,.csv,.json,.docx,.xlsx";

const schema = z
  .object({
    title: z.string().trim().min(1, "Required").max(200),
    description: z.string().max(5000).optional(),
    classification: z.enum(["public", "internal", "confidential", "restricted"]),
    collectedAt: z.string().optional(),
    validFrom: z.string().optional(),
    expiresAt: z.string().optional(),
  })
  .refine((v) => !v.validFrom || !v.expiresAt || v.expiresAt > v.validFrom, { message: "Expiry must be after the validity start", path: ["expiresAt"] });
type Values = z.infer<typeof schema>;

/**
 * Upload a file (or record metadata-only evidence) and optionally link it to a record.
 * The server verifies the real file type, computes the checksum and generates the storage key.
 */
export function EvidenceUploadDialog({ trigger, link }: { trigger: ReactNode; link?: { entityType: string; entityId: string; label: string } }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [metadataOnly, setMetadataOnly] = useState(false);
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { title: "", description: "", classification: "internal", collectedAt: "", validFrom: "", expiresAt: "" } });

  const mutation = useApiMutation({
    mutationFn: async (v: Values) => {
      const dates = Object.fromEntries((["collectedAt", "validFrom", "expiresAt"] as const).map((k) => [k, v[k] ? `${v[k]}T12:00:00Z` : ""]));
      if (metadataOnly) {
        return api.post<Evidence>("/evidence/records", {
          title: v.title,
          description: v.description || undefined,
          classification: v.classification,
          ...Object.fromEntries(Object.entries(dates).filter(([, d]) => d)),
          ...(link ? { linkEntityType: link.entityType, linkEntityId: link.entityId } : {}),
        });
      }
      if (!file) throw new Error("Choose a file to upload");
      const body = new FormData();
      body.set("file", file);
      body.set("title", v.title);
      body.set("classification", v.classification);
      if (v.description) body.set("description", v.description);
      for (const [k, d] of Object.entries(dates)) if (d) body.set(k, d);
      if (link) {
        body.set("linkEntityType", link.entityType);
        body.set("linkEntityId", link.entityId);
      }
      return api.upload<Evidence>("/evidence", body);
    },
    success: "Evidence saved",
    invalidate: [["evidence"], ["controls"], ["risks"], ["findings"]],
    form: form as unknown as UseFormReturn<FieldValues>,
    onSuccess: (e) => {
      setOpen(false);
      form.reset();
      setFile(null);
      if (!link) router.push(`/evidence/${e.id}`);
    },
  });

  const pickFile = (f: File | null) => {
    setFileError(null);
    if (f && f.size > MAX_MB * 1024 * 1024) {
      setFileError(`Files may be at most ${MAX_MB} MB.`);
      return;
    }
    setFile(f);
    if (f && !form.getValues("title")) form.setValue("title", f.name.replace(/\.[^.]+$/, ""));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !mutation.isPending && setOpen(o)}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add evidence</DialogTitle>
          <DialogDescription>{link ? `Will be linked to ${link.label}.` : "Evidence can be linked to controls, risks, findings, vendors and AI systems later."}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form method="post" id="evidence-form" onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate>
            <FieldGroup>
              <Field orientation="horizontal">
                <Switch id="metadata-only" checked={metadataOnly} onCheckedChange={setMetadataOnly} />
                <div>
                  <FieldLabel htmlFor="metadata-only">Metadata only</FieldLabel>
                  <FieldDescription>Record evidence that exists elsewhere (e.g. a completed review) without uploading a file.</FieldDescription>
                </div>
              </Field>
              {!metadataOnly && (
                <Field data-invalid={!!fileError}>
                  <FieldLabel htmlFor="evidence-file">File</FieldLabel>
                  <Input id="evidence-file" type="file" accept={ACCEPT} onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
                  <FieldDescription>PDF, PNG, JPEG, TXT, CSV, JSON, DOCX or XLSX up to {MAX_MB} MB. Files are never executed.</FieldDescription>
                  {fileError && <p className="text-sm text-destructive">{fileError}</p>}
                </Field>
              )}
              <TextField<Values> name="title" label="Title" required />
              <TextareaField<Values> name="description" label="Description" rows={2} />
              <SelectField<Values> name="classification" label="Classification" options={["public", "internal", "confidential", "restricted"].map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} />
              <div className="grid gap-4 sm:grid-cols-3">
                <DateField<Values> name="collectedAt" label="Collected" />
                <DateField<Values> name="validFrom" label="Valid from" />
                <DateField<Values> name="expiresAt" label="Expires" />
              </div>
            </FieldGroup>
          </form>
        </FormProvider>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="evidence-form" disabled={mutation.isPending || (!metadataOnly && !file)}>
            {mutation.isPending ? "Uploading…" : "Save evidence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
