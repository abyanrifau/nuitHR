import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { ReviewForm } from "@/components/reviews/review-form";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate } from "@/lib/format";
import { loadMyReview } from "@/lib/reviews/load";
import { AcknowledgeForm } from "./acknowledge";

export const metadata: Metadata = { title: "My review" };

export default async function StaffReview(props: PageProps<"/staff/reviews/[id]">) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { active, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  const data = await loadMyReview(supabase, active.business_id, id);
  if (!data) notFound();
  const { review: r, scale, questions, answers } = data;
  const cycle = { name: r.cycle_name, status: r.cycle_status, period_start: r.period_start, period_end: r.period_end, self_review_due: r.self_review_due };
  const shared = r.status === "shared" || r.status === "acknowledged";
  const editable = r.status === "self_review" && cycle.status === "open";
  const overall = r.overall_rating === null ? null : Number(r.overall_rating);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/staff/reviews", label: "My reviews" }}
        title={cycle.name}
        description={`${formatDate(cycle.period_start, active.date_format)} to ${formatDate(cycle.period_end, active.date_format)}${
          editable && cycle.self_review_due ? ` · please send by ${formatDate(cycle.self_review_due, active.date_format)}` : ""
        }`}
      />
      {editable && <p className="text-sm text-muted-foreground">Be honest and give examples. Your manager sees your answers once you send them.</p>}
      {!editable && !shared && r.status !== "self_review" && (
        <Alert tone="info">You&apos;ve sent your part. Your manager is working on theirs, and you&apos;ll be told when it&apos;s ready to read.</Alert>
      )}
      {!editable && r.status === "self_review" && <Alert tone="info">This review round is closed.</Alert>}

      {shared && (
        <section className="space-y-4 rounded-xl border border-border p-4">
          <h2 className="text-lg">Your manager&apos;s view</h2>
          {overall !== null && (
            <p className="text-sm">
              Overall: <span className="tabular text-foreground">{overall}</span> · {scale.find((s) => s.value === Math.round(overall))?.label}
            </p>
          )}
          {r.manager_summary && <p className="whitespace-pre-line text-sm text-foreground">{r.manager_summary}</p>}
          {r.meeting_notes && (
            <div>
              <p className="text-[12px] text-subtle-foreground">Notes from your conversation</p>
              <p className="whitespace-pre-line text-sm text-foreground">{r.meeting_notes}</p>
            </div>
          )}
        </section>
      )}

      <ReviewForm
        reviewId={r.id}
        role="self"
        questions={questions}
        scale={scale}
        mine={answers.self}
        other={shared ? answers.manager : undefined}
        otherLabel="Your manager said"
        editable={editable}
      />

      {r.status === "shared" && <AcknowledgeForm reviewId={r.id} />}
      {r.status === "acknowledged" && (
        <Alert tone="success" title="You've signed off this review">
          {r.employee_comment ? `Your comment: ${r.employee_comment}` : undefined}
        </Alert>
      )}
    </div>
  );
}
