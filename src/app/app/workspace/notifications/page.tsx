import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { appConfig } from "@/config/app.config";
import { can } from "@/modules/access";
import { ChannelsPanel } from "./channels-panel";

export const metadata: Metadata = { title: "Notification settings" };

export default async function WorkspaceNotificationsPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "settings", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to change how notifications are sent.
      </Alert>
    );
  }
  const supabase = await createClient();
  const [{ data: channels }, { data: deliveries }] = await Promise.all([
    supabase.from("notification_channels").select("channel, enabled, last_tested_at").eq("business_id", active.business_id),
    supabase.from("notification_deliveries").select("id, channel, recipient, status, error, created_at").eq("business_id", active.business_id).neq("status", "skipped").order("created_at", { ascending: false }).limit(20),
  ]);
  const email = channels?.find((c) => c.channel === "email");
  const emailReady = appConfig.email.provider === "console" || Boolean(process.env.RESEND_API_KEY);

  return (
    <div className="max-w-3xl space-y-10">
      <PageHeader
        label="workspace"
        title="Notification settings"
        description={
          <>
            How your company&apos;s notifications are sent. Each person chooses which ones they get in{" "}
            <Link href="/app/account" className="underline underline-offset-4">
              their account
            </Link>
            .
          </>
        }
      />
      {!emailReady && (
        <Alert tone="warning" title="Email sending isn't set up">
          Emails can&apos;t go out until the email service key (RESEND_API_KEY) is added to the hosting settings. In-app notifications still work.
        </Alert>
      )}
      <ChannelsPanel
        canEdit={can(ctx, "settings", "edit")}
        emailOn={email ? email.enabled : true}
        lastTested={email?.last_tested_at ? formatDateTime(email.last_tested_at, active.date_format, active.timezone) : null}
      />
      <section>
        <h2 className="mb-4 text-lg">Recent emails</h2>
        {deliveries?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>To</Th>
                <Th>Sent</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <Tr key={d.id}>
                  <Td className="text-muted-foreground">{d.recipient}</Td>
                  <Td className="text-muted-foreground tabular">{formatDateTime(d.created_at, active.date_format, active.timezone)}</Td>
                  <Td>
                    <StatusDot tone={d.status === "sent" ? "success" : d.status === "failed" ? "danger" : "neutral"}>{d.status === "failed" ? `Failed: ${d.error}` : d.status === "sent" ? "Sent" : "Sending"}</StatusDot>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="text-sm text-subtle-foreground">No emails sent yet.</p>
        )}
      </section>
    </div>
  );
}
