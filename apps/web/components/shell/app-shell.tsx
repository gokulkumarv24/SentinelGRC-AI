"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/common/states";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useMe } from "@/hooks/use-me";
import { AppSidebar } from "./app-sidebar";
import { TopBar } from "./top-bar";

export function AppShell({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const mustChange = me.data?.user.mustChangePassword;

  useEffect(() => {
    if (mustChange && pathname !== "/account/password") router.replace("/account/password?required=1");
  }, [mustChange, pathname, router]);

  if (me.isPending) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <LoadingState rows={4} label="Loading workspace" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <ErrorState error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-background focus:px-3 focus:py-2">
        Skip to content
      </a>
      <AppSidebar />
      <SidebarInset>
        <TopBar />
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6">
          {!me.data.activeOrganizationId && pathname !== "/account/password" ? (
            <EmptyState title="No organization" description="Your account is not an active member of any organization. Ask an administrator for an invitation." />
          ) : (
            children
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
