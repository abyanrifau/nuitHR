import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime } from "@/lib/format";
import { loadOrgOptions } from "@/lib/people/org-options";
import { can } from "@/modules/access";
import { Board } from "./board";

export const metadata: Metadata = { title: "Role" };

export default async function VacancyPage(props: PageProps<"/app/hiring/[vacancy]">) {
  const { vacancy: id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "recruitment", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see hiring.
      </Alert>
    );
  }
  const supabase = await createClient();
  const { data: v } = await supabase.from("vacancies").select("*").eq("id", id).eq("business_id", active.business_id).maybeSingle();
  if (!v) notFound();
  const [{ data: apps }, { data: code }] = await Promise.all([
    supabase
      .from("applications")
      .select(
        "id, stage, rating, cover_letter, rejected_reason, hired_employee_id, applied_at, candidate:candidates(id, full_name, email, phone, current_position, cv_path, source), notes:candidate_notes(id, body, created_at, author_id), interviews(id, scheduled_at, duration_minutes, location, status)",
      )
      .eq("vacancy_id", id)
      .order("applied_at", { ascending: false }),
    supabase.rpc("suggest_employee_code", { p_business: active.business_id }),
  ]);
  const canEdit = can(ctx, "recruitment", "edit");
  const canHire = canEdit && can(ctx, "employees", "create");
  const org = canHire ? await loadOrgOptions(supabase, active.business_id) : null;
  const authorIds = [...new Set((apps ?? []).flatMap((a) => ((a.notes ?? []) as { author_id: string | null }[]).map((n) => n.author_id)).filter(Boolean))] as string[];
  const { data: authors } = authorIds.length ? await supabase.from("profiles").select("id, full_name").in("id", authorIds) : { data: [] };
  const authorName = new Map((authors ?? []).map((a) => [a.id, a.full_name ?? "Someone"]));

  return (
    <div>
      <PageHeader
        back={{ href: "/app/hiring", label: "Hiring" }}
        title={v.title}
        description={
          <>
            {v.status === "open" ? "Open" : v.status === "draft" ? "Draft" : v.status === "filled" ? "Filled" : "Closed"}
            {v.deadline && ` · apply by ${formatDate(v.deadline, active.date_format)}`}
            {v.is_public && v.status === "open" && " · on your careers page"}
          </>
        }
        actions={
          canEdit ? (
            <Link href={`/app/hiring/${id}/edit`} className={buttonClasses({ variant: "secondary" })}>
              <Pencil className="size-4" aria-hidden /> Edit role
            </Link>
          ) : undefined
        }
      />
      <Board
        vacancyId={id}
        businessId={active.business_id}
        canEdit={canEdit}
        canHire={canHire}
        canSetSalary={can(ctx, "compensation", "create")}
        suggestedCode={(code as string | null) ?? ""}
        org={org}
        currency={active.currency}
        apps={(apps ?? []).map((a) => {
          const c = a.candidate as unknown as { id: string; full_name: string; email: string | null; phone: string | null; current_position: string | null; cv_path: string | null; source: string };
          return {
            id: a.id,
            stage: a.stage,
            rating: a.rating,
            coverLetter: a.cover_letter,
            rejectedReason: a.rejected_reason,
            hiredEmployeeId: a.hired_employee_id,
            applied: formatDate(a.applied_at, active.date_format, active.timezone),
            candidate: c,
            notes: ((a.notes ?? []) as { id: string; body: string; created_at: string; author_id: string | null }[])
              .sort((x, y) => y.created_at.localeCompare(x.created_at))
              .map((n) => ({ id: n.id, body: n.body, when: formatDateTime(n.created_at, active.date_format, active.timezone), by: (n.author_id && authorName.get(n.author_id)) || "Someone" })),
            interviews: ((a.interviews ?? []) as { id: string; scheduled_at: string; duration_minutes: number; location: string | null; status: string }[])
              .sort((x, y) => x.scheduled_at.localeCompare(y.scheduled_at))
              .map((i) => ({ id: i.id, when: formatDateTime(i.scheduled_at, active.date_format, active.timezone), minutes: i.duration_minutes, location: i.location, status: i.status })),
          };
        })}
      />
    </div>
  );
}
