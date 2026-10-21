"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { FormProvider, useForm, type FieldValues, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { PageHeader, Section } from "@/components/common/page-header";
import { ErrorState, LoadingState } from "@/components/common/states";
import { SwitchField, TextField } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { FieldGroup } from "@/components/ui/field";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";

interface Org {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  timezone: string;
  isDemo: boolean;
  settings: {
    evidenceRetentionDays: number;
    auditRetentionDays: number;
    requireSeparationOfDutiesForHighRisk: boolean;
    allowSelfApprovalForLowRisk: boolean;
    aiFeaturesEnabled: boolean;
    reportRetentionDays: number;
  };
}

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  industry: z.string().max(120).optional(),
  timezone: z.string().min(1),
  evidenceRetentionDays: z.coerce.number().int().min(30).max(36500),
  auditRetentionDays: z.coerce.number().int().min(365).max(36500),
  reportRetentionDays: z.coerce.number().int().min(1).max(3650),
  requireSeparationOfDutiesForHighRisk: z.boolean(),
  allowSelfApprovalForLowRisk: z.boolean(),
  aiFeaturesEnabled: z.boolean(),
});
type Values = z.infer<typeof schema>;

function OrgForm({ org }: { org: Org }) {
  const can = useCan();
  const form = useForm<Values>({
    resolver: zodResolver(schema) as never,
    values: { name: org.name, industry: org.industry ?? "", timezone: org.timezone, ...org.settings },
  });
  const mutation = useApiMutation({
    mutationFn: (v: Values) =>
      api.patch("/organizations/current", {
        name: v.name,
        industry: v.industry || null,
        timezone: v.timezone,
        settings: {
          evidenceRetentionDays: v.evidenceRetentionDays,
          auditRetentionDays: v.auditRetentionDays,
          reportRetentionDays: v.reportRetentionDays,
          requireSeparationOfDutiesForHighRisk: v.requireSeparationOfDutiesForHighRisk,
          allowSelfApprovalForLowRisk: v.allowSelfApprovalForLowRisk,
          aiFeaturesEnabled: v.aiFeaturesEnabled,
        },
      }),
    success: "Settings saved",
    invalidate: [["organization"], ["me"]],
    form: form as unknown as UseFormReturn<FieldValues>,
  });
  return (
    <FormProvider {...form}>
      <form method="post" onSubmit={form.handleSubmit((v) => mutation.mutate(v))} noValidate className="space-y-4">
        <fieldset disabled={!can("org.manage") || mutation.isPending} className="space-y-4">
          <Section title="Profile">
            <FieldGroup>
              <TextField<Values> name="name" label="Organization name" required />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField<Values> name="industry" label="Industry" />
                <TextField<Values> name="timezone" label="Time zone" description="IANA name, e.g. Europe/Zurich. Times are stored in UTC." />
              </div>
            </FieldGroup>
          </Section>
          <Section title="Governance" description="Separation-of-duties rules for approvals.">
            <FieldGroup>
              <SwitchField<Values> name="requireSeparationOfDutiesForHighRisk" label="Require a different approver for high and critical risks" description="Applies to risk acceptance and closure of high/critical findings." />
              <SwitchField<Values> name="allowSelfApprovalForLowRisk" label="Allow self-approval for low risks" description="Off by default. Even when on, high-impact decisions still require a second person." />
              <SwitchField<Values> name="aiFeaturesEnabled" label="Enable AI assistant features" description="AI output is always advisory and stored as a draft until a person approves it." />
            </FieldGroup>
          </Section>
          <Section title="Retention" description="Configurable targets. Legal retention requirements need organization-specific review.">
            <div className="grid gap-4 sm:grid-cols-3">
              <TextField<Values> name="evidenceRetentionDays" label="Archived evidence (days)" type="number" />
              <TextField<Values> name="auditRetentionDays" label="Audit events (days)" type="number" />
              <TextField<Values> name="reportRetentionDays" label="Generated reports (days)" type="number" />
            </div>
          </Section>
        </fieldset>
        {can("org.manage") && (
          <Button type="submit" disabled={!form.formState.isDirty || mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save settings"}
          </Button>
        )}
      </form>
    </FormProvider>
  );
}

export default function OrganizationSettings() {
  const query = useQuery({ queryKey: ["organization"], queryFn: () => api.get<Org>("/organizations/current") });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Organization settings" crumbs={[{ label: "Administration" }, { label: "Organization settings" }]} />
      {query.isPending ? <LoadingState /> : query.isError ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : <OrgForm org={query.data} />}
    </div>
  );
}
