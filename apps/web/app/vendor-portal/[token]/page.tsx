"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Paperclip, ShieldHalf } from "lucide-react";
import { use, useMemo, useState } from "react";
import { toast } from "sonner";
import { humanize } from "@/components/common/badges";
import { DateText } from "@/components/common/date-text";
import { ErrorState, LoadingState } from "@/components/common/states";
import { byCategory, isVisible, QuestionInput, type AnswerDraft, type QuestionView } from "@/components/vendors/question-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError, errorMessage } from "@/lib/api";

interface PortalView {
  requester: string;
  vendor: string;
  questionnaire: { name: string; version: number };
  status: string;
  editable: boolean;
  dueDate: string | null;
  questions: Array<QuestionView & { response: { answer: unknown; notApplicable: boolean; naRationale: string | null; comments: string | null; hasEvidence: boolean } | null }>;
}

/** Token-authenticated portal requests (no session cookie, so no CSRF token). */
async function portalFetch<T>(token: string, path = "", init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1/vendor-portal/${encodeURIComponent(token)}${path}`, { ...init, credentials: "omit" });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? "Request failed", data?.error?.details, data?.requestId);
  return data as T;
}

export default function VendorPortal({ params }: PageProps<"/vendor-portal/[token]">) {
  const { token } = use(params);
  const query = useQuery({ queryKey: ["portal", token], queryFn: () => portalFetch<PortalView>(token), retry: false });
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({});
  const [evidence, setEvidence] = useState<Record<string, { id: string; name: string }>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  // Initialise drafts from the server whenever a new copy of the questionnaire arrives (no effect needed).
  const [loaded, setLoaded] = useState<PortalView | undefined>(undefined);
  if (query.data && query.data !== loaded) {
    setLoaded(query.data);
    setDrafts(Object.fromEntries(query.data.questions.filter((q) => q.response).map((q) => [q.id, { answer: q.response!.answer, notApplicable: q.response!.notApplicable, naRationale: q.response!.naRationale, comments: q.response!.comments }])));
  }
  const visible = useMemo(() => (query.data ? query.data.questions.filter((q) => isVisible(q, query.data.questions, drafts)) : []), [query.data, drafts]);

  const save = async () => {
    setBusy(true);
    try {
      await portalFetch(token, "/responses", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ responses: Object.entries(drafts).map(([questionId, d]) => ({ questionId, answer: d.notApplicable ? undefined : d.answer, notApplicable: d.notApplicable, naRationale: d.naRationale, comments: d.comments, evidenceId: evidence[questionId]?.id })) }) });
      toast.success("Answers saved");
      return true;
    } catch (e) {
      const details = e instanceof ApiError ? (e.details?.answers as Array<{ message: string }> | undefined) : undefined;
      toast.error(details?.length ? `${details.length} answer(s) need attention: ${details[0].message}` : errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!(await save())) return;
    setBusy(true);
    try {
      await portalFetch(token, "/submit", { method: "POST" });
      setDone(true);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const upload = async (questionId: string, file: File) => {
    const body = new FormData();
    body.set("file", file);
    body.set("title", file.name);
    try {
      const ev = await portalFetch<{ id: string; originalFilename: string }>(token, "/evidence", { method: "POST", body });
      setEvidence({ ...evidence, [questionId]: { id: ev.id, name: ev.originalFilename } });
      toast.success("File uploaded — save your answers to attach it");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
          <ShieldHalf className="size-5 text-primary" aria-hidden />
          <span className="font-semibold">Security questionnaire</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        {query.isPending ? (
          <LoadingState rows={6} />
        ) : query.isError ? (
          <ErrorState error={query.error} />
        ) : done ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border bg-card p-10 text-center">
            <CheckCircle2 className="size-10 text-ok" aria-hidden />
            <p className="font-medium">Thank you — your answers were submitted to {query.data.requester}.</p>
            <p className="text-sm text-muted-foreground">You can close this page. The requester will contact you if clarification is needed.</p>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold">
              {query.data.questionnaire.name} for {query.data.vendor}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Requested by {query.data.requester}
              {query.data.dueDate && (
                <>
                  {" "}· due <DateText value={query.data.dueDate} />
                </>
              )}
              . Answer only what you are authorized to share. Do not upload passwords or secrets.
            </p>
            {!query.data.editable && <p className="mt-4 rounded-md bg-info-bg p-3 text-sm text-info">This questionnaire has been submitted and can no longer be changed.</p>}
            <div className="mt-6 space-y-6">
              {byCategory(visible).map(([category, qs]) => (
                <section key={category} className="rounded-lg border bg-card p-4" aria-label={humanize(category)}>
                  <h2 className="mb-4 text-sm font-semibold">{humanize(category)}</h2>
                  <ol className="space-y-6">
                    {qs.map((q) => (
                      <li key={q.id}>
                        <QuestionInput q={q} value={drafts[q.id] ?? {}} onChange={(v) => setDrafts({ ...drafts, [q.id]: v })} disabled={!query.data.editable || busy} />
                        {q.evidenceRequired && query.data.editable && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <Paperclip className="size-3.5" aria-hidden /> Supporting document required
                            <Input type="file" className="h-8 w-64" accept=".pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx" aria-label={`Upload evidence for ${q.questionKey}`} onChange={(e) => e.target.files?.[0] && upload(q.id, e.target.files[0])} />
                            {(evidence[q.id] || q.response?.hasEvidence) && <span className="text-ok">{evidence[q.id]?.name ?? "File attached"}</span>}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
            {query.data.editable && (
              <div className="sticky bottom-4 mt-6 flex justify-end gap-2 rounded-lg border bg-card p-3 shadow-sm">
                <Button variant="outline" onClick={save} disabled={busy}>
                  Save progress
                </Button>
                <Button onClick={submit} disabled={busy}>
                  Submit answers
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
