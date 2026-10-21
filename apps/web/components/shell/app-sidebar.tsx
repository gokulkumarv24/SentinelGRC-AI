"use client";

import { ShieldHalf } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useActiveOrg, useCan } from "@/hooks/use-me";
import { NAVIGATION } from "@/lib/navigation";

/** Only links the member may use are shown; the API still authorizes every request. */
export function AppSidebar() {
  const pathname = usePathname();
  const can = useCan();
  const org = useActiveOrg();
  const allHrefs = NAVIGATION.flatMap((s) => s.items.map((i) => i.href));
  // Longest matching prefix wins, so /risks/acceptance does not also highlight /risks.
  const activeHref = allHrefs.filter((h) => pathname === h || pathname.startsWith(`${h}/`)).sort((a, b) => b.length - a.length)[0];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip="SentinelGRC AI">
              <Link href="/dashboard">
                <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <ShieldHalf className="size-4" aria-hidden />
                </span>
                <span className="grid text-left leading-tight">
                  <span className="truncate font-semibold">SentinelGRC AI</span>
                  <span className="truncate text-xs text-muted-foreground">{org?.name ?? "No organization"}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAVIGATION.map((section) => {
          const items = section.items.filter((i) => can(i.permission));
          if (!items.length) return null;
          return (
            <SidebarGroup key={section.title}>
              <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={item.href === activeHref} tooltip={item.title}>
                        <Link href={item.href} aria-current={item.href === activeHref ? "page" : undefined}>
                          <item.icon aria-hidden />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        {org?.isDemo && (
          <p className="rounded-md border border-dashed px-2 py-1.5 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            Demo organization — all data is fictional.
          </p>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
