"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, Plus } from "lucide-react";
import { useState } from "react";
import { StatusBadge } from "@/components/common/badges";
import { DateText } from "@/components/common/date-text";
import { PageHeader, Section } from "@/components/common/page-header";
import { ForbiddenState, QueryState } from "@/components/common/states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  isDemo: boolean;
  createdAt: string;
  _count: { memberships: number };
}
interface Created {
  organization: { id: string; name: string };
  adminInviteUrl: string;
}

const TIMEZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

function CreateOrganization() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", slug: "", industry: "", timezone: "UTC", adminEmail: "" });
  const [slugEdited, setSlugEdited] = useState(false);
  const [created, setCreated] = useState<Created | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useApiMutation({
    mutationFn: () => api.post<Created>("/organizations", { ...form, industry: form.industry || undefined }),
    success: "Organization created",
    invalidate: [["platform", "organizations"]],
    onSuccess: (c) => setCreated(c),
  });
  const close = (o: boolean) => {
    setOpen(o);
    if (!o) {
      setCreated(null);
      setCopied(false);
      setForm({ name: "", slug: "", industry: "", timezone: "UTC", adminEmail: "" });
      setSlugEdited(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created!.adminInviteUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild>
        <Button><Plus /> New organization</Button>
      </DialogTrigger>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Invite the first administrator</DialogTitle>
              <DialogDescription>
                {created.organization.name} was created with default roles, workflows and settings. Send this one-time link to its first administrator over a secure channel. It is shown only now and expires in 72 hours.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="invite-url">Invitation link</Label>
              <div className="flex gap-2">
                <Input id="invite-url" readOnly value={created.adminInviteUrl} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
                <Button type="button" variant="outline" onClick={copy} aria-label="Copy invitation link"><Copy /></Button>
              </div>
              <p className="text-xs text-muted-foreground" aria-live="polite">{copied ? "Copied." : "Anyone with this link can join as the organization administrator until it is used or expires."}</p>
            </div>
            <DialogFooter><Button onClick={() => close(false)}>Done</Button></DialogFooter>
          </>
        ) : (
          <form method="post" onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3">
            <DialogHeader>
              <DialogTitle>New organization</DialogTitle>
              <DialogDescription>Each organization is an isolated tenant. Its first administrator is invited by email address; no default password is ever created.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Name</Label>
              <Input id="org-name" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value, slug: slugEdited ? form.slug : slugify(e.target.value) })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-slug">Short name (URL-safe)</Label>
              <Input id="org-slug" required pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]" title="3–50 lowercase letters, digits or hyphens" value={form.slug} onChange={(e) => { setSlugEdited(true); setForm({ ...form, slug: e.target.value }); }} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="org-industry">Industry (optional)</Label>
                <Input id="org-industry" maxLength={120} value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="org-tz">Time zone</Label>
                <Input id="org-tz" list="org-tz-list" required value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
                <datalist id="org-tz-list">{TIMEZONES.map((t) => <option key={t} value={t} />)}</datalist>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="org-admin">First administrator’s email</Label>
              <Input id="org-admin" type="email" required maxLength={320} value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} />
            </div>
            <DialogFooter><Button type="submit" disabled={create.isPending}>{create.isPending ? "Creating…" : "Create organization"}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PlatformOrganizationsPage() {
  const me = useMe();
  const isAdmin = !!me.data?.user.isPlatformAdmin;
  const query = useQuery({ queryKey: ["platform", "organizations"], queryFn: () => api.get<OrgRow[]>("/organizations"), enabled: isAdmin });
  if (!isAdmin) return <ForbiddenState message="Only platform administrators can manage organizations." />;
  return (
    <>
      <PageHeader title="Organizations" description="Tenants on this SentinelGRC deployment. Platform administrators create organizations; each organization manages its own members and data." crumbs={[{ label: "Platform" }, { label: "Organizations" }]} actions={<CreateOrganization />} />
      <Section title="All organizations">
        <QueryState query={query}>
          {(rows) =>
            rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No organizations yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">Organizations</caption>
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Organization</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Members</th>
                      <th className="py-2 font-medium">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((o) => (
                      <tr key={o.id}>
                        <td className="py-2 pr-3">
                          {o.name}
                          <span className="block font-mono text-xs text-muted-foreground">{o.slug}{o.isDemo && " · demo data"}</span>
                        </td>
                        <td className="py-2 pr-3"><StatusBadge status={o.status} /></td>
                        <td className="py-2 pr-3 tabular-nums">{o._count.memberships}</td>
                        <td className="py-2"><DateText value={o.createdAt} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </QueryState>
      </Section>
    </>
  );
}
