"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";

export interface SearchHit {
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

const GROUP_LABELS: Record<string, string> = {
  control: "Controls",
  risk: "Risks",
  finding: "Findings",
  remediation_task: "Remediation tasks",
  vendor: "Vendors",
  ai_system: "AI systems",
  evidence: "Evidence (metadata)",
};

export function useSearchShortcut() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return [open, setOpen] as const;
}

/** Searches only records the member may read; results come from the permission-aware /search endpoint. */
export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  const query = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<{ results: SearchHit[] }>("/search", { q: debounced }),
    enabled: open && debounced.length >= 2,
  });
  const groups = new Map<string, SearchHit[]>();
  for (const hit of query.data?.results ?? []) groups.set(hit.type, [...(groups.get(hit.type) ?? []), hit]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search controls, risks, findings, vendors, AI systems and evidence</DialogDescription>
        <Command shouldFilter={false}>
      <CommandInput placeholder="Search records…" value={term} onValueChange={setTerm} />
      <CommandList>
        {debounced.length < 2 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Type at least two characters.</p>
        ) : query.isPending ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Searching…</p>
        ) : query.isError ? (
          <p className="p-4 text-center text-sm text-destructive">Search failed.</p>
        ) : (
          <CommandEmpty>No results.</CommandEmpty>
        )}
        {[...groups].map(([type, hits]) => (
          <CommandGroup key={type} heading={GROUP_LABELS[type] ?? type}>
            {hits.map((hit) => (
              <CommandItem
                key={`${hit.type}-${hit.id}`}
                value={`${hit.type}-${hit.id}`}
                onSelect={() => {
                  onOpenChange(false);
                  router.push(hit.href);
                }}
              >
                <div className="min-w-0">
                  <p className="truncate">{hit.title}</p>
                  {hit.subtitle && <p className="truncate text-xs text-muted-foreground">{hit.subtitle}</p>}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
