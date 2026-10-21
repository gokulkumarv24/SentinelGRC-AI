"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { FormProvider, useForm, useWatch, type FieldValues, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { DateField, SelectField, SwitchField, TextareaField, TextField, UserField, dateInput, toDateInput } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { ControlDetail } from "@/lib/types";

const IMPL = ["not_assessed", "planned", "in_progress", "implemented", "partially_implemented", "not_applicable", "retired"];

const schema = z
  .object({
    status: z.string(),
    ownerId: z.string().nullable(),
    applicabilityRationale: z.string().max(5000).optional(),
    soaIncluded: z.boolean(),
    soaJustification: z.string().max(5000).optional(),
    implementationNotes: z.string().max(10000).optional(),
    nextReviewAt: z.string().optional(),
    rationale: z.string().max(2000).optional(),
  })
  .refine((v) => v.status !== "not_applicable" || !!v.applicabilityRationale?.trim(), { message: "Explain why the control is not applicable", path: ["applicabilityRationale"] })
  .refine((v) => v.soaIncluded || !!v.soaJustification?.trim(), { message: "Exclusions need a justification", path: ["soaJustification"] });
type Values = z.infer<typeof schema>;

/** Implementation, applicability and Statement of Applicability for one control. */
export function ImplementationForm({ control }: { control: ControlDetail }) {
  const can = useCan();
  const impl = control.implementation!;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    values: {
      status: impl.status,
      ownerId: impl.ownerId,
      applicabilityRationale: impl.applicabilityRationale ?? "",
      soaIncluded: impl.soaIncluded,
      soaJustification: impl.soaJustification ?? "",
      implementationNotes: impl.implementationNotes ?? "",
      nextReviewAt: toDateInput(impl.nextReviewAt),
      rationale: "",
    },
  });
  const soaIncluded = useWatch({ control: form.control, name: "soaIncluded" });
  const canAssign = can("control.assign");
  const mutation = useApiMutation({
    mutationFn: (v: Values) => {
      const body: Record<string, unknown> = {
        version: impl.version,
        status: v.status,
        applicabilityRationale: v.applicabilityRationale || null,
        soaIncluded: v.soaIncluded,
        soaJustification: v.soaJustification || null,
        implementationNotes: v.implementationNotes || null,
        rationale: v.rationale || undefined,
      };
      // Only send assignment fields when changed and permitted (they need control.assign).
      if (canAssign && v.ownerId !== impl.ownerId) body.ownerId = v.ownerId;
      if (canAssign && v.nextReviewAt !== toDateInput(impl.nextReviewAt)) body.nextReviewAt = dateInput(v.nextReviewAt);
      return api.patch(`/controls/${control.id}/implementation`, body);
    },
    success: "Implementation updated",
    invalidate: [["controls"]],
    form: form as unknown as UseFormReturn<FieldValues>,
  });
  const markReviewed = useApiMutation({
    mutationFn: () => api.patch(`/controls/${control.id}/implementation`, { version: impl.version, markReviewed: true }),
    success: "Review recorded; next review scheduled",
    invalidate: [["controls"]],
  });
  const readOnly = !can("control.update");

  return (
    <FormProvider {...form}>
      <form method="post" onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate>
        <fieldset disabled={readOnly || mutation.isPending}>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField<Values> name="status" label="Implementation status" options={IMPL.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} />
              {canAssign ? (
                <UserField<Values> name="ownerId" label="Control owner" />
              ) : (
                <div className="space-y-1.5">
                  <p className="text-sm font-medium">Control owner</p>
                  <p className="text-sm">{impl.owner?.displayName ?? "Unassigned"}</p>
                  <p className="text-xs text-muted-foreground">Changing the owner requires the control assignment permission.</p>
                </div>
              )}
            </div>
            <TextareaField<Values> name="applicabilityRationale" label="Applicability rationale" rows={2} />
            <SwitchField<Values> name="soaIncluded" label="Included in the Statement of Applicability" description="ISO/IEC 27001 SoA. Exclusions must be justified." />
            {!soaIncluded && <TextareaField<Values> name="soaJustification" label="Exclusion justification" rows={2} required />}
            <TextareaField<Values> name="implementationNotes" label="Implementation notes" rows={4} />
            {canAssign && <DateField<Values> name="nextReviewAt" label="Next review" />}
            <TextField<Values> name="rationale" label="Reason for change" description="Recorded in the audit trail." />
            {!readOnly && (
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={!form.formState.isDirty || mutation.isPending}>
                  {mutation.isPending ? "Saving…" : "Save implementation"}
                </Button>
                <Button type="button" variant="outline" onClick={() => markReviewed.mutate()} disabled={markReviewed.isPending}>
                  Mark reviewed today
                </Button>
              </div>
            )}
          </FieldGroup>
        </fieldset>
      </form>
    </FormProvider>
  );
}
