"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { FormProvider, useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { DateField, ScaleField, SelectField, TextareaField, TextField, UserField, dateInput, toDateInput } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import type { Risk } from "@/lib/types";

const scale = z.number().int().min(1).max(5);
const schema = z
  .object({
    title: z.string().trim().min(1, "Required").max(200),
    description: z.string().trim().min(1, "Required").max(5000),
    category: z.string().trim().min(1, "Required").max(80),
    likelihood: scale,
    impact: scale,
    residualLikelihood: scale.nullable(),
    residualImpact: scale.nullable(),
    residualRationale: z.string().max(2000).optional(),
    riskOwnerId: z.string().nullable(),
    treatment: z.enum(["undecided", "mitigate", "transfer", "avoid"]),
    treatmentPlan: z.string().max(5000).optional(),
    reviewDate: z.string().optional(),
    rationale: z.string().max(2000).optional(),
  })
  .refine((v) => (v.residualLikelihood == null) === (v.residualImpact == null), { message: "Set both residual factors or neither", path: ["residualImpact"] })
  .refine((v) => v.residualLikelihood == null || !!v.residualRationale?.trim(), { message: "Explain the verified mitigations behind the residual score", path: ["residualRationale"] });

type Values = z.infer<typeof schema>;

export const RISK_CATEGORIES = ["Access Control", "Data Protection", "Vulnerability", "Third Party", "AI", "Operational", "Compliance", "Technology", "Business Continuity", "Privacy"];

/** Create or edit a risk. Scores are computed by the API from the active policy, never by the browser. */
export function RiskFormDialog({ risk, trigger, onSaved }: { risk?: Risk; trigger: ReactNode; onSaved?: (r: Risk) => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: risk?.title ?? "",
      description: risk?.description ?? "",
      category: risk?.category ?? "",
      likelihood: risk?.likelihood ?? 3,
      impact: risk?.impact ?? 3,
      residualLikelihood: risk?.residualLikelihood ?? null,
      residualImpact: risk?.residualImpact ?? null,
      residualRationale: risk?.residualRationale ?? "",
      riskOwnerId: risk?.riskOwnerId ?? null,
      treatment: (risk?.treatment === "accept" ? "undecided" : (risk?.treatment as Values["treatment"])) ?? "undecided",
      treatmentPlan: risk?.treatmentPlan ?? "",
      reviewDate: toDateInput(risk?.reviewDate),
      rationale: "",
    },
  });
  const mutation = useApiMutation({
    mutationFn: (values: Values) => {
      const { rationale, reviewDate, ...rest } = values;
      const body = { ...rest, reviewDate: dateInput(reviewDate), residualRationale: rest.residualRationale || null, treatmentPlan: rest.treatmentPlan || null };
      return risk ? api.patch<Risk>(`/risks/${risk.id}`, { ...body, version: risk.version, rationale: rationale || undefined }) : api.post<Risk>("/risks", body);
    },
    success: risk ? "Risk updated" : "Risk created",
    invalidate: [["risks"]],
    form: form as unknown as UseFormReturn<FieldValues>,
    onSuccess: (r) => {
      setOpen(false);
      form.reset();
      onSaved?.(r);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && form.formState.isDirty && !window.confirm("Discard unsaved changes?")) return;
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{risk ? `Edit ${risk.riskKey}` : "New risk"}</DialogTitle>
          <DialogDescription>Inherent score = likelihood × impact. Residual factors are assessed separately after verified mitigations.</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form method="post" id="risk-form" onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate>
            <FieldGroup>
              <TextField<Values> name="title" label="Title" required />
              <TextareaField<Values> name="description" label="Description" required />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField<Values> name="category" label="Category" required options={RISK_CATEGORIES.map((c) => ({ value: c, label: c }))} />
                <UserField<Values> name="riskOwnerId" label="Risk owner" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ScaleField<Values> name="likelihood" label="Inherent likelihood" required />
                <ScaleField<Values> name="impact" label="Inherent impact" required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ScaleField<Values> name="residualLikelihood" label="Residual likelihood" allowEmpty />
                <ScaleField<Values> name="residualImpact" label="Residual impact" allowEmpty />
              </div>
              <TextareaField<Values> name="residualRationale" label="Residual rationale" description="Which verified mitigations justify the residual factors?" rows={3} />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField<Values> name="treatment" label="Treatment" options={[{ value: "undecided", label: "Undecided" }, { value: "mitigate", label: "Mitigate" }, { value: "transfer", label: "Transfer" }, { value: "avoid", label: "Avoid" }]} description="Acceptance goes through the approval workflow." />
                <DateField<Values> name="reviewDate" label="Next review date" />
              </div>
              <TextareaField<Values> name="treatmentPlan" label="Treatment plan" rows={3} />
              {risk && <TextField<Values> name="rationale" label="Reason for change" description="Recorded in the risk history." />}
            </FieldGroup>
          </form>
        </FormProvider>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="risk-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : risk ? "Save changes" : "Create risk"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
