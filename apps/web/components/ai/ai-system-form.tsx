"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Controller, FormProvider, useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { RecordPicker } from "@/components/common/record-picker";
import { DateField, SelectField, SwitchField, TextareaField, TextField, UserField, dateInput, toDateInput } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup, FieldLabel, Field } from "@/components/ui/field";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(200),
  description: z.string().trim().min(1, "Required").max(5000),
  businessPurpose: z.string().trim().min(1, "Required").max(2000),
  businessJustification: z.string().max(2000).optional(),
  businessOwnerId: z.string().nullable(),
  technicalOwnerId: z.string().nullable(),
  riskOwnerId: z.string().nullable(),
  providerVendor: z.object({ id: z.string(), label: z.string() }).nullable(),
  modelName: z.string().max(200).optional(),
  modelVersion: z.string().max(100).optional(),
  deploymentType: z.enum(["internal_build", "third_party_api", "embedded_in_product", "saas_feature"]),
  deploymentEnvironment: z.string().max(200).optional(),
  intendedUsers: z.string().max(2000).optional(),
  affectedPeople: z.string().max(2000).optional(),
  inputDataCategories: z.string().max(1000).optional(),
  outputDataCategories: z.string().max(1000).optional(),
  personalDataProcessed: z.boolean(),
  sensitiveDataProcessed: z.boolean(),
  automatedDecisionMaking: z.boolean(),
  influencesDecisionsAboutPeople: z.boolean(),
  dataRetention: z.string().max(1000).optional(),
  dataLocation: z.string().max(500).optional(),
  humanOversight: z.string().max(5000).optional(),
  overrideAndAppeal: z.string().max(5000).optional(),
  escalationPath: z.string().max(2000).optional(),
  externalDependencies: z.string().max(2000).optional(),
  knownLimitations: z.string().max(5000).optional(),
  foreseeableMisuse: z.string().max(5000).optional(),
  rollbackPlan: z.string().max(5000).optional(),
  nextReviewAt: z.string().optional(),
  documentationUri: z.string().max(1000).optional().refine((v) => !v || /^https?:\/\//.test(v), "Use a full http(s) URL"),
  rationale: z.string().max(2000).optional(),
});
type Values = z.infer<typeof schema>;

export interface AiSystemRecord {
  id: string;
  version: number;
  name: string;
  description: string;
  businessPurpose: string;
  businessJustification: string | null;
  businessOwnerId: string | null;
  technicalOwnerId: string | null;
  riskOwnerId: string | null;
  providerVendorId: string | null;
  providerVendor: { id: string; name: string } | null;
  modelName: string | null;
  modelVersion: string | null;
  deploymentType: Values["deploymentType"];
  deploymentEnvironment: string | null;
  intendedUsers: string | null;
  affectedPeople: string | null;
  inputDataCategories: string[];
  outputDataCategories: string[];
  personalDataProcessed: boolean;
  sensitiveDataProcessed: boolean;
  automatedDecisionMaking: boolean;
  influencesDecisionsAboutPeople: boolean;
  dataRetention: string | null;
  dataLocation: string | null;
  humanOversight: string | null;
  overrideAndAppeal: string | null;
  escalationPath: string | null;
  externalDependencies: string | null;
  knownLimitations: string | null;
  foreseeableMisuse: string | null;
  rollbackPlan: string | null;
  nextReviewAt: string | null;
  documentationUri: string | null;
}

const csv = (s?: string) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const blank = (s?: string) => (s?.trim() ? s : null);

