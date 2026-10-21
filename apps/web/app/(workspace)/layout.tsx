import { AppShell } from "@/components/shell/app-shell";

export default function WorkspaceLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
