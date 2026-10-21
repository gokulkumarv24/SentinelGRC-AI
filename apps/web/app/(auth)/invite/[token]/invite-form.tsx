"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ErrorState, LoadingState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";

const schema = z
  .object({
    displayName: z.string().trim().min(1, "Enter your name").max(120),
    password: z.string().min(12, "Use at least 12 characters").max(200).refine((v) => /[a-z]/i.test(v) && /[^a-z]/i.test(v), "Mix letters with numbers or symbols"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] });

export function InviteForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ["invitation", token],
    queryFn: () => api.get<{ organizationName: string; email: string; roles: string[] }>(`/invitations/${encodeURIComponent(token)}`),
    retry: false,
  });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { displayName: "", password: "", confirm: "" } });

  if (preview.isPending) return <LoadingState rows={3} />;
  if (preview.isError) return <ErrorState error={preview.error} />;
  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>You&apos;re in</CardTitle>
          <CardDescription>You have joined {preview.data.organizationName}.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/login">Sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const onSubmit = form.handleSubmit(async ({ displayName, password }) => {
    setError(null);
    try {
      await api.post(`/invitations/${encodeURIComponent(token)}/accept`, { displayName, password });
      setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join {preview.data.organizationName}</CardTitle>
        <CardDescription>
          Invitation for <strong>{preview.data.email}</strong> as {preview.data.roles.map((r) => r.replace(/_/g, " ")).join(", ")}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form method="post" onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.displayName}>
              <FieldLabel htmlFor="displayName">Your name</FieldLabel>
              <Input id="displayName" autoComplete="name" {...form.register("displayName")} />
              <FieldError>{form.formState.errors.displayName?.message}</FieldError>
            </Field>
            <Field data-invalid={!!form.formState.errors.password}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
              <FieldDescription>At least 12 characters. If you already have an account, enter its password.</FieldDescription>
              <FieldError>{form.formState.errors.password?.message}</FieldError>
            </Field>
            <Field data-invalid={!!form.formState.errors.confirm}>
              <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
              <Input id="confirm" type="password" autoComplete="new-password" {...form.register("confirm")} />
              <FieldError>{form.formState.errors.confirm?.message}</FieldError>
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Joining…" : "Accept invitation"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
