import Image from "next/image";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-10">
      <Image src="/brand/logo.png" alt="SentinelGRC AI" width={120} height={120} priority className="mb-6" />
      <main className="w-full max-w-sm">{children}</main>
      <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground">
        SentinelGRC AI supports governance workflows. It does not by itself certify, attest or establish legal compliance.
      </p>
    </div>
  );
}
