"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export interface QuestionView {
  id: string;
  questionKey: string;
  category: string;
  questionText: string;
  responseType: "yes_no" | "single_choice" | "multiple_choice" | "text" | "number" | "date" | "file";
  options: string[];
  required: boolean;
  guidance?: string | null;
  evidenceRequired: boolean;
  dependsOnQuestionKey?: string | null;
  dependsOnAnswer?: unknown;
  visible: boolean;
}

export interface AnswerDraft {
  answer?: unknown;
  notApplicable?: boolean;
  naRationale?: string | null;
  comments?: string | null;
  evidenceId?: string | null;
}

type Condition = { equals: unknown } | { in: unknown[] } | { includes: unknown } | { notIncludes: unknown };

/** Mirrors the API's follow-up logic so questions appear/disappear as the respondent answers. */
export function isVisible(q: QuestionView, all: QuestionView[], drafts: Record<string, AnswerDraft>): boolean {
  if (!q.dependsOnQuestionKey) return true;
  const parent = all.find((p) => p.questionKey === q.dependsOnQuestionKey);
  if (!parent || !isVisible(parent, all, drafts)) return false;
  const d = drafts[parent.id];
  const answer = d?.notApplicable ? undefined : d?.answer;
  const c = q.dependsOnAnswer as Condition | null;
  if (!c) return true;
  if (answer === undefined || answer === null) return false;
  if ("equals" in c) return answer === c.equals;
  if ("in" in c) return c.in.includes(answer);
  if ("includes" in c) return Array.isArray(answer) && answer.includes(c.includes);
  if ("notIncludes" in c) return Array.isArray(answer) && answer.length > 0 && !answer.includes(c.notIncludes);
  return true;
}

/** Input control for one questionnaire answer, by response type. */
export function QuestionInput({ q, value, onChange, disabled }: { q: QuestionView; value: AnswerDraft; onChange: (v: AnswerDraft) => void; disabled?: boolean }) {
  const id = `q-${q.id}`;
  const set = (answer: unknown) => onChange({ ...value, answer, notApplicable: false });
  const na = !!value.notApplicable;
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">
        {q.questionText}
        {q.required && <span className="text-destructive" aria-hidden> *</span>}
      </legend>
      {q.guidance && <p className="text-xs text-muted-foreground">{q.guidance}</p>}
      {!na && (
        <div>
          {q.responseType === "yes_no" && (
            <RadioGroup value={value.answer === true ? "yes" : value.answer === false ? "no" : ""} onValueChange={(v) => set(v === "yes")} className="flex gap-4" aria-label={q.questionText}>
              <div className="flex items-center gap-2">
                <RadioGroupItem id={`${id}-y`} value="yes" />
                <Label htmlFor={`${id}-y`}>Yes</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem id={`${id}-n`} value="no" />
                <Label htmlFor={`${id}-n`}>No</Label>
              </div>
            </RadioGroup>
          )}
          {q.responseType === "single_choice" && (
            <RadioGroup value={(value.answer as string) ?? ""} onValueChange={set} className="space-y-1" aria-label={q.questionText}>
              {q.options.map((o) => (
                <div key={o} className="flex items-center gap-2">
                  <RadioGroupItem id={`${id}-${o}`} value={o} />
                  <Label htmlFor={`${id}-${o}`}>{o}</Label>
                </div>
              ))}
            </RadioGroup>
          )}
          {q.responseType === "multiple_choice" && (
            <div className="space-y-1" role="group" aria-label={q.questionText}>
              {q.options.map((o) => {
                const current = (value.answer as string[] | undefined) ?? [];
                return (
                  <label key={o} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox checked={current.includes(o)} onCheckedChange={(c) => set(c ? [...current, o] : current.filter((x) => x !== o))} />
                    {o}
                  </label>
                );
              })}
            </div>
          )}
          {q.responseType === "text" && <Textarea id={id} rows={3} value={(value.answer as string) ?? ""} onChange={(e) => set(e.target.value)} aria-label={q.questionText} />}
          {q.responseType === "number" && <Input id={id} type="number" className="w-40" value={value.answer == null ? "" : String(value.answer)} onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} aria-label={q.questionText} />}
          {q.responseType === "date" && <Input id={id} type="date" className="w-48" value={(value.answer as string) ?? ""} onChange={(e) => set(e.target.value || null)} aria-label={q.questionText} />}
          {q.responseType === "file" && <Input id={id} placeholder="Reference or description of the attached file" value={(value.answer as string) ?? ""} onChange={(e) => set(e.target.value)} aria-label={q.questionText} />}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Switch id={`${id}-na`} checked={na} onCheckedChange={(c) => onChange({ ...value, notApplicable: c, answer: c ? undefined : value.answer })} />
        <Label htmlFor={`${id}-na`} className="text-xs text-muted-foreground">
          Not applicable
        </Label>
      </div>
      {na && <Textarea rows={2} placeholder="Explain why this does not apply (required)" value={value.naRationale ?? ""} onChange={(e) => onChange({ ...value, naRationale: e.target.value })} aria-label="Not-applicable rationale" />}
      <Input placeholder="Comments (optional)" value={value.comments ?? ""} onChange={(e) => onChange({ ...value, comments: e.target.value })} aria-label="Comments" />
    </fieldset>
  );
}

/** Groups questions by category, keeping questionnaire order. */
export function byCategory<T extends { category: string }>(items: T[]): Array<[string, T[]]> {
  const map = new Map<string, T[]>();
  for (const i of items) map.set(i.category, [...(map.get(i.category) ?? []), i]);
  return [...map];
}
