import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { appConfig } from "@/config/app.config";
import { safeNextPath } from "@/lib/utils";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Start your free trial" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const params = await searchParams;
  // New owners continue to business setup; invited people return to their invitation.
  const next = safeNextPath(params.next, "/onboarding");
  const email = typeof params.email === "string" ? params.email : "";

  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl sm:text-4xl">Start your {appConfig.trial.days}-day free trial</h1>
        <p className="text-sm text-muted-foreground">No card needed. Set up your business in a few minutes.</p>
        <p className="pt-2 text-xs text-muted-foreground">Step 1 of 6: Create your account</p>
      </div>
      <Card>
        <CardContent className="p-6">
          <SignupForm next={next} email={email} />
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
          Sign in
        </Link>
      </p>
    </>
  );
}
