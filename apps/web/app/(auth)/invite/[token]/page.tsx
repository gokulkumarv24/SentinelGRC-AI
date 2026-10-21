import type { Metadata } from "next";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  return <InviteForm token={token} />;
}
