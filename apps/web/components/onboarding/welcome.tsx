"use client";

import { ArrowRight, X } from "lucide-react";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Section } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { useMe } from "@/hooks/use-me";
import { ROLE_STARTS } from "@/lib/help-content";

const EVENT = "sentinelgrc:welcome";
const key = (userId: string) => `sentinelgrc:welcome-dismissed:${userId}`;
const subscribe = (cb: () => void) => {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
};

/** "Your first steps": role-based starting points for people new to the platform. Dismissible per person. */
export function Welcome() {
  const { data: me } = useMe();
  const userId = me?.user.id ?? "";
  const dismissed = useSyncExternalStore(
    subscribe,
    () => {
      if (!userId) return true;
      try {
        return window.localStorage.getItem(key(userId)) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
  const [hidden, setHidden] = useState(false);
  const roles = new Set(me?.roles ?? []);
  const starts = ROLE_STARTS.filter((r) => roles.has(r.role));
  if (!me || dismissed || hidden || !starts.length) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(key(userId), "1");
    } catch {
      // Storage unavailable: hide for this visit only.
    }
    window.dispatchEvent(new Event(EVENT));
    setHidden(true);
  };
  return (
    <Section
      title={`Welcome, ${me.user.displayName.split(" ")[0]} — your first steps`}
      description="Based on your role. Each page also explains itself in its “How this page works” panel, and Help & Guide in the sidebar covers everything."
      actions={<Button size="icon-xs" variant="ghost" aria-label="Hide your first steps" onClick={dismiss}><X /></Button>}
    >
      <div className="grid gap-3 md:grid-cols-2">
        {starts.map((r) => (
          <div key={r.role}>
            <p className="text-sm font-medium">{r.name}</p>
            <p className="text-xs text-muted-foreground">{r.purpose}</p>
            <ol className="mt-2 space-y-1 text-sm">
              {r.steps.map((s, i) => (
                <li key={s.label}>
                  <Link href={s.href} className="text-primary hover:underline">
                    {i + 1}. {s.label}
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <Button asChild size="xs" variant="outline" className="mt-3">
        <Link href="/help">Open Help &amp; Guide <ArrowRight aria-hidden /></Link>
      </Button>
    </Section>
  );
}
