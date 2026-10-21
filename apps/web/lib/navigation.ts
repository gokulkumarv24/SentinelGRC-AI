import {
  Activity,
  BadgeCheck,
  Bot,
  Building2,
  ClipboardCheck,
  ClipboardList,
  FileArchive,
  FileBarChart,
  FileCheck2,
  FlaskConical,
  GitBranch,
  GitCompareArrows,
  Handshake,
  LayoutDashboard,
  Library,
  ListChecks,
  type LucideIcon,
  Plug,
  ScrollText,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Users,
  Wrench,
  Bell,
  History,
  Network,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  permission: string;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Sidebar structure from spec §14.2. Items are hidden unless the member holds the permission. */
export const NAVIGATION: NavSection[] = [
  { title: "Overview", items: [{ title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, permission: "dashboard.read" }] },
  {
    title: "Compliance",
    items: [
      { title: "Frameworks", href: "/compliance/frameworks", icon: Library, permission: "framework.read" },
      { title: "Controls", href: "/controls", icon: ShieldCheck, permission: "control.read" },
      { title: "Control Tests", href: "/compliance/control-tests", icon: FlaskConical, permission: "control_test.read" },
      { title: "Evidence", href: "/evidence", icon: FileArchive, permission: "evidence.read" },
      { title: "Mappings", href: "/compliance/mappings", icon: GitCompareArrows, permission: "mapping.read" },
    ],
  },
  {
    title: "Risk Management",
    items: [
      { title: "Risk Register", href: "/risks", icon: ShieldAlert, permission: "risk.read" },
      { title: "Findings", href: "/findings", icon: ListChecks, permission: "finding.read" },
      { title: "Remediation", href: "/remediation", icon: Wrench, permission: "remediation.read" },
      { title: "Risk Acceptance", href: "/risks/acceptance", icon: BadgeCheck, permission: "risk.read" },
    ],
  },
  {
    title: "Third-Party Risk",
    items: [
      { title: "Vendors", href: "/vendors", icon: Handshake, permission: "vendor.read" },
      { title: "Assessments", href: "/vendors/assessments", icon: ClipboardCheck, permission: "vendor_assessment.read" },
      { title: "Questionnaires", href: "/vendors/questionnaires", icon: ClipboardList, permission: "vendor_assessment.read" },
    ],
  },
  {
    title: "AI Governance",
    items: [
      { title: "AI Inventory", href: "/ai-governance", icon: Bot, permission: "ai_system.read" },
      { title: "Assessments", href: "/ai-governance/assessments", icon: FileCheck2, permission: "ai_system.read" },
      { title: "Evaluations", href: "/ai-governance/evaluations", icon: Activity, permission: "ai_system.read" },
      { title: "Incidents", href: "/ai-governance/incidents", icon: Siren, permission: "ai_system.read" },
      { title: "Change Reviews", href: "/ai-governance/changes", icon: GitBranch, permission: "ai_system.read" },
    ],
  },
  {
    title: "Automation",
    items: [
      { title: "Workflows", href: "/workflows", icon: Network, permission: "workflow.read" },
      { title: "Runs and Failures", href: "/workflows/runs", icon: History, permission: "workflow.read" },
      { title: "Integrations", href: "/integrations", icon: Plug, permission: "integration.read" },
    ],
  },
  {
    title: "Reporting",
    items: [
      { title: "Reports", href: "/reports", icon: FileBarChart, permission: "report.read" },
      { title: "Audit Log", href: "/audit-log", icon: ScrollText, permission: "audit.read" },
    ],
  },
  {
    title: "Administration",
    items: [
      { title: "Members and Roles", href: "/settings/members", icon: Users, permission: "member.read" },
      { title: "Organization Settings", href: "/settings/organization", icon: Building2, permission: "org.read" },
      { title: "Risk Policies", href: "/settings/risk-policies", icon: SlidersHorizontal, permission: "risk.read" },
      { title: "Framework Settings", href: "/settings/frameworks", icon: Settings2, permission: "framework.read" },
      { title: "Notifications", href: "/settings/notifications", icon: Bell, permission: "dashboard.read" },
    ],
  },
];
