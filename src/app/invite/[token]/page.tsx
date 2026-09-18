import type { Metadata } from "next";
import Link from "next/link";
import { MailOpen } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/auth/session";
import { isSupabaseConfigured } from "@/lib/env";
import { AcceptButton } from "./accept-button";

export const metadata: Metadata = { title: "You're invited", robots: { index: false } };

interface Preview {
  business_name: string;
  role_name: string;
  email: string;
  status: "valid" | "revoked" | "accepted" | "expired";
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const user = await getSessionUser();
  let preview: Preview | null = null;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_invitation_preview", { p_token: token });
    preview = data as Preview | null;
  }
  const next = encodeURIComponent(`/invite/${token}`);
  const wrongUser = user && preview && user.email?.toLowerCase() !== preview.email.toLowerCase();

  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-10">
      <Logo />
      <Card className="mt-8 w-full max-w-md">
        <CardContent className="space-y-5 p-6">
          <div className="flex size-12 items-center justify-center rounded-lg border border-border text-foreground">
            <MailOpen className="size-6" aria-hidden />
          </div>
          {!preview ? (
            <Alert tone="danger" title="This invitation link isn't valid">
              Check that you copied the whole link, or ask for a new invitation.
            </Alert>
          ) : preview.status !== "valid" && preview.status !== "accepted" ? (
            <Alert tone="warning" title={preview.status === "expired" ? "This invitation has expired" : "This invitation was cancelled"}>
              Ask {preview.business_name} to send you a new one.
            </Alert>
          ) : (
            <>
              <div className="space-y-1">
                <h1 className="text-xl">Join {preview.business_name}</h1>
                <p className="text-sm text-muted-foreground">
                  You&apos;ve been invited as <span className="text-foreground">{preview.role_name}</span>. The invitation is for{" "}
                  <span className="text-foreground">{preview.email}</span>.
                </p>
              </div>
              {!user ? (
                <div className="space-y-2">
                  <Link
                    href={`/signup?next=${next}&email=${encodeURIComponent(preview.email)}`}
                    className={buttonClasses({ size: "lg", className: "w-full" })}
                  >
                    Create your account
                  </Link>
                  <Link href={`/login?next=${next}`} className={buttonClasses({ variant: "secondary", size: "lg", className: "w-full" })}>
                    I already have an account
                  </Link>
                </div>
              ) : wrongUser ? (
                <Alert tone="warning" title="You're signed in with a different email">
                  You&apos;re signed in as {user.email}. Sign out, then sign in or create an account with {preview.email}.
                </Alert>
              ) : (
                <AcceptButton token={token} />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
