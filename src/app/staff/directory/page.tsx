import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { PageHeader } from "@/components/ui/page";
import { getStaffContext } from "@/lib/staff/context";
import { Avatar } from "@/components/ui/avatar";
import { fullName } from "@/lib/format";
import { DirectorySearch } from "./directory-search";

export const metadata: Metadata = { title: "Directory" };

interface Row {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  job_title: string | null;
  department: string | null;
  location: string | null;
  work_email: string | null;
  photo_path: string | null;
}

export default async function StaffDirectory(props: PageProps<"/staff/directory">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const { active, supabase } = await getStaffContext();
  const { data } = await supabase.rpc("staff_directory", { p_business: active.business_id });
  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = ((data ?? []) as Row[]).filter(
    (r) => !q || [r.first_name, r.last_name, r.preferred_name, r.job_title, r.department, r.location].some((v) => v?.toLowerCase().includes(q)),
  );

  return (
    <div className="space-y-5">
      <PageHeader back={{ href: "/staff", label: "Home" }} title="Directory" description="Colleagues and their work email." />
      <DirectorySearch initial={sp.q ?? ""} />
      {rows.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={fullName(r)} path={r.photo_path} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground">{fullName(r)}</p>
                <p className="truncate text-[13px] text-subtle-foreground">{[r.job_title, r.department, r.location].filter(Boolean).join(" · ")}</p>
              </div>
              {r.work_email && (
                <a href={`mailto:${r.work_email}`} aria-label={`Email ${fullName(r)}`} className="grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-accent-soft hover:text-foreground">
                  <Mail className="size-4" aria-hidden />
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">{q ? "Nobody matches." : "Nobody here yet."}</p>
      )}
    </div>
  );
}
