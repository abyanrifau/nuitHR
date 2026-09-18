import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot } from "@/components/ui/table";
import { ReviewForm } from "@/components/reviews/review-form";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { loadReview, REVIEW_STATUS } from "@/lib/reviews/load";
import { can } from "@/modules/access";
import { ShareButton } from "../../reviews-client";

export const metadata: Metadata = { title: "Review" };

export default async function ReviewPage(props: PageProps<"/app/reviews/review/[id]">) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  const supabase = await createClient();
  const data = await loadReview(supabase, id);
  if (!data || data.review.business_id !== active.business_id) notFound();
  const { review: r, cycle, person, scale, questions, answers } = data;
  // Your own review is filled in from the staff app.
  if (active.employee_id && r.employee_id === active.employee_id) {
    return (
      <Alert tone="info" title="This is your own review">
        Fill it in from the staff app under My reviews.
      </Alert>
    );
  }
  const isReviewer = active.employee_id !== null && r.reviewer_employee_id === active.employee_id;
  const canWrite = isReviewer || can(ctx, "reviews", "edit", "team");
  const editable = canWrite && cycle.status === "open" && ["self_review", "manager_review", "meeting"].includes(r.status);
  const s = REVIEW_STATUS[r.status] ?? REVIEW_STATUS.self_review;

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: `/app/reviews/${cycle.id}`, label: cycle.name }}
        title={person}
        description={`${formatDate(cycle.period_start, active.date_format)} to ${formatDate(cycle.period_end, active.date_format)}`}
        actions={r.status === "finalized" && canWrite ? <ShareButton id={r.id} /> : undefined}
      />
      <p className="mb-6">
        <StatusDot tone={s.tone}>{s.label}</StatusDot>
      </p>
      {r.status === "self_review" && editable && (
        <Alert tone="info" className="mb-6">
          {person} hasn&apos;t sent their self review yet. You can start yours now, or wait to see theirs first.
        </Alert>
      )}
      {r.employee_comment && (
        <Alert tone="success" title={`${person}'s comment`} className="mb-6">
          {r.employee_comment}
        </Alert>
      )}
      <ReviewForm
        reviewId={r.id}
        role="manager"
        questions={questions.manager}
        scale={scale}
        mine={answers.manager}
        other={r.self_submitted_at ? answers.self : undefined}
        otherLabel={`${person} said`}
        editable={editable}
        manager={{ overall: r.overall_rating === null ? null : Number(r.overall_rating), summary: r.manager_summary ?? "", meetingNotes: r.meeting_notes ?? "" }}
      />
    </div>
  );
}
