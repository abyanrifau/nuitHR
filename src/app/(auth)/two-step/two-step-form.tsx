"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

export function TwoStepForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6 digits from your app.");
    setBusy(true);
    const supabase = createClient();
    const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp.find((f) => f.status === "verified");
    if (listErr || !factor) {
      setBusy(false);
      return setError("We couldn't find your authenticator. Sign out and sign in again.");
    }
    const { error: verifyErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
    if (verifyErr) {
      setBusy(false);
      return setError("That code didn't work. Codes change every 30 seconds, so try the newest one.");
    }
    // Full page load so the server sees the upgraded session.
    window.location.assign(next);
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Code" htmlFor="code">
        <Input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          className="text-center text-lg tracking-[0.4em] tabular"
        />
      </Field>
      <Button type="submit" className="w-full" loading={busy}>
        Continue
      </Button>
      <p className="text-center text-[13px] text-muted-foreground">Lost your phone? Ask your company&apos;s owner to contact support to reset two-step sign-in.</p>
    </form>
  );
}
