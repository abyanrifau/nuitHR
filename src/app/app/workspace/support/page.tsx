import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page";
import { StatusDot } from "@/components/ui/table";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { appConfig } from "@/config/app.config";
import { can } from "@/modules/access";
import { SupportAccessPanel, TicketForm } from "./support-client";

export const metadata: Metadata = { title: "Help & support" };

const STATUS: Record<string, { label: string; tone: "warning" | "info" | "success" | "neutral" }> = {
  open: { label: "Open", tone: "warning" },
  in_progress: { label: "We're on it", tone: "info" },
  resolved: { label: "Solved", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
};

export default async function SupportPage() {
  const active = (await getActiveBusiness())!;
  const user = (await getSessionUser())!;
  const ctx = toAccessContext(active);
  const supabase = await createClient();
  const canSupport = can(ctx, "support", "view");
  const [{ data: tickets }, grants] = await Promise.all([
    supabase.from("support_tickets").select("id, subject, category, status, created_at, created_by").eq("business_id", active.business_id).order("created_at", { ascending: false }).limit(20),
    canSupport
      ? supabase.from("support_access_grants").select("id, expires_at, revoked_at, reason, created_at").eq("business_id", active.business_id).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("expires_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  const wa = `https://wa.me/${appConfig.brand.whatsappNumber}`;

  return (
    <div className="max-w-3xl space-y-12">
      <PageHeader
        label="workspace"
        title="Help & support"
        description={
          <>
            Most answers are in the{" "}
            <Link href="/help" className="underline underline-offset-4">
              help centre
            </Link>
            . If you&apos;re stuck, message us here, email {appConfig.brand.supportEmail}, or{" "}
            <a href={wa} className="underline underline-offset-4" target="_blank" rel="noopener noreferrer">
              chat on WhatsApp
            </a>
            .
          </>
        }
      />
      <section>
        <h2 className="mb-4 text-lg">Message support</h2>
        <TicketForm />
      </section>
      {tickets && tickets.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg">Your messages</h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {tickets.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">{t.subject}</p>
                  <p className="text-[13px] text-subtle-foreground tabular">
                    {formatDate(t.created_at, active.date_format, active.timezone)}
                    {t.created_by !== user.id && " · sent by a colleague"}
                  </p>
                </div>
                <StatusDot tone={(STATUS[t.status] ?? STATUS.open).tone}>{(STATUS[t.status] ?? STATUS.open).label}</StatusDot>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canSupport && (
        <section>
          <h2 className="mb-1 text-lg">Let support see your company</h2>
          <p className="mb-5 text-sm text-muted-foreground">
            Our team can&apos;t see anything in your company unless you let them in. Access ends by itself at the time you choose, and you can end it early. Everything they do is in the activity log.
          </p>
          <SupportAccessPanel
            canEdit={can(ctx, "support", "edit")}
            grants={(grants.data ?? []).map((g) => ({ id: g.id, until: formatDateTime(g.expires_at, active.date_format, active.timezone), reason: g.reason }))}
          />
        </section>
      )}
    </div>
  );
}
