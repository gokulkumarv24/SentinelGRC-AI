import { z } from 'zod';

/**
 * One pagination style for the whole API (spec §13.2): page/pageSize offsets.
 * Sorting and filtering use explicit allowlists — never raw column names from the client.
 */
export function listQuery<const S extends readonly [string, ...string[]], F extends z.ZodRawShape>(
  sortable: S,
  filters: F,
  defaultSort: S[number] = sortable[0],
) {
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.enum(sortable).default(defaultSort as S[number]),
    order: z.enum(['asc', 'desc']).default('desc'),
    q: z.string().trim().max(200).optional(),
    ...filters,
  });
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageArgs(query: { page: number; pageSize: number; sort: string; order: 'asc' | 'desc' }) {
  return {
    skip: (query.page - 1) * query.pageSize,
    take: query.pageSize,
    orderBy: { [query.sort]: query.order },
  };
}

export function toPage<T>(items: T[], total: number, query: { page: number; pageSize: number }): Page<T> {
  return { items, total, page: query.page, pageSize: query.pageSize };
}

/** Comma-separated multi-value filter, e.g. `status=open,triaged`, restricted to allowed values. */
export const multi = <const V extends readonly [string, ...string[]]>(values: V) =>
  z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.enum(values)))
    .optional();
