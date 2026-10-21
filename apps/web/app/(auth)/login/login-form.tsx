"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api";
import { safeNext } from "@/lib/safe-next";

const schema = z.object({
  email: z.email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export function LoginForm() {
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post("/auth/login", values);
      window.location.assign(safeNext(params.get("next")));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? "Too many attempts. Please wait a minute and try again." : e instanceof ApiError ? e.message : "Unable to sign in right now.");
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Use your organization account.</CardDescription>
      </CardHeader>
      <CardContent>
        {params.get("expired") && (
          <p role="status" className="mb-4 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn">
            Your session expired. Please sign in again.
          </p>
        )}
        <form method="post" onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <Field data-invalid={!!form.formState.errors.email}>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!form.formState.errors.email} {...form.register("email")} />
              <FieldError>{form.formState.errors.email?.message}</FieldError>
            </Field>
            <Field data-invalid={!!form.formState.errors.password}>
              <FieldLabel htmlFor="password">Password</FieldLabel>
              <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!form.formState.errors.password} {...form.register("password")} />
              <FieldError>{form.formState.errors.password?.message}</FieldError>
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
