import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl sm:text-4xl">Forgot your password?</h1>
        <p className="text-sm text-muted-foreground">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      </div>
      <Card>
        <CardContent className="p-6">
          <ForgotPasswordForm />
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
