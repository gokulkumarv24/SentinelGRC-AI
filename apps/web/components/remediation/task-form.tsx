"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { FormProvider, useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { DateField, SelectField, TextareaField, TextField, UserField, dateInput } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";

const schema = z.object({
  title: z.string().trim().min(1, "Required").max(200),
  description: z.string().max(5000).optional(),
  ownerId: z.string().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  dueDate: z.string().optional(),
});
type Values = z.infer<typeof schema>;

/** `defaults` pre-fills the form (e.g. from the AI agent's triage); the user still reviews and creates the task. */
export function TaskFormDialog({ findingId, trigger, defaults, dueInDays }: { findingId?: string; trigger: ReactNode; defaults?: Partial<Values>; dueInDays?: number }) {
  const [open, setOpen] = useState(false);
  const initial = (): Values => ({
    title: "",
    description: "",
    ownerId: null,
    priority: "medium",
    dueDate: dueInDays ? new Date(Date.now() + dueInDays * 86_400_000).toISOString().slice(0, 10) : "",
    ...defaults,
  });
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { title: "", description: "", ownerId: null, priority: "medium", dueDate: "", ...defaults } });
  const mutation = useApiMutation({
    mutationFn: (v: Values) => api.post("/remediation-tasks", { ...v, description: v.description || null, dueDate: dateInput(v.dueDate), findingId: findingId ?? null }),
    success: "Remediation task created",
    invalidate: [["remediation"], ["findings"]],
    form: form as unknown as UseFormReturn<FieldValues>,
    onSuccess: () => {
      setOpen(false);
      form.reset();
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) form.reset(initial());
        setOpen(o);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New remediation task</DialogTitle>
        </DialogHeader>
        <FormProvider {...form}>
          <form method="post" id="task-form" onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate>
            <FieldGroup>
              <TextField<Values> name="title" label="Title" required />
              <TextareaField<Values> name="description" label="Plan / description" rows={3} />
              <div className="grid gap-4 sm:grid-cols-2">
                <UserField<Values> name="ownerId" label="Owner" />
                <SelectField<Values> name="priority" label="Priority" options={["low", "medium", "high", "urgent"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} />
              </div>
              <DateField<Values> name="dueDate" label="Due date" />
            </FieldGroup>
          </form>
        </FormProvider>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating…" : "Create task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
