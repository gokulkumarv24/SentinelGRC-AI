"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z.string().min(12, "Use at least 12 characters").max(200).refine((v) => /[a-z]/i.test(v) && /[^a-z]/i.test(v), "Mix letters with numbers or symbols"),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

function ChangePassword() {
  const required = useSearchParams().get("required");
  const router = useRouter();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { currentPassword: "", newPassword: "", confirm: "" } });

  const onSubmit = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setError(null);
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      await qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Password changed. Other sessions were signed out.");
      router.push("/dashboard");
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <div className="max-w-lg">
      <PageHeader title="Change password" description={required ? "You must set a new password before continuing." : "Changing your password signs out your other sessions."} />
      <Card>
        <CardContent>
          <form method="post" onSubmit={onSubmit} noValidate>
            <FieldGroup>
              <Field data-invalid={!!form.formState.errors.currentPassword}>
                <FieldLabel htmlFor="currentPassword">Current password</FieldLabel>
                <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register("currentPassword")} />
                <FieldError>{form.formState.errors.currentPassword?.message}</FieldError>
              </Field>
              <Field data-invalid={!!form.formState.errors.newPassword}>
                <FieldLabel htmlFor="newPassword">New password</FieldLabel>
                <Input id="newPassword" type="password" autoComplete="new-password" {...form.register("newPassword")} />
                <FieldDescription>At least 12 characters, mixing letters with numbers or symbols.</FieldDescription>
                <FieldError>{form.formState.errors.newPassword?.message}</FieldError>
              </Field>
              <Field data-invalid={!!form.formState.errors.confirm}>
                <FieldLabel htmlFor="confirm">Confirm new password</FieldLabel>
                <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
                <FieldError>{form.formState.errors.confirm?.message}</FieldError>
              </Field>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Change password"}
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <ChangePassword />
    </Suspense>
  );
}
