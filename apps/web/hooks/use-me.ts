"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Me, UserRef } from "@/lib/types";

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<Me>("/users/me"), staleTime: 60_000 });
}

/** UI-only permission check for hiding controls. The API enforces every permission itself. */
export function useCan() {
  const { data } = useMe();
  const set = new Set(data?.permissions ?? []);
  return (permission: string) => set.has(permission);
}

export function useActiveOrg() {
  const { data } = useMe();
  return data?.organizations.find((o) => o.id === data.activeOrganizationId) ?? null;
}

/** Active members for owner/assignee pickers. */
export function useDirectory() {
  return useQuery({
    queryKey: ["directory"],
    queryFn: () => api.get<Array<UserRef & { roles: string[] }>>("/members/directory"),
    staleTime: 5 * 60_000,
  });
}