/** Full AI inventory record (spec §10.1). Changing model, provider or purpose after approval triggers reassessment. */
export function AiSystemFormDialog({ system, trigger }: { system?: AiSystemRecord; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: system?.name ?? "",
      description: system?.description ?? "",
      businessPurpose: system?.businessPurpose ?? "",
      businessJustification: system?.businessJustification ?? "",
      businessOwnerId: system?.businessOwnerId ?? null,
      technicalOwnerId: system?.technicalOwnerId ?? null,
      riskOwnerId: system?.riskOwnerId ?? null,
      providerVendor: system?.providerVendor ? { id: system.providerVendor.id, label: system.providerVendor.name } : null,
      modelName: system?.modelName ?? "",
      modelVersion: system?.modelVersion ?? "",
      deploymentType: system?.deploymentType ?? "third_party_api",
      deploymentEnvironment: system?.deploymentEnvironment ?? "",
      intendedUsers: system?.intendedUsers ?? "",
      affectedPeople: system?.affectedPeople ?? "",
      inputDataCategories: system?.inputDataCategories.join(", ") ?? "",
      outputDataCategories: system?.outputDataCategories.join(", ") ?? "",
      personalDataProcessed: system?.personalDataProcessed ?? false,
      sensitiveDataProcessed: system?.sensitiveDataProcessed ?? false,
      automatedDecisionMaking: system?.automatedDecisionMaking ?? false,
      influencesDecisionsAboutPeople: system?.influencesDecisionsAboutPeople ?? false,
      dataRetention: system?.dataRetention ?? "",
      dataLocation: system?.dataLocation ?? "",
      humanOversight: system?.humanOversight ?? "",
      overrideAndAppeal: system?.overrideAndAppeal ?? "",
      escalationPath: system?.escalationPath ?? "",
      externalDependencies: system?.externalDependencies ?? "",
      knownLimitations: system?.knownLimitations ?? "",
      foreseeableMisuse: system?.foreseeableMisuse ?? "",
      rollbackPlan: system?.rollbackPlan ?? "",
      nextReviewAt: toDateInput(system?.nextReviewAt),
      documentationUri: system?.documentationUri ?? "",
      rationale: "",
    },
  });
  const mutation = useApiMutation({
    mutationFn: (v: Values) => {
      const { providerVendor, rationale, inputDataCategories, outputDataCategories, nextReviewAt, ...rest } = v;
      const body = {
        ...Object.fromEntries(Object.entries(rest).map(([k, val]) => [k, typeof val === "string" && !["name", "description", "businessPurpose", "deploymentType"].includes(k) ? blank(val) : val])),
        providerVendorId: providerVendor?.id ?? null,
        inputDataCategories: csv(inputDataCategories),
        outputDataCategories: csv(outputDataCategories),
        nextReviewAt: dateInput(nextReviewAt),
      };
      return system ? api.patch<{ id: string }>(`/ai-systems/${system.id}`, { ...body, version: system.version, rationale: rationale || undefined }) : api.post<{ id: string }>("/ai-systems", body);
    },
    success: system ? "AI system updated" : "AI system registered",
    invalidate: [["ai-systems"]],
    form: form as unknown as UseFormReturn<FieldValues>,
    onSuccess: (s) => {
      setOpen(false);
      if (!system) router.push(`/ai-governance/${s.id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => (!o && form.formState.isDirty && !window.confirm("Discard unsaved changes?") ? undefined : setOpen(o))}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{system ? `Edit ${system.name}` : "Register an AI system"}</DialogTitle>
          <DialogDescription>Purpose, owners, data, oversight and limitations. These details drive the assessment and deployment checks.</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form method="post" id="ai-form" onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate>
            <FieldGroup>
              <h3 className="text-sm font-semibold">Purpose and ownership</h3>
              <TextField<Values> name="name" label="Name" required />
              <TextareaField<Values> name="description" label="Description" required rows={2} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextareaField<Values> name="businessPurpose" label="Business purpose" required rows={2} />
                <TextareaField<Values> name="businessJustification" label="Business justification" rows={2} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <UserField<Values> name="businessOwnerId" label="Business owner" />
                <UserField<Values> name="technicalOwnerId" label="Technical owner" />
                <UserField<Values> name="riskOwnerId" label="Risk owner" />
              </div>
              <h3 className="pt-2 text-sm font-semibold">Model and deployment</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  control={form.control}
                  name="providerVendor"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="providerVendor">Provider (vendor)</FieldLabel>
                      <RecordPicker<{ id: string; name: string }> id="providerVendor" endpoint="/vendors" toOption={(v) => ({ id: v.id, label: v.name })} value={field.value} onChange={field.onChange} placeholder="None (built in-house)" />
                    </Field>
                  )}
                />
                <SelectField<Values> name="deploymentType" label="Deployment type" options={[{ value: "internal_build", label: "Internal build" }, { value: "third_party_api", label: "Third-party API" }, { value: "embedded_in_product", label: "Embedded in product" }, { value: "saas_feature", label: "SaaS feature" }]} />
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <TextField<Values> name="modelName" label="Model" />
                <TextField<Values> name="modelVersion" label="Model version" />
                <TextField<Values> name="deploymentEnvironment" label="Environment" />
              </div>
              <h3 className="pt-2 text-sm font-semibold">People and data</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextareaField<Values> name="intendedUsers" label="Intended users" rows={2} />
                <TextareaField<Values> name="affectedPeople" label="People potentially affected" rows={2} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<Values> name="inputDataCategories" label="Input data categories" description="Comma-separated" />
                <TextField<Values> name="outputDataCategories" label="Output data categories" description="Comma-separated" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <SwitchField<Values> name="personalDataProcessed" label="Processes personal data" />
                <SwitchField<Values> name="sensitiveDataProcessed" label="Processes sensitive data" />
                <SwitchField<Values> name="automatedDecisionMaking" label="Automated decision-making" />
                <SwitchField<Values> name="influencesDecisionsAboutPeople" label="Outputs influence decisions about people" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<Values> name="dataRetention" label="Data retention" />
                <TextField<Values> name="dataLocation" label="Data location" />
              </div>
              <h3 className="pt-2 text-sm font-semibold">Oversight, limitations and continuity</h3>
              <TextareaField<Values> name="humanOversight" label="Human oversight" description="How people review, override or stop outputs. Required for deployment approval." rows={2} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextareaField<Values> name="overrideAndAppeal" label="Override and appeal" rows={2} />
                <TextareaField<Values> name="escalationPath" label="Escalation path" rows={2} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextareaField<Values> name="knownLimitations" label="Known limitations" rows={2} />
                <TextareaField<Values> name="foreseeableMisuse" label="Foreseeable misuse" rows={2} />
              </div>
              <TextareaField<Values> name="rollbackPlan" label="Rollback plan" description="Required for deployment approval." rows={2} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<Values> name="externalDependencies" label="External dependencies" />
                <TextField<Values> name="documentationUri" label="Documentation URL" />
              </div>
              <DateField<Values> name="nextReviewAt" label="Next review" />
              {system && <TextField<Values> name="rationale" label="Reason for change" />}
            </FieldGroup>
          </form>
        </FormProvider>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="ai-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : system ? "Save" : "Register"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
