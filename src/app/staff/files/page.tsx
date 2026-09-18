import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate, today } from "@/lib/format";
import { OpenFileButton } from "../staff-client";

export const metadata: Metadata = { title: "My files" };

export default async function StaffFiles() {
  const { active, me, supabase } = await getStaffContext();
  if (!me) {
    return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  }
  // HR can hide a file from the person; the database only returns ones marked visible.
  const { data: docs } = await supabase
    .from("employee_documents")
    .select("id, title, file_path, file_name, expiry_date, created_at, category:document_categories(name)")
    .eq("employee_id", me.id)
    .order("created_at", { ascending: false });
  const now = today(active.timezone);

  return (
    <div className="space-y-6">
      <PageHeader back={{ href: "/staff", label: "Home" }} title="My files" description="Your contract, ID copies, certificates and letters." />
      {docs?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {docs.map((d) => {
            const expired = d.expiry_date && d.expiry_date < now;
            return (
              <li key={d.id} className="flex items-center gap-3 px-4 py-3.5">
                <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">{d.title}</p>
                  <p className="text-[13px] text-subtle-foreground">
                    {(d.category as unknown as { name: string } | null)?.name ?? "File"} · <span className="tabular">{formatDate(d.created_at, active.date_format, active.timezone)}</span>
                    {d.expiry_date && <span className={expired ? "text-danger" : undefined}> · {expired ? "expired" : "expires"} {formatDate(d.expiry_date, active.date_format)}</span>}
                  </p>
                </div>
                <OpenFileButton path={d.file_path} label="Open" />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">No files yet. When HR adds your contract or a letter, it shows here.</p>
      )}
    </div>
  );
}
