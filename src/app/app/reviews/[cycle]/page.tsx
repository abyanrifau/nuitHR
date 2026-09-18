import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { REVIEW_STATUS } from "@/lib/reviews/load";
import { can } from "@/modules/access";
import { RoundButtons } from "../reviews-client";

export const metadata: Metadata = { title: "Review round" };

export default async function ReviewRoundPage(props: PageProps<"/app/reviews/[cycle]">) {
  const { cycle: id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "reviews", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see reviews.
      </Alert>
    );
  }
  const supabase = await createClient();
  const { data: c } = await supabase.from("review_cycles").select("*, template:review_templates(name)").eq("id", id).eq("business_id", active.business_id).maybeSingle();
  if (!c) notFound();
  const { data: reviews } = await supabase
    .from("reviews")
    .select("id, status, overall_rating, employee:employees!reviews_business_id_employee_id_fkey(id, first_name, last_name), reviewer:employees!reviews_business_id_reviewer_employee_id_fkey(first_name, last_name)")
    .eq("cycle_id", id)
    .order("created_at");
  const depts = ((c.participant_filter as { department_ids?: string[] })?.department_ids ?? []) as string[];
  const { data: deptNames } = depts.length ? await supabase.from("departments").select("name").in("id", depts) : { data: [] };

  return (
    <div className="max-w-5xl">
      <PageHeader
        back={{ href: "/app/reviews", label: "Reviews" }}
        title={c.name}
        description={[
          `${formatDate(c.period_start, active.date_format)} to ${formatDate(c.period_end, active.date_format)}`,
          c.self_review_due && `self reviews due ${formatDate(c.self_review_due, active.date_format)}`,
          c.manager_review_due && `manager reviews due ${formatDate(c.manager_review_due, active.date_format)}`,
          (c.template as unknown as { name: string } | null)?.name,
          deptNames?.length ? `for ${deptNames.map((d) => d.name).join(", ")}` : "for everyone",
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={can(ctx, "reviews", "edit") && c.status !== "closed" ? <RoundButtons id={c.id} status={c.status} /> : undefined}
      />
      {c.status === "draft" ? (
        <Alert tone="info">Nobody has been asked yet. Select Open round when you&apos;re ready; each person gets a notification.</Alert>
      ) : reviews?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Manager</Th>
              <Th>Overall</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((r) => {
              const e = r.employee as unknown as { first_name: string; last_name: string };
              const m = r.reviewer as unknown as { first_name: string; last_name: string } | null;
              const s = REVIEW_STATUS[r.status] ?? REVIEW_STATUS.self_review;
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/app/reviews/review/${r.id}`} className="text-foreground underline-offset-4 hover:underline">
                      {`${e.first_name} ${e.last_name}`.trim()}
                    </Link>
                  </Td>
                  <Td>{m ? `${m.first_name} ${m.last_name}`.trim() : <span className="text-subtle-foreground">No manager, HR reviews</span>}</Td>
                  <Td className="tabular">{r.overall_rating ?? "—"}</Td>
                  <Td>
                    <StatusDot tone={s.tone}>{s.label}</StatusDot>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <Alert tone="info">Nobody matched this round. Check the departments it&apos;s for.</Alert>
      )}
    </div>
  );
}
