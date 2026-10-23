"use client";

import { ArrowRight, Bot, RotateCcw } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader, Section } from "@/components/common/page-header";
import { resetPageHelp } from "@/components/help/page-help";
import { Button } from "@/components/ui/button";
import { useCan, useMe } from "@/hooks/use-me";
import { GLOSSARY, PAGE_GUIDES, ROLE_STARTS } from "@/lib/help-content";
import { NAVIGATION } from "@/lib/navigation";

const LOOP = [
  { title: "Prove", text: "Upload evidence for each control and set when it expires." },
  { title: "Check", text: "Automatic tests check the controls on a schedule." },
  { title: "Find", text: "A failing check creates a finding, with the AI agent's triage." },
  { title: "Fix", text: "An owner completes the remediation task; someone else validates it." },
  { title: "Show", text: "The dashboard, reports and audit log prove it to management and auditors." },
];

export default function HelpPage() {
  const can = useCan();
  const { data: me } = useMe();
  const mine = new Set(me?.roles ?? []);
  const starts = [...ROLE_STARTS].sort((a, b) => Number(mine.has(b.role)) - Number(mine.has(a.role)));
  const sections = NAVIGATION.map((s) => ({ ...s, items: s.items.filter((i) => !i.platformAdmin && can(i.permission) && PAGE_GUIDES[i.href]) })).filter((s) => s.items.length);
  return (
    <>
      <PageHeader title="Help & Guide" description="Everything you need to start: what to do first for your role, how the pieces fit together, what the AI agent does, and what the words mean." crumbs={[{ label: "Help & Guide" }]} />
      <div className="space-y-6">
        <Section title="Start here" description={mine.size ? "Your role is shown first. Each step opens the right page; every page also explains itself in its “How this page works” panel." : "Pick the role you were given."}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {starts.map((r) => (
              <article key={r.role} className={`rounded-md border p-3 ${mine.has(r.role) ? "border-primary/50 bg-primary/5" : ""}`} aria-label={r.name}>
                <h3 className="text-sm font-semibold">
                  {r.name} {mine.has(r.role) && <span className="ml-1 rounded bg-primary px-1.5 py-0.5 text-xs font-medium text-primary-foreground">Your role</span>}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">{r.purpose}</p>
                <ol className="mt-2 space-y-1 text-sm">
                  {r.steps.map((s, i) => (
                    <li key={s.label}>
                      <Link href={s.href} className="inline-flex items-start gap-1.5 text-primary hover:underline">
                        <span className="text-muted-foreground">{i + 1}.</span> {s.label}
                      </Link>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </Section>

        <Section title="How it fits together" description="The everyday loop that keeps you compliant.">
          <ol className="grid gap-2 sm:grid-cols-5">
            {LOOP.map((l, i) => (
              <li key={l.title} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                <span>
                  <span className="font-medium">{l.title}</span>
                  <span className="block text-xs text-muted-foreground">{l.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-muted-foreground">Alongside the loop: record <strong>risks</strong> and accept them formally when needed, assess <strong>vendors</strong> and <strong>AI systems</strong> before you rely on them, and answer <strong>customer questionnaires</strong> from the same data.</p>
        </Section>

        <Section title="The AI agent" description="What it does and what it never does.">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="text-sm">
              <p className="flex items-center gap-1.5 font-medium"><Bot className="size-4" aria-hidden /> It prepares work in the background</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Pre-reviews every evidence upload and vendor document.</li>
                <li>Pre-reviews vendor questionnaire answers and drafts the decision memo.</li>
                <li>Triages new findings and drafts the remediation task.</li>
                <li>Answers customer questionnaires from your approved answers, controls and evidence.</li>
                <li>Proposes framework mappings, new risks, and a weekly vendor digest.</li>
                <li>Reminds owners about expiring evidence with what to collect.</li>
              </ul>
            </div>
            <div className="text-sm">
              <p className="font-medium">People stay in charge</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                <li>Everything it produces is labelled “Prepared by the AI agent” and waits for review.</li>
                <li>It never approves, decides, closes or sends anything outside the platform.</li>
                <li>Use the “Apply”, “Fill in” and “Create” buttons next to its drafts to use them in one click.</li>
                <li>Admins can switch each agent job off. It pauses by itself if AI is off or the daily budget is used up.</li>
              </ul>
              {can("assistant.use") && (
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link href="/agent">Open the AI agent <ArrowRight aria-hidden /></Link>
                </Button>
              )}
            </div>
          </div>
        </Section>

        <Section title="Glossary" description="Plain meanings of the words used across the platform.">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {GLOSSARY.map((g) => (
              <div key={g.term}>
                <dt className="text-sm font-medium">{g.term}</dt>
                <dd className="text-sm text-muted-foreground">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section
          title="Every page explained"
          description="The same guides you see under each page title. Only pages your role can open are listed."
          actions={
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                resetPageHelp();
                toast.success("Page guides will open again on your next visit to each page");
              }}
            >
              <RotateCcw aria-hidden /> Show page guides again
            </Button>
          }
        >
          <div className="space-y-4">
            {sections.map((s) => (
              <div key={s.title}>
                <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{s.title}</h3>
                <div className="divide-y rounded-md border">
                  {s.items.map((i) => {
                    const g = PAGE_GUIDES[i.href];
                    return (
                      <details key={i.href} className="group p-3">
                        <summary className="cursor-pointer text-sm font-medium">
                          {i.title} <span className="font-normal text-muted-foreground">— {g.summary}</span>
                        </summary>
                        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                          {g.steps.map((step) => <li key={step}>{step}</li>)}
                        </ol>
                        {g.tips?.map((t) => <p key={t} className="mt-1 text-xs text-muted-foreground">Tip: {t}</p>)}
                        <Link href={i.href} className="mt-2 inline-block text-xs text-primary hover:underline">Open {i.title}</Link>
                      </details>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
