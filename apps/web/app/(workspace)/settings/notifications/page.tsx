"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHeader, Section } from "@/components/common/page-header";
import { QueryState } from "@/components/common/states";
import { Switch } from "@/components/ui/switch";
import { useApiMutation } from "@/hooks/use-api-mutation";
import { api } from "@/lib/api";

interface Pref {
  eventType: string;
  inApp: boolean;
  email: boolean;
}

export default function NotificationSettings() {
  const query = useQuery({ queryKey: ["notifications", "preferences"], queryFn: () => api.get<Pref[]>("/notifications/preferences") });
  const save = useApiMutation({ mutationFn: (p: Pref) => api.put("/notifications/preferences", p), invalidate: [["notifications", "preferences"]] });
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Notification preferences"
        description="Choose how you hear about events. Email is sent only when an email provider is configured, and never includes evidence contents."
        crumbs={[{ label: "Administration" }, { label: "Notifications" }]}
      />
      <Section title="Your preferences">
        <QueryState query={query}>
          {(prefs) => (
            <table className="w-full text-sm">
              <caption className="sr-only">Notification preferences</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-2 font-medium">Event</th>
                  <th className="py-2 font-medium">In-app</th>
                  <th className="py-2 font-medium">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {prefs.map((p) => (
                  <tr key={p.eventType}>
                    <th scope="row" className="py-2 text-left font-normal">
                      {p.eventType.replace(/[._]/g, " ")}
                    </th>
                    <td className="py-2">
                      <Switch aria-label={`In-app notifications for ${p.eventType}`} checked={p.inApp} onCheckedChange={(v) => save.mutate({ ...p, inApp: v })} />
                    </td>
                    <td className="py-2">
                      <Switch aria-label={`Email notifications for ${p.eventType}`} checked={p.email} onCheckedChange={(v) => save.mutate({ ...p, email: v })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </QueryState>
      </Section>
    </div>
  );
}
