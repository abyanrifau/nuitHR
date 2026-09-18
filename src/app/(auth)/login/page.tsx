import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { safeNextPath } from "@/lib/utils";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

const notices: Record<string, { tone: "success" | "info"; text: string }> = {
  "signed-out": { tone: "info", text: "You've been signed out." },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const notice = typeof params.notice === "string" ? notices[params.notice] : undefined;
  const linkError = params.error === "link";

  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl sm:text-4xl">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to your workspace.</p>
      </div>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
      {linkError && (
        <Alert tone="warning" title="That link didn't work">
          It may have expired, already been used, or been opened in a different browser. If you were confirming your email, it&apos;s probably
          confirmed already, so just sign in below. Otherwise, request a new link.
        </Alert>
      )}

      <Card>
        <CardContent className="p-6">
          <LoginForm next={next} />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        New here?{" "}
        <Link href="/signup" className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
          Start your free trial
        </Link>
      </p>
    </>
  );
}
