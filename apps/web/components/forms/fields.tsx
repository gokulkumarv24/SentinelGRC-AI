"use client";

import type { ReactNode } from "react";
import { Controller, useFormContext, type FieldValues, type Path } from "react-hook-form";
import { UserSelect } from "@/components/common/user-select";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** Form fields bound to react-hook-form context: every input has a label, description and inline error. */

interface Base<T extends FieldValues> {
  name: Path<T>;
  label: string;
  description?: ReactNode;
  required?: boolean;
}

function useFieldError(name: string) {
  const { formState } = useFormContext();
  const path = name.split(".");
  let err: unknown = formState.errors;
  for (const p of path) err = (err as Record<string, unknown> | undefined)?.[p];
  return (err as { message?: string } | undefined)?.message;
}

function Wrapper({ name, label, description, required, children }: { name: string; label: string; description?: ReactNode; required?: boolean; children: ReactNode }) {
  const error = useFieldError(name);
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={name}>
        {label}
        {required && <span className="text-destructive" aria-hidden> *</span>}
      </FieldLabel>
      {children}
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function TextField<T extends FieldValues>({ name, label, description, required, type = "text", placeholder, autoComplete }: Base<T> & { type?: string; placeholder?: string; autoComplete?: string }) {
  const { register, formState } = useFormContext<T>();
  return (
    <Wrapper name={name} label={label} description={description} required={required}>
      <Input id={name} type={type} placeholder={placeholder} autoComplete={autoComplete} aria-invalid={!!useFieldError(name)} aria-required={required} disabled={formState.isSubmitting} {...register(name)} />
    </Wrapper>
  );
}

export function TextareaField<T extends FieldValues>({ name, label, description, required, rows = 4 }: Base<T> & { rows?: number }) {
  const { register, formState } = useFormContext<T>();
  return (
    <Wrapper name={name} label={label} description={description} required={required}>
      <Textarea id={name} rows={rows} aria-invalid={!!useFieldError(name)} aria-required={required} disabled={formState.isSubmitting} {...register(name)} />
    </Wrapper>
  );
}

export function DateField<T extends FieldValues>({ name, label, description, required }: Base<T>) {
  const { register, formState } = useFormContext<T>();
  return (
    <Wrapper name={name} label={label} description={description} required={required}>
      <Input id={name} type="date" aria-invalid={!!useFieldError(name)} aria-required={required} disabled={formState.isSubmitting} {...register(name)} />
    </Wrapper>
  );
}

export function SelectField<T extends FieldValues>({ name, label, description, required, options, placeholder = "Select…" }: Base<T> & { options: Array<{ value: string; label: string }>; placeholder?: string }) {
  const { control, formState } = useFormContext<T>();
  return (
    <Wrapper name={name} label={label} description={description} required={required}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select value={field.value ?? ""} onValueChange={field.onChange} disabled={formState.isSubmitting}>
            <SelectTrigger id={name} className="w-full" aria-invalid={!!formState.errors[name]}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Wrapper>
  );
}

const SCALE_LABELS = ["1 · Very low", "2 · Low", "3 · Moderate", "4 · High", "5 · Very high"];

/** 1–5 likelihood / impact picker. */
export function ScaleField<T extends FieldValues>({ name, label, description, required, allowEmpty }: Base<T> & { allowEmpty?: boolean }) {
  const { control, formState } = useFormContext<T>();
  return (
    <Wrapper name={name} label={label} description={description} required={required}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select value={field.value == null ? "__none" : String(field.value)} onValueChange={(v) => field.onChange(v === "__none" ? null : Number(v))} disabled={formState.isSubmitting}>
            <SelectTrigger id={name} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowEmpty && <SelectItem value="__none">Not assessed</SelectItem>}
              {SCALE_LABELS.map((l, i) => (
                <SelectItem key={l} value={String(i + 1)}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </Wrapper>
  );
}

export function UserField<T extends FieldValues>({ name, label, description, required }: Base<T>) {
  const { control, formState } = useFormContext<T>();
  return (
    <Wrapper name={name} label={label} description={description} required={required}>
      <Controller control={control} name={name} render={({ field }) => <UserSelect id={name} value={field.value} onChange={field.onChange} disabled={formState.isSubmitting} />} />
    </Wrapper>
  );
}

export function SwitchField<T extends FieldValues>({ name, label, description }: Base<T>) {
  const { control } = useFormContext<T>();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field orientation="horizontal">
          <Switch id={name} checked={!!field.value} onCheckedChange={field.onChange} />
          <div>
            <FieldLabel htmlFor={name}>{label}</FieldLabel>
            {description && <FieldDescription>{description}</FieldDescription>}
          </div>
        </Field>
      )}
    />
  );
}

/** "2026-10-21" (from <input type=date>) → ISO string at UTC noon, or null. */
export function dateInput(value: string | null | undefined): string | null {
  return value ? new Date(`${value}T12:00:00Z`).toISOString() : null;
}

/** ISO string → value for <input type=date>. */
export function toDateInput(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "";
}
