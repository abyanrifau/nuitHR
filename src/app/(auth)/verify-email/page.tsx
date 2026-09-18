import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { ResendForm } from "./resend-form";

export const metadata: Metadata = { title: "Check your email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email : "";
  const magic = params.method === "magic";

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="flex size-12 items-center justify-center rounded-lg border border-border text-foreground">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <div className="space-y-2">
          <h1 className="text-2xl">Check your email</h1>
          <p className="text-sm text-muted-foreground">
            We&apos;ve sent {magic ? "a sign-in link" : "a confirmation link"} to <span className="text-foreground">{email || "your inbox"}</span>.
            Open it on this device to {magic ? "sign in" : "confirm your email and continue"}.
          </p>
        </div>
        <ul className="space-y-1 text-left text-sm text-muted-foreground">
          <li>• It can take a minute or two to arrive.</li>
          <li>• Check your spam or promotions folder.</li>
          <li>• The link works once and expires after a while.</li>
        </ul>
        {!magic && email && <ResendForm email={email} />}
        <p className="text-sm text-muted-foreground">
          Wrong email?{" "}
          <Link href="/signup" className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
            Start again
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
