"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface PickerOption {
  id: string;
  label: string;
  sublabel?: string;
}

/** Searchable combobox over any paginated list endpoint (server-side search, org-scoped by the API). */
export function RecordPicker<T>({
  id,
  endpoint,
  toOption,
  value,
  onChange,
  placeholder = "Select…",
  extraQuery,
  disabled,
}: {
  id?: string;
  endpoint: string;
  toOption: (row: T) => PickerOption;
  value: PickerOption | null;
  onChange: (option: PickerOption | null) => void;
  placeholder?: string;
  extraQuery?: Record<string, string>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 250);
    return () => clearTimeout(t);
  }, [term]);
  const query = useQuery({
    queryKey: [endpoint, "picker", debounced, extraQuery],
    queryFn: () => api.get<Page<T>>(endpoint, { q: debounced || undefined, pageSize: 20, ...extraQuery }),
    enabled: open,
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal" disabled={disabled}>
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value?.label ?? placeholder}</span>
          <ChevronsUpDown className="opacity-50" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search…" value={term} onValueChange={setTerm} />
          <CommandList>
            {query.isPending ? <p className="p-3 text-sm text-muted-foreground">Loading…</p> : <CommandEmpty>No matches.</CommandEmpty>}
            <CommandGroup>
              {query.data?.items.map((row) => {
                const opt = toOption(row);
                return (
                  <CommandItem
                    key={opt.id}
                    value={opt.id}
                    onSelect={() => {
                      onChange(opt.id === value?.id ? null : opt);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("size-4", opt.id === value?.id ? "opacity-100" : "opacity-0")} aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate">{opt.label}</p>
                      {opt.sublabel && <p className="truncate text-xs text-muted-foreground">{opt.sublabel}</p>}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export const controlOption = (c: { id: string; controlCode: string; title: string; category?: string }): PickerOption => ({ id: c.id, label: `${c.controlCode} · ${c.title}`, sublabel: c.category });
export const riskOption = (r: { id: string; riskKey: string; title: string }): PickerOption => ({ id: r.id, label: `${r.riskKey} · ${r.title}` });
export const evidenceOption = (e: { id: string; title: string; originalFilename: string | null; state?: string }): PickerOption => ({ id: e.id, label: e.title, sublabel: [e.originalFilename, e.state].filter(Boolean).join(" · ") });
export const findingOption = (f: { id: string; findingKey: string; title: string }): PickerOption => ({ id: f.id, label: `${f.findingKey} · ${f.title}` });
