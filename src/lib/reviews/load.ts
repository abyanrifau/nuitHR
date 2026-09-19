import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReviewAnswer, ReviewQuestion, Scale } from "@/components/reviews/review-form";

export const REVIEW_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  self_review: { label: "Self review to do", tone: "warning" },
  manager_review: { label: "Manager review to do", tone: "info" },
  meeting: { label: "Meeting to hold", tone: "info" },
  finalized: { label: "Finished, not shared", tone: "info" },
  shared: { label: "Shared", tone: "success" },
  acknowledged: { label: "Read and signed off", tone: "success" },
};

/**
 * One review with its questions and both sides' answers, as far as the
 * signed-in person may see them (the database decides what comes back).
 */
export async function loadReview(supabase: SupabaseClient, reviewId: string) {
  const { data: r } = await supabase
    .from("reviews")
    .select(
      "id, business_id, status, employee_id, reviewer_employee_id, overall_rating, manager_summary, meeting_notes, employee_comment, self_submitted_at, shared_at, acknowledged_at, employee:employees!reviews_business_id_employee_id_fkey(id, first_name, last_name), cycle:review_cycles(id, template_id, name, status, period_start, period_end, self_review_due, manager_review_due, template:review_templates(rating_scale))",
    )
    .eq("id", reviewId)
    .maybeSingle();
  if (!r) return null;
  const cycle = r.cycle as unknown as {
    id: string;
    template_id: string;
    name: string;
    status: string;
    period_start: string;
    period_end: string;
    self_review_due: string | null;
    manager_review_due: string | null;
    template: { rating_scale: Scale } | null;
  };
  const [{ data: questions }, { data: responses }] = await Promise.all([
    supabase.from("review_questions").select("id, section, question, kind, audience, is_required, sort").eq("template_id", cycle.template_id).order("sort"),
    supabase.from("review_responses").select("question_id, respondent_type, rating, answer").eq("review_id", reviewId),
  ]);
  const byType = (t: string) =>
    Object.fromEntries((responses ?? []).filter((x) => x.respondent_type === t).map((x) => [x.question_id, { rating: x.rating, answer: x.answer } as ReviewAnswer]));
  const forRole = (role: "self" | "manager"): ReviewQuestion[] =>
    (questions ?? [])
      .filter((q) => q.audience === "all" || q.audience === role)
      .map((q) => ({ id: q.id, section: q.section, question: q.question, kind: q.kind as ReviewQuestion["kind"], is_required: q.is_required }));
  const e = r.employee as unknown as { id: string; first_name: string; last_name: string };
  return {
    review: r,
    cycle,
    person: `${e.first_name} ${e.last_name}`.trim(),
    scale: (cycle.template?.rating_scale ?? []) as Scale,
    questions: { self: forRole("self"), manager: forRole("manager") },
    answers: { self: byType("self"), manager: byType("manager") },
  };
}

/**
 * The signed-in person's own review, for the staff app. The review row itself
 * is hidden from them until it's shared, so this reads through my_reviews(),
 * which leaves out the manager's rating and notes until then.
 */
export async function loadMyReview(supabase: SupabaseClient, businessId: string, reviewId: string) {
  const { data } = await supabase.rpc("my_reviews", { p_business: businessId });
  const r = ((data ?? []) as MyReviewRow[]).find((x) => x.id === reviewId);
  if (!r) return null;
  const [{ data: questions }, { data: responses }] = await Promise.all([
    supabase.from("review_questions").select("id, section, question, kind, audience, is_required, sort").eq("template_id", r.template_id).order("sort"),
    supabase.from("review_responses").select("question_id, respondent_type, rating, answer").eq("review_id", reviewId),
  ]);
  const byType = (t: string) =>
    Object.fromEntries((responses ?? []).filter((x) => x.respondent_type === t).map((x) => [x.question_id, { rating: x.rating, answer: x.answer } as ReviewAnswer]));
  return {
    review: r,
    scale: (r.rating_scale ?? []) as Scale,
    questions: (questions ?? [])
      .filter((q) => q.audience === "all" || q.audience === "self")
      .map((q) => ({ id: q.id, section: q.section, question: q.question, kind: q.kind as ReviewQuestion["kind"], is_required: q.is_required })),
    answers: { self: byType("self"), manager: byType("manager") },
  };
}

export interface MyReviewRow {
  id: string;
  business_id: string;
  status: string;
  employee_id: string;
  self_submitted_at: string | null;
  employee_comment: string | null;
  overall_rating: number | null;
  manager_summary: string | null;
  meeting_notes: string | null;
  cycle_id: string;
  cycle_name: string;
  cycle_status: string;
  period_start: string;
  period_end: string;
  self_review_due: string | null;
  template_id: string;
  rating_scale: Scale | null;
}
