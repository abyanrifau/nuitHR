import Link from "next/link";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { ADMIN_ACTION_LABEL } from "@/lib/platform/data";
import { adminTitle, requirePlatformAdmin } from "@/lib/platform/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateMetadata() {
  return adminTitle("Admin log");
}

/** Every action taken in the admin area: who, what, which company, why, and the before and after values. */
export default async function AdminActivity() {
  await requirePlatformAdmin();
  const { data: log } = await createAdminClient()
    .from("platform_audit_log")
    .select("id, admin_email, action, business_id, business_name, reason, before, after, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  return (
    <div className="space-y-6">
      <div>
        <p className="section-label mb-1">platform admin</p>
        <h1 className="text-2xl">Admin log</h1>
        <p className="text-sm text-muted-foreground">Every change made from the admin area. Entries can&apos;t be edited or deleted from the app.</p>
      </div>
      {log?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Who</Th>
              <Th>What</Th>
              <Th>Company</Th>
              <Th>Reason</Th>
              <Th>Details</Th>
            </tr>
          </thead>
          <tbody>
            {log.map((l) => (
              <Tr key={l.id}>
                <Td className="whitespace-nowrap tabular">{formatDateTime(l.created_at, "DD/MM/YYYY")}</Td>
                <Td className="text-[13px]">{l.admin_email}</Td>
                <Td>{ADMIN_ACTION_LABEL[l.action] ?? l.action}</Td>
                <Td>
                  {l.business_id ? (
                    <Link href={`/admin/businesses/${l.business_id}`} className="underline-offset-4 hover:underline">
                      {l.business_name ?? "Company"}
                    </Link>
                  ) : (
                    (l.business_name ?? "—")
                  )}
                </Td>
                <Td className="max-w-64 text-[13px] text-muted-foreground">{l.reason ?? "—"}</Td>
                <Td>
                  {l.before || l.after ? (
                    <details className="text-[12px] text-muted-foreground">
                      <summary className="cursor-pointer">Before and after</summary>
                      <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify({ before: l.before, after: l.after }, null, 1)}</pre>
                    </details>
                  ) : (
                    "—"
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">Nothing logged yet.</p>
      )}
    </div>
  );
}
