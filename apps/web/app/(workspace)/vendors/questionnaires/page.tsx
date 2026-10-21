"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { humanize, StatusBadge } from "@/components/common/badges";
import { PageHeader, Section } from "@/components/common/page-header";
import { LoadingState, QueryState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";

interface Template {
  id: string;
  key: string;
  name: string;
  version: number;
  organizationId: string | null;
  description: string | null;
  frozen: boolean;
  _count: { questions: number };
}
interface Question {
  questionKey: string;
  questionText: string;
  category: string;
  responseType: string;
  options: string[];
  required: boolean;
  weight: number;
  important: boolean;
  guidance: string | null;
  evidenceRequired: boolean;
  expectedAnswer: unknown;
  dependsOnQuestionKey: string | null;
  dependsOnAnswer: unknown;
}

/** New version = edited copy of an existing template. Existing versions stay immutable. */
function NewVersionDialog({ base }: { base: Template }) {
  const [open, setOpen] = useState(false);
  const [json, setJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const detail = useQuery({ queryKey: ["questionnaires", base.id], queryFn: () => api.get<Template & { questions: Question[] }>(`/questionnaires/${base.id}`), enabled: open });
  const create = useApiMutation({ mutationFn: (questions: unknown) => api.post("/questionnaires", { baseTemplateId: base.id, key: base.organizationId ? base.key : `${base.key}-custom`, name: base.name, description: base.description ?? undefined, questions }), success: "New questionnaire version created", invalidate: [["questionnaires"]], onSuccess: () => setOpen(false) });
  const initial = detail.data
    ? JSON.stringify(
        detail.data.questions.map(({ questionKey, questionText, category, responseType, options, required, weight, important, guidance, evidenceRequired, expectedAnswer, dependsOnQuestionKey, dependsOnAnswer }) => ({ questionKey, questionText, category, responseType, options, required, weight, important, guidance: guidance ?? undefined, evidenceRequired, expectedAnswer: expectedAnswer ?? undefined, dependsOnQuestionKey: dependsOnQuestionKey ?? undefined, dependsOnAnswer: dependsOnAnswer ?? undefined })),
        null,
        2,
      )
    : "";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          New version
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New version of {base.name}</DialogTitle>
          <DialogDescription>Edit the questions (JSON). The API validates keys, response types, options and follow-up references. Assessments in progress keep their original version.</DialogDescription>
        </DialogHeader>
        {detail.isPending ? (
          <LoadingState rows={3} />
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="questions-json">Questions</Label>
            <Textarea id="questions-json" rows={18} className="font-mono text-xs" defaultValue={initial} onChange={(e) => setJson(e.target.value)} />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={create.isPending}
            onClick={() => {
              try {
                setError(null);
                create.mutate(JSON.parse(json || initial));
              } catch {
                setError("Questions must be valid JSON.");
              }
            }}
          >
            Create version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateQuestions({ id }: { id: string }) {
  const query = useQuery({ queryKey: ["questionnaires", id], queryFn: () => api.get<Template & { questions: Question[] }>(`/questionnaires/${id}`) });
  return (
    <QueryState query={query}>
      {(t) => (
        <ol className="space-y-2">
          {t.questions.map((q) => (
            <li key={q.questionKey} className="rounded-md border p-2 text-sm">
              <p>
                {q.questionText} {q.required && <span className="text-destructive">*</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{q.questionKey}</span> · {humanize(q.category)} · {humanize(q.responseType)} · weight {q.weight}
                {q.important && " · important"}
                {q.evidenceRequired && " · evidence required"}
                {q.dependsOnQuestionKey && ` · shown when ${q.dependsOnQuestionKey} ${JSON.stringify(q.dependsOnAnswer)}`}
              </p>
              {q.expectedAnswer != null && <p className="font-mono text-[11px] text-muted-foreground">expected: {JSON.stringify(q.expectedAnswer)}</p>}
            </li>
          ))}
        </ol>
      )}
    </QueryState>
  );
}

export default function Questionnaires() {
  const can = useCan();
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["questionnaires"], queryFn: () => api.get<Template[]>("/questionnaires") });
  return (
    <>
      <PageHeader title="Questionnaires" description="Versioned vendor security questionnaires. A version is frozen as soon as an assessment using it is submitted." crumbs={[{ label: "Third-Party Risk" }, { label: "Questionnaires" }]} />
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <QueryState query={query}>
          {(rows) => (
            <ul className="space-y-2">
              {rows.map((t) => (
                <li key={t.id}>
                  <div className={`rounded-lg border bg-card p-3 ${selected === t.id ? "border-primary" : ""}`}>
                    <button type="button" className="w-full cursor-pointer text-left" onClick={() => setSelected(t.id)}>
                      <p className="font-medium">
                        {t.name} <span className="text-xs text-muted-foreground">v{t.version}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t._count.questions} questions · {t.organizationId ? "Organization" : "Platform"}
                      </p>
                    </button>
                    <div className="mt-2 flex items-center gap-2">
                      {t.frozen && <StatusBadge status="final" label="Frozen" />}
                      {can("questionnaire.manage") && <NewVersionDialog base={t} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </QueryState>
        <Section title="Questions">{selected ? <TemplateQuestions id={selected} /> : <p className="text-sm text-muted-foreground">Select a questionnaire.</p>}</Section>
      </div>
    </>
  );
}
