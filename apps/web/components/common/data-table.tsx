"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ListParams } from "@/hooks/use-list-params";
import type { Page } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, LoadingState } from "./states";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** API sort key; makes the header sortable. */
  sortKey?: string;
  className?: string;
  /** Hidden in the stacked mobile view. */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  query: { isPending: boolean; isError: boolean; error: unknown; data: Page<T> | undefined; refetch: () => unknown; isFetching?: boolean };
  params: ListParams;
  setParams: (patch: Partial<ListParams>, options?: { resetPage?: boolean }) => void;
  rowHref?: (row: T) => string;
  rowKey: (row: T) => string;
  caption: string;
  empty: { title: string; description?: string; action?: ReactNode };
}

/** Server-paginated, sortable table with accessible semantics and a stacked mobile fallback (spec §14.3). */
export function DataTable<T>({ columns, query, params, setParams, rowHref, rowKey, caption, empty }: DataTableProps<T>) {
  if (query.isPending) return <LoadingState rows={6} label={`Loading ${caption}`} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const data = query.data!;
  const filtered = Object.keys(params).some((k) => !["page", "pageSize", "sort", "order"].includes(k) && params[k]);
  if (data.items.length === 0) {
    return filtered ? (
      <EmptyState title="No matching records" description="Try clearing or changing the filters." />
    ) : (
      <EmptyState title={empty.title} description={empty.description} action={empty.action} />
    );
  }

  const sortIcon = (key?: string) => {
    if (!key) return null;
    if (params.sort !== key) return <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />;
    return params.order === "asc" ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />;
  };
  const toggleSort = (key: string) => setParams({ sort: key, order: params.sort === key && params.order === "desc" ? "asc" : "desc" });

  return (
    <div className={cn("space-y-3", query.isFetching && "opacity-80 transition-opacity")}>
      {/* Desktop / tablet */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader className="sticky top-0 bg-card">
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  className={col.className}
                  aria-sort={col.sortKey && params.sort === col.sortKey ? (params.order === "asc" ? "ascending" : "descending") : undefined}
                >
                  {col.sortKey ? (
                    <button type="button" onClick={() => toggleSort(col.sortKey!)} className="inline-flex cursor-pointer items-center gap-1 hover:text-foreground">
                      {col.header}
                      {sortIcon(col.sortKey)}
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.map((row) => (
              <TableRow key={rowKey(row)} className="group">
                {columns.map((col, i) => (
                  <TableCell key={col.id} className={cn("align-top", col.className)}>
                    {i === 0 && rowHref ? (
                      <Link href={rowHref(row)} className="font-medium text-primary underline-offset-4 hover:underline">
                        {col.cell(row)}
                      </Link>
                    ) : (
                      col.cell(row)
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-2 md:hidden" aria-label={caption}>
        {data.items.map((row) => (
          <li key={rowKey(row)} className="rounded-lg border bg-card p-3">
            <dl className="space-y-1.5">
              {columns
                .filter((c) => !c.hideOnMobile)
                .map((col, i) => (
                  <div key={col.id} className="flex items-start justify-between gap-3 text-sm">
                    <dt className="shrink-0 text-xs text-muted-foreground">{col.header}</dt>
                    <dd className="min-w-0 text-right">
                      {i === 0 && rowHref ? (
                        <Link href={rowHref(row)} className="font-medium text-primary">
                          {col.cell(row)}
                        </Link>
                      ) : (
                        col.cell(row)
                      )}
                    </dd>
                  </div>
                ))}
            </dl>
          </li>
        ))}
      </ul>

      <Pagination total={data.total} page={data.page} pageSize={data.pageSize} onPage={(page) => setParams({ page }, { resetPage: false })} />
    </div>
  );
}

function Pagination({ total, page, pageSize, onPage }: { total: number; page: number; pageSize: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between text-sm text-muted-foreground">
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft aria-hidden />
        </Button>
        <span className="px-2">
          Page {page} of {pages}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight aria-hidden />
        </Button>
      </div>
    </nav>
  );
}

export interface FilterDef {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

/** Debounced search plus allowlisted select filters bound to URL params. */
export function FilterBar({ params, setParams, filters = [], searchPlaceholder = "Search…", children }: { params: ListParams; setParams: (patch: Partial<ListParams>) => void; filters?: FilterDef[]; searchPlaceholder?: string; children?: ReactNode }) {
  const [q, setQ] = useState(params.q ?? "");
  // Keep the input in sync when the URL changes externally (e.g. "Clear"), without an effect.
  const [syncedQ, setSyncedQ] = useState(params.q);
  if (syncedQ !== params.q) {
    setSyncedQ(params.q);
    setQ(params.q ?? "");
  }
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.q ?? "") !== q) setParams({ q: q || undefined });
    }, 350);
    return () => clearTimeout(t);
  }, [q, params.q, setParams]);
  const active = filters.some((f) => params[f.key]) || !!params.q;

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative sm:w-72">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} aria-label="Search" className="h-9 pl-8" />
      </div>
      {filters.map((f) => (
        <Select key={f.key} value={(params[f.key] as string) ?? "__all"} onValueChange={(v) => setParams({ [f.key]: v === "__all" ? undefined : v })}>
          <SelectTrigger className="h-9 sm:w-44" aria-label={f.label}>
            <SelectValue placeholder={f.label} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All {f.label.toLowerCase()}</SelectItem>
            {f.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
      {children}
      {active && (
        <Button variant="ghost" size="sm" onClick={() => setParams(Object.fromEntries([["q", undefined], ...filters.map((f) => [f.key, undefined])]))}>
          <X aria-hidden /> Clear
        </Button>
      )}
    </div>
  );
}

export const options = (values: readonly string[]) => values.map((v) => ({ value: v, label: v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) }));
