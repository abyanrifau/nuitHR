"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ActionForm, TextField } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { saveMyProfile, savePreferences } from "@/lib/notifications/actions";

export function NameForm({ fullName, phone }: { fullName: string; phone: string }) {
  return (
    <ActionForm action={saveMyProfile}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="full_name" label="Full name" defaultValue={fullName} autoComplete="name" />
        <TextField name="phone" label="Phone" type="tel" defaultValue={phone} autoComplete="tel" optional />
      </div>
    </ActionForm>
  );
}

type Factor = { id: string; friendly_name?: string; status: string; created_at: string };

export function TwoStepPanel() {
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<{ id: string; qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { data } = await createClient().auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  };
  useEffect(() => {
    let alive = true;
    createClient()
      .auth.mfa.listFactors()
      .then(({ data }) => {
        if (alive) setFactors((data?.totp ?? []) as Factor[]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const verified = factors?.find((f) => f.status === "verified");

  async function start() {
    setError(null);
    setBusy(true);
    const supabase = createClient();
    // Clear half-finished attempts first; the service allows only one pending setup.
    for (const f of factors ?? []) if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Phone ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (e || !data) return setError(e?.message ?? "Couldn't start setup.");
    setEnrolling({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolling) return;
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6 digits from your app.");
    setBusy(true);
    const { error: err } = await createClient().auth.mfa.challengeAndVerify({ factorId: enrolling.id, code });
    setBusy(false);
    if (err) return setError("That code didn't work. Try the newest one from your app.");
    toast.success("Two-step sign-in is on.");
    setEnrolling(null);
    setCode("");
    void load();
  }

  async function turnOff() {
    if (!verified) return;
    setBusy(true);
    const { error: err } = await createClient().auth.mfa.unenroll({ factorId: verified.id });
    setBusy(false);
    if (err) return toast.error(err.message.includes("aal2") ? "Sign out and back in with your code first, then turn it off." : err.message);
    toast.success("Two-step sign-in is off.");
    void load();
  }

  if (factors === null) return <p className="text-sm text-muted-foreground">Checking…</p>;

  if (verified) {
    return (
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-4">
        <p className="flex-1 text-sm">
          <span className="text-foreground">On.</span> <span className="text-muted-foreground">You&apos;ll be asked for a code each time you sign in.</span>
        </p>
        <Button variant="danger" size="sm" onClick={turnOff} loading={busy}>
          Turn off
        </Button>
      </div>
    );
  }

  if (enrolling) {
    return (
      <form onSubmit={confirm} className="space-y-4 rounded-xl border border-border p-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Install an authenticator app, such as Google Authenticator or Microsoft Authenticator.</li>
          <li>In the app, add an account and scan this code.</li>
          <li>Type the 6-digit code the app shows.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-6">
          <div className="rounded-lg bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- generated QR image */}
            <img src={enrolling.qr} alt="QR code to scan with your authenticator app" width={168} height={168} />
          </div>
          <p className="max-w-xs text-[13px] text-subtle-foreground">
            Can&apos;t scan? Type this key instead: <span className="font-mono break-all text-muted-foreground">{enrolling.secret}</span>
          </p>
        </div>
        <Field label="Code from the app" htmlFor="mfa-code">
          <Input id="mfa-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" className="max-w-40 tracking-[0.3em] tabular" />
        </Field>
        <div className="flex gap-3">
          <Button type="submit" loading={busy}>
            Turn on
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEnrolling(null)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="flex-1 text-sm text-muted-foreground">Off.</p>
      <Button variant="secondary" size="sm" onClick={start} loading={busy}>
        Set up
      </Button>
    </div>
  );
}

interface EventPref {
  key: string;
  label: string;
  description: string;
  defaults: ("in_app" | "email")[];
}

export function NotificationPrefs({ events, saved }: { events: EventPref[]; saved: { event_type: string; channel: string; enabled: boolean }[] }) {
  const initial = Object.fromEntries(
    events.flatMap((e) =>
      (["in_app", "email"] as const).map((c) => {
        const s = saved.find((p) => p.event_type === e.key && p.channel === c);
        return [`${e.key}|${c}`, s ? s.enabled : e.defaults.includes(c)];
      }),
    ),
  ) as Record<string, boolean>;
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(state) !== JSON.stringify(initial);

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th className="border-b border-border px-4 py-3 text-[11px] font-normal tracking-[0.12em] text-subtle-foreground uppercase">When</th>
              <th className="w-20 border-b border-border px-2 py-3 text-center text-[11px] font-normal tracking-[0.12em] text-subtle-foreground uppercase">In app</th>
              <th className="w-20 border-b border-border px-2 py-3 text-center text-[11px] font-normal tracking-[0.12em] text-subtle-foreground uppercase">Email</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.key}>
                <td className="border-b border-border px-4 py-3">
                  <span className="block text-foreground">{e.label}</span>
                  <span className="block text-[12px] text-subtle-foreground">{e.description}</span>
                </td>
                {(["in_app", "email"] as const).map((c) => (
                  <td key={c} className="border-b border-border text-center">
                    <input
                      type="checkbox"
                      aria-label={`${e.label}: ${c === "in_app" ? "in app" : "email"}`}
                      checked={state[`${e.key}|${c}`]}
                      onChange={(ev) => setState((s) => ({ ...s, [`${e.key}|${c}`]: ev.target.checked }))}
                      className="size-4"
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        className="mt-4"
        disabled={!dirty}
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await savePreferences(
              Object.entries(state).map(([k, enabled]) => {
                const [event_type, channel] = k.split("|");
                return { event_type, channel, enabled };
              }),
            );
            if (r.error) toast.error(r.error);
            else toast.success(r.message ?? "Saved.");
          })
        }
      >
        Save notification settings
      </Button>
    </div>
  );
}
