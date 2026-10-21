"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

export interface ListParams {
  page: number;
  pageSize: number;
  sort?: string;
  order?: "asc" | "desc";
  q?: string;
  [filter: string]: string | number | undefined;
}

/** List state (pagination, sort, search, filters) lives in the URL so views are shareable and survive reloads. */
export function useListParams(defaults: Partial<ListParams> = {}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const params = useMemo<ListParams>(() => {
    const result: ListParams = { page: 1, pageSize: 25, ...defaults } as ListParams;
    searchParams.forEach((value, key) => {
      result[key] = key === "page" || key === "pageSize" ? Number(value) || result[key] : value;
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setParams = useCallback(
    (patch: Partial<ListParams>, options: { resetPage?: boolean } = { resetPage: true }) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === "" || value === null) next.delete(key);
        else next.set(key, String(value));
      }
      if (options.resetPage && !("page" in patch)) next.delete("page");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return [params, setParams] as const;
}
