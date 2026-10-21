"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Building2, Check, ChevronsUpDown, CircleHelp, KeyRound, LogOut, Monitor, Moon, Search, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { DateText } from "@/components/common/date-text";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useMe } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import type { Notification, Page } from "@/lib/types";
import { GlobalSearch, useSearchShortcut } from "./global-search";

const ENTITY_ROUTES: Record<string, string> = {
  risk: "/risks",
  finding: "/findings",
  remediation_task: "/remediation",
  control: "/controls",
  evidence: "/evidence",
  vendor: "/vendors",
  vendor_assessment: "/vendors/assessments",
  ai_system: "/ai-governance",
  ai_assessment: "/ai-governance/assessments",
  workflow_run: "/workflows/runs",
  report: "/reports",
};

export function entityHref(type: string | null, id: string | null): string | null {
  if (!type || !id || !ENTITY_ROUTES[type]) return null;
  return `${ENTITY_ROUTES[type]}/${id}`;
}

export function TopBar() {
  const [searchOpen, setSearchOpen] = useSearchShortcut();
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/80">
      <SidebarTrigger aria-label="Toggle navigation" />
      <Separator orientation="vertical" className="h-5" />
      <OrganizationSwitcher />
      <div className="flex-1" />
      <Button variant="outline" size="sm" className="hidden w-56 justify-start text-muted-foreground sm:flex" onClick={() => setSearchOpen(true)}>
        <Search aria-hidden /> Search…
        <kbd className="ml-auto rounded border px-1 font-mono text-[10px]">Ctrl K</kbd>
      </Button>
      <Button variant="ghost" size="icon" className="sm:hidden" aria-label="Search" onClick={() => setSearchOpen(true)}>
        <Search aria-hidden />
      </Button>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <NotificationCenter />
      <Button variant="ghost" size="icon" asChild aria-label="Help">
        <Link href="/help">
          <CircleHelp aria-hidden />
        </Link>
      </Button>
      <ProfileMenu />
    </header>
  );
}

function OrganizationSwitcher() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  const switchOrg = useMutation({
    mutationFn: (organizationId: string) => api.post("/auth/switch-organization", { organizationId }),
    onSuccess: async () => {
      await qc.resetQueries();
      router.push("/dashboard");
      toast.success("Organization switched");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (!me) return null;
  const active = me.organizations.find((o) => o.id === me.activeOrganizationId);
  if (me.organizations.length <= 1) {
    return <span className="truncate text-sm font-medium">{active?.name ?? "No organization"}</span>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-60 gap-2">
          <Building2 aria-hidden />
          {/* The accessible name contains the visible text (WCAG 2.5.3 Label in Name). */}
          <span className="sr-only">Switch organization: </span>
          <span className="truncate">{active?.name ?? "Select organization"}</span>
          <ChevronsUpDown className="opacity-50" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {me.organizations.map((o) => (
          <DropdownMenuItem key={o.id} onSelect={() => o.id !== me.activeOrganizationId && switchOrg.mutate(o.id)}>
            <span className="truncate">{o.name}</span>
            {o.isDemo && <span className="text-xs text-muted-foreground">demo</span>}
            {o.id === me.activeOrganizationId && <Check className="ml-auto" aria-label="Current" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationCenter() {
  const qc = useQueryClient();
  const router = useRouter();
  const query = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => api.get<Page<Notification> & { unread: number }>("/notifications", { pageSize: 10 }),
    refetchInterval: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const readAll = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const unread = query.data?.unread ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
          <Bell aria-hidden />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-semibold">Notifications</p>
          <Button variant="ghost" size="xs" disabled={!unread || readAll.isPending} onClick={() => readAll.mutate()}>
            Mark all read
          </Button>
        </div>
        <ul className="max-h-96 overflow-y-auto">
          {query.isPending && <li className="p-4 text-sm text-muted-foreground">Loading…</li>}
          {query.isError && <li className="p-4 text-sm text-destructive">Could not load notifications.</li>}
          {query.data?.items.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</li>}
          {query.data?.items.map((n) => {
            const href = entityHref(n.entityType, n.entityId);
            return (
              <li key={n.id} className="border-b last:border-0">
                <button
                  type="button"
                  className="w-full cursor-pointer px-3 py-2.5 text-left hover:bg-muted"
                  onClick={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                    if (href) router.push(href);
                  }}
                >
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {!n.readAt && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                    <span className="truncate">{n.title}</span>
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    <DateText value={n.createdAt} relative />
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="border-t p-2 text-center">
          <Link href="/settings/notifications" className="text-xs text-primary hover:underline">
            Notification settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ProfileMenu() {
  const { data: me } = useMe();
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSettled: () => {
      qc.clear();
      // Full reload on purpose: discards every cached record of the previous session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/login");
    },
  });
  const initials = (me?.user.displayName ?? "?").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* The name starts with the visible initials (WCAG 2.5.3 Label in Name). */}
        <Button variant="ghost" size="icon" aria-label={`${initials}, account menu for ${me?.user.displayName ?? "your account"}`} className="rounded-full">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <p className="truncate font-medium">{me?.user.displayName}</p>
          <p className="truncate text-xs font-normal text-muted-foreground">{me?.user.email}</p>
          {me?.roles.length ? <p className="mt-1 text-xs font-normal text-muted-foreground">{me.roles.map((r) => r.replace(/_/g, " ")).join(", ")}</p> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account/password">
            <KeyRound aria-hidden /> Change password
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden /> Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden /> Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden /> System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
