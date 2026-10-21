"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { FormProvider, useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { DateField, SelectField, TextareaField, TextField, UserField, dateInput } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";
import type { Finding } from "@/lib/types";

const schema = z.object({
  title: z.string().trim().min(1, "Required").max(200),
  description: z.string().trim().min(1, "Required").max(5000),
  severity: z.enum(["low", "medium", "high", "critical"]),
  severityRationale: z.string().max(2000).optional(),
  category: z.string().max(80).optional(),
  assignedTo: z.string().nullable(),
  dueDate: z.string().optional(),
  noDueDateReason: z.string().max(1000).optional(),
});

type Values = z.infer<typeof schema>;

/** Manual finding. If no due date is given the API applies the severity default (critical 7d … low 90d). */
export function FindingFormDialog({ trigger, defaults }: { trigger: ReactNode; defaults?: { controlId?: string; riskId?: string } }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { title: "", description: "", severity: "medium", severityRationale: "", category: "", assignedTo: null, dueDate: "", noDueDateReason: "" } });
  const mutation = useApiMutation({
    mutationFn: (v: Values) =>
      api.post<Finding>("/findings", {
        ...v,
        severityRationale: v.severityRationale || undefined,
        category: v.category || undefined,
        dueDate: v.dueDate ? dateInput(v.dueDate) : undefined,
        noDueDateReason: v.noDueDateReason || undefined,
        controlId: defaults?.controlId,
        riskId: defaults?.riskId,
      }),
    success: (f) => `Finding ${f.findingKey} created`,
    invalidate: [["findings"], ["controls"], ["risks"]],
    form: form as unknown as UseFormReturn<FieldValues>,
    onSuccess: (f) => {
      setOpen(false);
      form.reset();
      router.push(`/findings/${f.id}`);
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New finding</DialogTitle>
          <DialogDescription>Findings record a gap, its severity, owner and due date.</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form method="post" id="finding-form" onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate>
            <FieldGroup>
              <TextField<Values> name="title" label="Title" required />
              <TextareaField<Values> name="description" label="Description" required />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField<Values> name="severity" label="Severity" required options={["low", "medium", "high", "critical"].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
                <UserField<Values> name="assignedTo" label="Assignee" />
              </div>
              <TextareaField<Values> name="severityRationale" label="Severity rationale" rows={2} />
              <div className="grid gap-4 sm:grid-cols-2">
                <DateField<Values> name="dueDate" label="Due date" description="Leave empty for the severity default." />
                <TextField<Values> name="category" label="Category" />
              </div>
            </FieldGroup>
          </form>
        </FormProvider>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="finding-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create finding"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
