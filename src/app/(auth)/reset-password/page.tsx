import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // The reset email link signs the user in first, then brings them here.
  await requireUser("/reset-password");
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl sm:text-4xl">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">You&apos;ll use it the next time you sign in.</p>
      </div>
      <Card>
        <CardContent className="p-6">
          <ResetPasswordForm />
        </CardContent>
      </Card>
    </>
  );
}
