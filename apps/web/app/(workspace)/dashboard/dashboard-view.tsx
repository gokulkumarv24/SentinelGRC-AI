"use client";

import { PageHeader } from "@/components/common/page-header";
import { useActiveOrg } from "@/hooks/use-me";

/** Replaced by the full executive dashboard in Milestone 4 (spec §7). */
export function DashboardView() {
  const org = useActiveOrg();
  return <PageHeader title="Dashboard" description={org ? `Governance overview for ${org.name}` : undefined} />;
}
