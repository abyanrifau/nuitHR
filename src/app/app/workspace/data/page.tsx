import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { can } from "@/modules/access";

export const metadata: Metadata = { title: "Your data" };

export default async function DataPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "data_export", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner to download company data.
      </Alert>
    );
  }
  const supabase = await createClient();
  const { data: exports } = await supabase.from("data_exports").select("id, status, created_at, requested_by, error").eq("business_id", active.business_id).order("created_at", { ascending: false }).limit(10);
  return (
    <div className="max-w-3xl space-y-10">
      <PageHeader label="workspace" title="Your data" description="Your company's data belongs to you. Download all of it whenever you like." />
      <section className="rounded-xl border border-border p-6">
        <h2 className="text-lg">Download everything</h2>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">
          A ZIP file with one spreadsheet per area: people, time off, pay, requests and so on. It opens in Excel or Google Sheets. It can take up to a minute for a large company.
        </p>
        {can(ctx, "data_export", "create") ? (
          <a href="/app/workspace/data/export" className={buttonClasses()} download>
            <Download className="size-4" aria-hidden /> Download ZIP
          </a>
        ) : (
          <Alert tone="info">You can see past downloads but not make new ones.</Alert>
        )}
        <p className="mt-4 text-[13px] text-subtle-foreground">Uploaded files like contracts aren&apos;t in the ZIP. Download those from each person&apos;s Files tab.</p>
      </section>
      {exports && exports.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg">Past downloads</h2>
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {exports.map((e) => (
                <Tr key={e.id}>
                  <Td className="tabular">{formatDateTime(e.created_at, active.date_format, active.timezone)}</Td>
                  <Td>
                    <StatusDot tone={e.status === "ready" ? "success" : e.status === "failed" ? "danger" : "neutral"}>
                      {e.status === "ready" ? "Downloaded" : e.status === "failed" ? "Didn't finish" : "Started"}
                    </StatusDot>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}
