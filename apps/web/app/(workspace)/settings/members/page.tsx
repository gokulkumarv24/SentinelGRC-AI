"use client";

import { useQuery } from "@tanstack/react-query";
import { Copy, UserPlus } from "lucide-react";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/common/badges";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DataTable, FilterBar, options, type Column } from "@/components/common/data-table";
import { DateText } from "@/components/common/date-text";
import { PageHeader, Section } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { useListParams } from "@/hooks/use-list-params";
import { useCan, useMe } from "@/hooks/use-me";
import { api } from "@/lib/api";
import type { Member, Page, RoleInfo } from "@/lib/types";

function RoleChecklist({ roles, value, onChange }: { roles: RoleInfo[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">Roles</legend>
      {roles.map((r) => (
        <label key={r.key} className="flex cursor-pointer items-start gap-2 rounded-md border p-2 hover:bg-muted/50">
          <Checkbox checked={value.includes(r.key)} onCheckedChange={(c) => onChange(c ? [...value, r.key] : value.filter((k) => k !== r.key))} className="mt-0.5" />
          <span>
            <span className="text-sm font-medium">{r.name}</span>
            <span className="block text-xs text-muted-foreground">{r.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function InviteDialog({ roles }: { roles: RoleInfo[] }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const invite = useApiMutation({
    mutationFn: () => api.post<{ acceptUrl: string; expiresAt: string }>("/members/invitations", { email, roles: selected }),
    success: "Invitation created",
    invalidate: [["members"]],
    onSuccess: (r) => setLink(r.acceptUrl),
  });
  const reset = () => {
    setEmail("");
    setSelected([]);
    setLink(null);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden /> Invite member
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite a member</DialogTitle>
          <DialogDescription>Invitation links expire after 72 hours and can be used once. Only the hash of the token is stored.</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-2">
            <p className="text-sm">Share this one-time link securely with {email}. It will not be shown again.</p>
            <div className="flex gap-2">
              <Input readOnly value={link} aria-label="Invitation link" />
              <Button
                variant="outline"
                aria-label="Copy link"
                onClick={async () => {
                  await navigator.clipboard.writeText(link);
                  toast.success("Copied");
                }}
              >
                <Copy aria-hidden />
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email</Label>
              <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <RoleChecklist roles={roles} value={selected} onChange={setSelected} />
          </div>
        )}
        <DialogFooter>
          {link ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button onClick={() => invite.mutate()} disabled={!email || !selected.length || invite.isPending}>
              {invite.isPending ? "Inviting…" : "Create invitation"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditRoles({ member, roles }: { member: Member; roles: RoleInfo[] }) {
  const [selected, setSelected] = useState(member.roles);
  const mutation = useApiMutation({ mutationFn: (rationale: string) => api.patch(`/members/${member.id}/roles`, { roles: selected, rationale }), success: "Roles updated", invalidate: [["members"]] });
  return (
    <ConfirmDialog trigger={<Button size="xs" variant="outline">Roles</Button>} title={`Roles for ${member.user.displayName}`} description="Role changes are audited. You cannot change your own roles." requireRationale confirmLabel="Save roles" onConfirm={(r) => mutation.mutateAsync(r)}>
      <RoleChecklist roles={roles} value={selected} onChange={setSelected} />
    </ConfirmDialog>
  );
}

function Members() {
  const can = useCan();
  const { data: me } = useMe();
  const [params, setParams] = useListParams({ sort: "joinedAt", order: "desc" });
  const query = useQuery({ queryKey: ["members", params], queryFn: () => api.get<Page<Member>>("/members", params) });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api.get<RoleInfo[]>("/roles") });
  const invitations = useQuery({ queryKey: ["members", "invitations"], queryFn: () => api.get<Array<{ id: string; normalizedEmail: string; roleKeys: string[]; expiresAt: string }>>("/members/invitations"), enabled: can("member.manage") });
  const setStatus = useApiMutation({ mutationFn: (v: { id: string; status: string; rationale: string }) => api.patch(`/members/${v.id}/status`, { status: v.status, rationale: v.rationale }), success: "Membership updated", invalidate: [["members"]] });
  const revoke = useApiMutation({ mutationFn: (id: string) => api.delete(`/members/invitations/${id}`), success: "Invitation revoked", invalidate: [["members"]] });

  const columns: Column<Member>[] = [
    { id: "name", header: "Member", sortKey: "displayName", cell: (m) => <span><span className="font-medium">{m.user.displayName}</span><span className="block text-xs text-muted-foreground">{m.user.email}</span></span> },
    { id: "roles", header: "Roles", cell: (m) => <span className="text-xs">{m.roles.map((r) => roles.data?.find((x) => x.key === r)?.name ?? r).join(", ") || "—"}</span> },
    { id: "status", header: "Status", cell: (m) => <StatusBadge status={m.status} /> },
    { id: "last", header: "Last sign-in", cell: (m) => <DateText value={m.user.lastLoginAt} relative />, hideOnMobile: true },
    {
      id: "actions",
      header: "Actions",
      cell: (m) =>
        m.user.id === me?.user.id ? (
          <span className="text-xs text-muted-foreground">You</span>
        ) : (
          <div className="flex gap-1">
            {can("role.assign") && roles.data && <EditRoles member={m} roles={roles.data} />}
            {can("member.manage") &&
              (m.status === "active" ? (
                <ConfirmDialog trigger={<Button size="xs" variant="outline">Suspend</Button>} title={`Suspend ${m.user.displayName}?`} description="Suspension takes effect immediately for all their sessions in this organization." requireRationale destructive confirmLabel="Suspend" onConfirm={(r) => setStatus.mutateAsync({ id: m.id, status: "suspended", rationale: r })} />
              ) : (
                <ConfirmDialog trigger={<Button size="xs" variant="outline">Reactivate</Button>} title={`Reactivate ${m.user.displayName}?`} requireRationale confirmLabel="Reactivate" onConfirm={(r) => setStatus.mutateAsync({ id: m.id, status: "active", rationale: r })} />
              ))}
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader title="Members and roles" description="Organization-scoped role-based access. Permissions are enforced by the API on every request." crumbs={[{ label: "Administration" }, { label: "Members and roles" }]} actions={can("member.manage") && roles.data && <InviteDialog roles={roles.data} />} />
      <FilterBar params={params} setParams={setParams} searchPlaceholder="Search name or email" filters={[{ key: "status", label: "Status", options: options(["active", "suspended", "removed"]) }]} />
      <DataTable caption="Members" columns={columns} query={query} params={params} setParams={setParams} rowKey={(m) => m.id} empty={{ title: "No members" }} />
      {can("member.manage") && (invitations.data?.length ?? 0) > 0 && (
        <div className="mt-6">
          <Section title="Pending invitations">
            <ul className="divide-y">
              {invitations.data!.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    {i.normalizedEmail} · <span className="text-xs text-muted-foreground">{i.roleKeys.join(", ")} · expires <DateText value={i.expiresAt} withTime /></span>
                  </span>
                  <Button size="xs" variant="outline" onClick={() => revoke.mutate(i.id)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      )}
      {roles.data && (
        <div className="mt-6">
          <Section title="Permission matrix" description="What each role can do.">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <caption className="sr-only">Role permissions</caption>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1.5 pr-3 font-medium">Role</th>
                    <th className="py-1.5 font-medium">Permissions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {roles.data.map((r) => (
                    <tr key={r.key} className="align-top">
                      <th scope="row" className="py-2 pr-3 text-left font-medium whitespace-nowrap">
                        {r.name}
                      </th>
                      <td className="py-2 font-mono text-[11px] text-muted-foreground">{r.permissions.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Members />
    </Suspense>
  );
}
