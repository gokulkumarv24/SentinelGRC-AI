"use client";

import { CircleHelp, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { guideFor } from "@/lib/help-content";

const EVENT = "sentinelgrc:help-seen";
const storageKey = (key: string) => `sentinelgrc:help-seen:${key}`;

function readSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(storageKey(key)) === "1";
  } catch {
    return true; // storage unavailable: do not open the panel on every visit
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

/** Marks every page guide as unseen again (offered on the Help & Guide page). */
export function resetPageHelp() {
  try {
    for (const k of Object.keys(window.localStorage)) if (k.startsWith("sentinelgrc:help-seen:")) window.localStorage.removeItem(k);
  } catch {
    // Storage unavailable: nothing to reset.
  }
  window.dispatchEvent(new Event(EVENT));
}

/**
 * "How this page works": plain-language purpose, steps and tips for the current page.
 * Opens by itself on a person's first visit to a page; afterwards it stays one click away.
 */
export function PageHelp() {
  const pathname = usePathname();
  const found = guideFor(pathname);
  const key = found?.key ?? "";
  const panelId = useId();
  // Server render and first paint assume "seen" (closed), so markup never differs; the browser then reads storage.
  const seen = useSyncExternalStore(subscribe, () => (key ? readSeen(key) : true), () => true);
  const [override, setOverride] = useState<{ key: string; open: boolean } | null>(null);
  if (!found) return null;
  const open = override?.key === key ? override.open : !seen;

  const close = () => {
    try {
      window.localStorage.setItem(storageKey(key), "1");
    } catch {
      // Storage unavailable: close for this visit only.
    }
    window.dispatchEvent(new Event(EVENT));
    setOverride({ key, open: false });
  };

  if (!open) {
    return (
      <Button variant="ghost" size="xs" className="-ml-2 text-muted-foreground" aria-expanded={false} aria-controls={panelId} onClick={() => setOverride({ key, open: true })}>
        <CircleHelp aria-hidden /> How this page works
      </Button>
    );
  }
  const g = found.guide;
  return (
    <section id={panelId} aria-label="How this page works" className="relative rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
      <Button variant="ghost" size="icon-xs" className="absolute top-2 right-2" aria-label="Close the guide for this page" onClick={close}>
        <X />
      </Button>
      <p className="flex items-center gap-1.5 pr-8 font-medium">
        <CircleHelp className="size-4 text-primary" aria-hidden /> How this page works
      </p>
      <p className="mt-1 text-muted-foreground">{g.summary}</p>
      <ol className="mt-3 list-decimal space-y-1 pl-5">
        {g.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {g.tips?.length ? (
        <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
          {g.tips.map((t) => (
            <li key={t}>Tip: {t}</li>
          ))}
        </ul>
      ) : null}
      {g.who && <p className="mt-2 text-xs text-muted-foreground">Who can do this: {g.who} Buttons you don&apos;t see are not part of your role.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="xs" onClick={close}>
          Got it
        </Button>
        <Link href="/help" className="text-xs text-primary hover:underline">
          Open the full Help &amp; Guide
        </Link>
      </div>
    </section>
  );
}
