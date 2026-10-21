"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Section } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useActiveOrg, useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";

interface Onboarding {
  complete: boolean;
  steps: Array<{ key: string; done: boolean; count: number }>;
}

const STEPS: Record<string, { label: string; detail: string; href: string }> = {
  frameworks: { label: "Choose the frameworks you track", detail: "Compliance coverage is measured per framework version in scope.", href: "/settings/frameworks" },
  controls: { label: "Add your controls", detail: "Adopt illustrative templates or import a CSV, then assign owners.", href: "/controls" },
  members: { label: "Invite your team", detail: "Give each person only the roles they need.", href: "/settings/members" },
  evidence: { label: "Upload evidence", detail: "Link evidence to controls so automated checks can run.", href: "/evidence" },
  risks: { label: "Record your first risks", detail: "Score likelihood and impact under your risk policy.", href: "/risks" },
  integrations: { label: "Connect an integration", detail: "Automated checks use synced data; failures are shown, never hidden.", href: "/integrations" },
  third_parties: { label: "Register vendors and AI systems", detail: "Assess third parties and AI use cases with documented scoring.", href: "/vendors" },
};

const storageKey = (orgId: string) => `sentinelgrc:getting-started-dismissed:${orgId}`;

function readDismissed(orgId: string) {
  try {
    return window.localStorage.getItem(storageKey(orgId)) === "1";
  } catch {
    return false;
  }
}

/** Setup checklist for organization administrators (spec §14.4 item 2). Progress comes from the organization's own records. */
export function GettingStarted() {
  const can = useCan();
  const org = useActiveOrg();
  const [dismissed, setDismissed] = useState(() => (org ? readDismissed(org.id) : false));
  const query = useQuery({ queryKey: ["onboarding"], queryFn: () => api.get<Onboarding>("/organizations/current/onboarding"), enabled: can("org.manage") });
  if (!can("org.manage") || !org || dismissed || !query.data || query.data.complete) return null;
  const done = query.data.steps.filter((s) => s.done).length;
  const dismiss = () => {
    try {
      window.localStorage.setItem(storageKey(org.id), "1");
    } catch {
      // Storage unavailable: hide for this visit only.
    }
    setDismissed(true);
  };
  return (
    <Section
      title={`Set up ${org.name}`}
      description={`${done} of ${query.data.steps.length} steps done. Progress updates as your team adds records.`}
      actions={<Button size="icon-xs" variant="ghost" aria-label="Hide setup checklist" onClick={dismiss}><X /></Button>}
    >
      <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {query.data.steps.map((s) => {
          const step = STEPS[s.key];
          if (!step) return null;
          return (
            <li key={s.key}>
              <Link href={step.href} className="flex h-full gap-2 rounded-md border p-3 text-sm hover:border-primary">
                {s.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Done" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Not done" />}
                <span>
                  <span className={s.done ? "text-muted-foreground line-through" : "font-medium"}>{step.label}</span>
                  <span className="block text-xs text-muted-foreground">{step.detail}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
