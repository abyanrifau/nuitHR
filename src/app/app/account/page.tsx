import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page";
import { getAdminGate } from "@/lib/platform/guard";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { notificationEvents } from "@/modules/access";
import { NameForm, NotificationPrefs, TwoStepPanel } from "./account-forms";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = (await getSessionUser())!;
  const active = (await getActiveBusiness())!;
  const supabase = await createClient();
  const adminGate = await getAdminGate();
  const [{ data: profile }, { data: prefs }] = await Promise.all([
    supabase.from("profiles").select("full_name, phone").eq("id", user.id).single(),
    supabase.from("notification_preferences").select("event_type, channel, enabled").eq("business_id", active.business_id).eq("user_id", user.id),
  ]);
  const events = notificationEvents(toAccessContext(active)).map((e) => ({
    key: e.key,
    label: e.label,
    description: e.description,
    defaults: e.defaultChannels.filter((c): c is "in_app" | "email" => c === "in_app" || c === "email"),
  }));
  return (
    <div className="max-w-3xl space-y-12">
      <PageHeader
        title="Your account"
        description={`Signed in as ${user.email}. These settings are just for you.`}
        actions={
          // Only Harbor's own platform admins see this (checked on the server).
          adminGate.kind !== "none" ? (
            <Link href="/admin" className="text-[13px] text-muted-foreground underline underline-offset-4 hover:text-foreground">
              Admin
            </Link>
          ) : undefined
        }
      />
      <section>
        <h2 className="mb-4 text-lg">Your name</h2>
        <NameForm fullName={profile?.full_name ?? ""} phone={profile?.phone ?? ""} />
      </section>
      <section>
        <h2 className="mb-1 text-lg">Two-step sign-in</h2>
        <p className="mb-4 text-sm text-muted-foreground">After your password, you&apos;ll also type a code from an app on your phone. It keeps your account safe even if someone learns your password.</p>
        <TwoStepPanel />
      </section>
      <section>
        <h2 className="mb-1 text-lg">Notifications</h2>
        <p className="mb-4 text-sm text-muted-foreground">Choose what reaches you for {active.business_name}.</p>
        <NotificationPrefs events={events} saved={prefs ?? []} />
      </section>
    </div>
  );
}
