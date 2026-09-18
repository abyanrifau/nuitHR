import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Logo } from "@/components/brand/logo";
import { Card, CardContent } from "@/components/ui/card";
import { isSupabaseConfigured, siteUrl, supabasePublishableKey, supabaseUrl } from "@/lib/env";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Setup check", robots: { index: false } };
export const dynamic = "force-dynamic";

type Status = "ok" | "fail" | "skip";
interface Check {
  label: string;
  status: Status;
  help: string;
}

/**
 * A plain-language checklist that tells you whether this copy of the app
 * is connected correctly. It never shows the keys themselves.
 */
async function runChecks(): Promise<Check[]> {
  const checks: Check[] = [];
  const url = supabaseUrl();
  const key = supabasePublishableKey();

  checks.push({
    label: "Supabase project address (NEXT_PUBLIC_SUPABASE_URL)",
    status: url ? (/^https:\/\/.+/.test(url) ? "ok" : "fail") : "fail",
    help: url ? "Should start with https:// and end with .supabase.co" : "Missing. Copy the Project URL from Supabase into .env.local.",
  });
  checks.push({
    label: "Public key (NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)",
    status: key ? "ok" : "fail",
    help: key ? "Found." : "Missing. Copy the publishable key from Supabase → Project Settings → API Keys.",
  });
  checks.push({
    label: "Secret key (SUPABASE_SECRET_KEY)",
    status: isAdminConfigured() ? "ok" : "fail",
    help: isAdminConfigured() ? "Found." : "Missing. Copy the secret key from Supabase → Project Settings → API Keys.",
  });

  if (isSupabaseConfigured()) {
    try {
      const anon = createSupabaseClient(url!, key!, { auth: { persistSession: false } });
      const { error } = await anon.rpc("get_public_careers", { p_slug: "__setup_check__" });
      if (!error) {
        checks.push({ label: "Can reach Supabase with the public key", status: "ok", help: "Connected." });
        checks.push({ label: "Database tables installed", status: "ok", help: "The app's database setup has been applied." });
      } else if (/Could not find the function|does not exist|PGRST202/i.test(error.message + (error.code ?? ""))) {
        checks.push({ label: "Can reach Supabase with the public key", status: "ok", help: "Connected." });
        checks.push({
          label: "Database tables installed",
          status: "fail",
          help: "Not yet. Run the database setup (README → Step 4).",
        });
      } else {
        checks.push({
          label: "Can reach Supabase with the public key",
          status: "fail",
          help: `Supabase answered with an error. Double-check the URL and public key. (${error.message})`,
        });
      }
    } catch {
      checks.push({
        label: "Can reach Supabase with the public key",
        status: "fail",
        help: "Couldn't connect. Check the project URL and your internet connection.",
      });
    }
  } else {
    checks.push({ label: "Can reach Supabase", status: "skip", help: "Fill in the keys above first." });
  }

  if (isSupabaseConfigured() && isAdminConfigured()) {
    try {
      const { data, error } = await createAdminClient().storage.getBucket("tenant-files");
      checks.push({
        label: "File storage ready (secret key works)",
        status: data && !error ? "ok" : "fail",
        help: data && !error ? "The private file storage area exists." : "Not ready. Check the secret key, then run the database setup.",
      });
    } catch {
      checks.push({ label: "File storage ready (secret key works)", status: "fail", help: "The secret key was rejected." });
    }
  }

  checks.push({
    label: "Site address used in emails",
    status: "ok",
    help: `${siteUrl()}. Change it with NEXT_PUBLIC_SITE_URL once you have your own domain.`,
  });

  return checks;
}

const icons = {
  ok: <CheckCircle2 className="size-5 text-success" aria-label="OK" />,
  fail: <XCircle className="size-5 text-danger" aria-label="Needs attention" />,
  skip: <CircleDashed className="size-5 text-subtle-foreground" aria-label="Not checked yet" />,
};

export default async function SetupPage() {
  const checks = await runChecks();
  const allGood = checks.every((c) => c.status === "ok");

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 px-4 py-10">
      <Logo />
      <div className="space-y-1">
        <h1 className="text-3xl sm:text-4xl">Setup check</h1>
        <p className="text-sm text-muted-foreground">
          {allGood
            ? "Everything is connected. You can create an account and sign in."
            : "Some things still need attention. Follow the README steps, then refresh this page."}
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y divide-border">
            {checks.map((c) => (
              <li key={c.label} className="flex gap-3 p-4">
                <span className="mt-0.5 shrink-0">{icons[c.status]}</span>
                <div>
                  <p className="text-sm">{c.label}</p>
                  <p className="text-sm break-words text-muted-foreground">{c.help}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground">
        {allGood ? (
          <Link href="/signup" className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground">
            Create your account →
          </Link>
        ) : (
          "Tip: after changing .env.local, stop the app (Ctrl+C) and start it again with npm run dev."
        )}
      </p>
    </main>
  );
}
