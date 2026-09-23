import Link from "next/link";
import { appConfig } from "@/config/app.config";
import { NuitLink } from "@/components/brand/byline";
import type { Metadata } from "next";
import { House, LogOut } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { NotificationPrefs, TwoStepPanel } from "@/app/app/account/account-forms";
import { signOut } from "@/lib/auth/actions";
import { getStaffContext, getStaffProfile } from "@/lib/staff/context";
import { formatDate, fullName, initials } from "@/lib/format";
import { notificationEvents } from "@/modules/access";
import { MyContactForm, MyEmergencyContacts } from "../staff-client";

export const metadata: Metadata = { title: "Me" };

export default async function StaffMe() {
  const { active, ctx, me: link, supabase, user } = await getStaffContext();
  const [me, { data: contacts }, { data: prefs }] = await Promise.all([
    getStaffProfile(),
    link
      ? supabase.from("employee_emergency_contacts").select("id, name, relationship, phone, is_primary").eq("employee_id", link.id).order("is_primary", { ascending: false }).order("name")
      : Promise.resolve({ data: [] }),
    supabase.from("notification_preferences").select("event_type, channel, enabled").eq("business_id", active.business_id).eq("user_id", user.id),
  ]);
  const events = notificationEvents(ctx).map((e) => ({
    key: e.key,
    label: e.label,
    description: e.description,
    defaults: e.defaultChannels.filter((c): c is "in_app" | "email" => c === "in_app" || c === "email"),
  }));
  const position = (me?.position as unknown as { title: string } | null)?.title;
  const department = (me?.department as unknown as { name: string } | null)?.name;
  const branch = (me?.branch as unknown as { name: string } | null)?.name;

  return (
    <div className="space-y-10">
      <div className="flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-full border border-border text-lg text-muted-foreground">{me ? initials(me) : "?"}</span>
        <div className="min-w-0">
          <h1 className="truncate text-2xl">{me ? fullName(me) : user.email}</h1>
          <p className="text-sm text-muted-foreground">{[position, department].filter(Boolean).join(" · ") || active.role_name}</p>
        </div>
      </div>

      {me ? (
        <>
          <section aria-labelledby="job">
            <h2 id="job" className="section-label mb-3">
              your job
            </h2>
            <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border p-4 text-sm">
              {[
                ["Employee no.", me.employee_code],
                ["Location", branch],
                ["Joined", formatDate(me.join_date, active.date_format)],
                ["Work email", me.work_email],
              ].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-[13px] text-muted-foreground">{k}</dt>
                  <dd className="truncate text-foreground">{v || "Not added"}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-[13px] text-subtle-foreground">Something wrong here? Ask HR to change it.</p>
          </section>

          <section aria-labelledby="contact">
            <h2 id="contact" className="section-label mb-3">
              how to reach you
            </h2>
            <MyContactForm
              values={{ phone: me.phone ?? "", personal_email: me.personal_email ?? "", current_address: me.current_address ?? "", permanent_address: me.permanent_address ?? "" }}
            />
          </section>

          <section aria-labelledby="emergency">
            <h2 id="emergency" className="section-label mb-3">
              emergency contacts
            </h2>
            <MyEmergencyContacts contacts={contacts ?? []} />
          </section>
        </>
      ) : (
        <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it in People &amp; access.</Alert>
      )}

      <section aria-labelledby="notif">
        <h2 id="notif" className="section-label mb-3">
          notifications
        </h2>
        <NotificationPrefs events={events} saved={prefs ?? []} />
      </section>

      <section aria-labelledby="security">
        <h2 id="security" className="section-label mb-3">
          two-step sign-in
        </h2>
        <TwoStepPanel />
      </section>

      <section className="flex items-center justify-between gap-4 border-t border-border pt-6">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          Light or dark <ThemeToggle />
        </span>
        <div className="flex items-center gap-2">
          <Link href="/" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent-soft hover:text-foreground">
            <House className="size-4" aria-hidden /> {appConfig.brand.name} home
          </Link>
          <form action={signOut}>
            <Button type="submit" variant="secondary">
              <LogOut className="size-4" aria-hidden /> Sign out
            </Button>
          </form>
        </div>
      </section>
      <p className="text-center text-[12px] text-subtle-foreground">Signed in as {user.email}</p>
      <p className="text-center text-[12px] text-subtle-foreground">
        {appConfig.brand.name} by <NuitLink location="staff-app" />
      </p>
    </div>
  );
}
