import { ShieldHalf } from "lucide-react";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <ShieldHalf className="size-5" aria-hidden />
        </span>
        <span className="text-lg font-semibold">SentinelGRC AI</span>
      </div>
      <main className="w-full max-w-sm">{children}</main>
      <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground">
        SentinelGRC AI supports governance workflows. It does not by itself certify, attest or establish legal compliance.
      </p>
    </div>
  );
}
