"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FormProvider, useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { ScaleField, SelectField, SwitchField, TextareaField, TextField, UserField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(200),
  legalName: z.string().max(200).optional(),
  serviceDescription: z.string().trim().min(1, "Required").max(2000),
  website: z.string().max(500).optional().refine((v) => !v || /^https?:\/\//.test(v), "Use a full http(s) URL"),
  businessOwnerId: z.string().nullable(),
  criticality: z.enum(["low", "medium", "high", "critical"]),
  dataClassification: z.enum(["public", "internal", "confidential", "restricted"]),
  personalDataAccess: z.boolean(),
  accessLevel: z.enum(["none", "limited", "privileged", "administrative"]),
  businessDependency: z.number().int().min(1).max(5),
  serviceImpact: z.number().int().min(1).max(5),
  dataTypes: z.string().max(1000).optional(),
  regions: z.string().max(500).optional(),
  dependencies: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
  reassessmentFrequencyDays: z.coerce.number().int().min(30).max(1095),
  rationale: z.string().max(2000).optional(),
});
type Values = z.infer<typeof schema>;

export interface VendorRecord {
  id: string;
  version: number;
  name: string;
  legalName: string | null;
  serviceDescription: string;
  website: string | null;
  businessOwnerId: string | null;
  criticality: Values["criticality"];
  dataClassification: Values["dataClassification"];
  personalDataAccess: boolean;
  accessLevel: Values["accessLevel"];
  businessDependency: number;
  serviceImpact: number;
  dataTypes: string[];
  regions: string[];
  dependencies: string | null;
  notes: string | null;
  reassessmentFrequencyDays: number;
}

const list = (s?: string) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const opts = (values: string[]) => values.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }));

export function VendorFormDialog({ vendor, trigger }: { vendor?: VendorRecord; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(schema) as never,
    defaultValues: {
      name: vendor?.name ?? "",
      legalName: vendor?.legalName ?? "",
      serviceDescription: vendor?.serviceDescription ?? "",
      website: vendor?.website ?? "",
      businessOwnerId: vendor?.businessOwnerId ?? null,
      criticality: vendor?.criticality ?? "medium",
      dataClassification: vendor?.dataClassification ?? "internal",
      personalDataAccess: vendor?.personalDataAccess ?? false,
      accessLevel: vendor?.accessLevel ?? "none",
      businessDependency: vendor?.businessDependency ?? 3,
      serviceImpact: vendor?.serviceImpact ?? 3,
      dataTypes: vendor?.dataTypes.join(", ") ?? "",
      regions: vendor?.regions.join(", ") ?? "",
      dependencies: vendor?.dependencies ?? "",
      notes: vendor?.notes ?? "",
      reassessmentFrequencyDays: vendor?.reassessmentFrequencyDays ?? 365,
      rationale: "",
    },
  });
  const mutation = useApiMutation({
    mutationFn: (v: Values) => {
      const { rationale, ...rest } = v;
      const body = { ...rest, legalName: rest.legalName || null, website: rest.website || null, dataTypes: list(rest.dataTypes), regions: list(rest.regions), dependencies: rest.dependencies || null, notes: rest.notes || null };
      return vendor ? api.patch<{ id: string }>(`/vendors/${vendor.id}`, { ...body, version: vendor.version, rationale: rationale || undefined }) : api.post<{ id: string }>("/vendors", body);
    },
    success: vendor ? "Vendor updated" : "Vendor created",
    invalidate: [["vendors"]],
    form: form as unknown as UseFormReturn<FieldValues>,
    onSuccess: (v) => {
      setOpen(false);
      if (!vendor) router.push(`/vendors/${v.id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (!o && form.formState.isDirty && !window.confirm("Discard unsaved changes?") ? undefined : setOpen(o))}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{vendor ? `Edit ${vendor.name}` : "New vendor"}</DialogTitle>
          <DialogDescription>Profile factors drive the inherent risk score. Changing criticality, data or access after approval triggers a reassessment.</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form method="post" id="vendor-form" onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<Values> name="name" label="Name" required />
                <TextField<Values> name="legalName" label="Legal name" />
              </div>
              <TextareaField<Values> name="serviceDescription" label="Service provided" required rows={2} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<Values> name="website" label="Website" placeholder="https://" />
                <UserField<Values> name="businessOwnerId" label="Business owner" />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <SelectField<Values> name="criticality" label="Criticality" options={opts(["low", "medium", "high", "critical"])} />
                <SelectField<Values> name="dataClassification" label="Data classification" options={opts(["public", "internal", "confidential", "restricted"])} />
                <SelectField<Values> name="accessLevel" label="System access" options={opts(["none", "limited", "privileged", "administrative"])} />
              </div>
              <SwitchField<Values> name="personalDataAccess" label="Processes personal data" />
              <div className="grid gap-4 sm:grid-cols-2">
                <ScaleField<Values> name="businessDependency" label="Business dependency" />
                <ScaleField<Values> name="serviceImpact" label="Impact if the service fails" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<Values> name="dataTypes" label="Data types" description="Comma-separated" />
                <TextField<Values> name="regions" label="Hosting / data regions" description="Comma-separated" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<Values> name="reassessmentFrequencyDays" label="Reassess every (days)" type="number" />
                <TextField<Values> name="dependencies" label="Dependencies" />
              </div>
              <TextareaField<Values> name="notes" label="Notes" rows={2} />
              {vendor && <TextField<Values> name="rationale" label="Reason for change" description="Recorded in the audit trail." />}
            </FieldGroup>
          </form>
        </FormProvider>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="vendor-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : vendor ? "Save" : "Create vendor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
