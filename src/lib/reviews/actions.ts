"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { sendEmailsAfterResponse } from "@/lib/notifications/deliver";
import { endOfDayIn } from "@/lib/format";

async function business() {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) throw new Error("No company selected.");
  return active;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const optionalDate = z
  .union([z.literal(""), date])
  .optional()
  .transform((v) => v || null);

// ---------------------------------------------------------------------
// Review rounds
// ---------------------------------------------------------------------
const cycleSchema = z.object({
  name: z.string().trim().min(1, "Give the round a name.").max(120),
  period_type: z.enum(["quarterly", "half_yearly", "annual", "custom"]),
  period_start: date,
  period_end: date,
  self_review_due: optionalDate,
  manager_review_due: optionalDate,
  template_id: z.string().uuid("Choose the questions to use."),
});

export async function saveCycle(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult & { id?: string }> {
  const active = await business();
  const parsed = cycleSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  if (d.period_end < d.period_start) return { error: "The period ends before it starts." };
  const departments = form.getAll("department_ids").map(String).filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  const row = { ...d, participant_filter: departments.length ? { department_ids: departments } : {} };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("review_cycles").update(row).eq("id", id).eq("status", "draft");
    if (error) return { error: error.code === "42501" ? "You don't have permission to run review rounds." : friendly(error.message) };
    revalidatePath(`/app/reviews/${id}`);
    return { ok: true, message: "Saved.", id };
  }
  const { data, error } = await supabase.from("review_cycles").insert({ ...row, business_id: active.business_id }).select("id").single();
  if (error) return { error: error.code === "42501" ? "You don't have permission to run review rounds." : friendly(error.message) };
  revalidatePath("/app/reviews");
  return { ok: true, message: "Round created. Open it when you're ready.", id: data.id };
}

export async function openCycle(id: string): Promise<ActionResult> {
  const active = await business();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("open_review_cycle", { p_cycle: id });
  if (error) return { error: friendly(error.message) };
  sendEmailsAfterResponse(active.business_id);
  revalidatePath(`/app/reviews/${id}`);
  revalidatePath("/app/reviews");
  const n = Number(data ?? 0);
  return { ok: true, message: n ? `Opened. ${n} ${n === 1 ? "person has" : "people have"} been asked to do their self review.` : "Opened." };
}

export async function closeCycle(id: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("review_cycles").update({ status: "closed" }, { count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to run review rounds." };
  revalidatePath(`/app/reviews/${id}`);
  revalidatePath("/app/reviews");
  return { ok: true, message: "Closed. Nobody can change reviews in this round now." };
}

export async function deleteCycle(id: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("review_cycles").delete({ count: "exact" }).eq("id", id).eq("status", "draft");
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "Only rounds that haven't been opened can be deleted." };
  revalidatePath("/app/reviews");
  return { ok: true, message: "Deleted." };
}

// ---------------------------------------------------------------------
// Filling in a review
// ---------------------------------------------------------------------
const answerSchema = z.array(
  z.object({
    question_id: z.string().uuid(),
    rating: z.number().int().min(1).max(5).nullable(),
    answer: z.string().max(4000).nullable(),
  }),
);

export async function saveReview(
  reviewId: string,
  input: { answers: unknown; submit: boolean; overall?: number | null; summary?: string; meetingNotes?: string },
): Promise<ActionResult & { status?: string }> {
  const active = await business();
  const parsed = answerSchema.safeParse(input.answers);
  if (!parsed.success) return { error: "Something in the answers isn't right. Check the ratings." };
  if (input.overall != null && (input.overall < 1 || input.overall > 5)) return { error: "The overall rating goes from 1 to 5." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_review", {
    p_review: reviewId,
    p_answers: parsed.data,
    p_submit: input.submit,
    p_overall: input.overall ?? null,
    p_summary: input.summary?.slice(0, 4000) || null,
    p_meeting_notes: input.meetingNotes?.slice(0, 4000) || null,
  });
  if (error) return { error: friendly(error.message) };
  if (input.submit) sendEmailsAfterResponse(active.business_id);
  revalidatePath(`/app/reviews/review/${reviewId}`);
  revalidatePath(`/staff/reviews/${reviewId}`);
  revalidatePath("/staff/reviews");
  return {
    ok: true,
    status: data as string,
    message: !input.submit ? "Saved. You can finish it later." : data === "manager_review" ? "Sent to your manager." : "Review finished. Share it when you're ready.",
  };
}

export async function shareReview(reviewId: string): Promise<ActionResult> {
  const active = await business();
  const supabase = await createClient();
  const { error } = await supabase.rpc("share_review", { p_review: reviewId });
  if (error) return { error: friendly(error.message) };
  sendEmailsAfterResponse(active.business_id);
  revalidatePath(`/app/reviews/review/${reviewId}`);
  return { ok: true, message: "Shared. They've been told it's ready." };
}

export async function acknowledgeReview(reviewId: string, comment: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_review", { p_review: reviewId, p_comment: comment.slice(0, 4000) || null });
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/staff/reviews/${reviewId}`);
  revalidatePath("/staff/reviews");
  return { ok: true, message: "Thanks. Your review is complete." };
}

// ---------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------
const goalSchema = z.object({
  level: z.enum(["company", "department", "individual"]),
  department_id: z.string().uuid().optional().or(z.literal("")),
  employee_id: z.string().uuid().optional().or(z.literal("")),
  title: z.string().trim().min(1, "Write the goal.").max(200),
  description: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => v || null),
  metric: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null),
  target_value: z
    .union([z.literal(""), z.coerce.number()])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  due_date: optionalDate,
});

export async function saveGoal(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = goalSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  if (d.level === "department" && !d.department_id) return { error: "Choose the department." };
  if (d.level === "individual" && !d.employee_id) return { error: "Choose the person." };
  const row = {
    level: d.level,
    department_id: d.level === "department" ? d.department_id : null,
    employee_id: d.level === "individual" ? d.employee_id : null,
    title: d.title,
    description: d.description,
    metric: d.metric,
    target_value: d.target_value,
    due_date: d.due_date,
  };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("goals").update(row).eq("id", id) : await supabase.from("goals").insert({ ...row, business_id: active.business_id });
  if (error) return { error: error.code === "42501" ? "You can't set that goal." : friendly(error.message) };
  revalidatePath("/app/reviews/goals");
  revalidatePath("/staff/goals");
  return { ok: true, message: "Goal saved." };
}

/** Everyone who can edit a goal records progress the same way: a new update plus the goal's current figures. */
export async function updateGoalProgress(goalId: string, input: { progress: number; status: string; value?: number | null; comment?: string }): Promise<ActionResult> {
  await business();
  const progress = Math.max(0, Math.min(100, Math.round(Number(input.progress) || 0)));
  const status = ["not_started", "on_track", "at_risk", "behind", "completed", "cancelled"].includes(input.status) ? input.status : "on_track";
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("goals")
    .update({ progress_percent: status === "completed" ? 100 : progress, status, ...(input.value != null ? { current_value: input.value } : {}) }, { count: "exact" })
    .eq("id", goalId);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You can't update this goal." };
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: g } = await supabase.from("goals").select("business_id").eq("id", goalId).single();
  await supabase.from("goal_updates").insert({
    business_id: g!.business_id,
    goal_id: goalId,
    progress_percent: status === "completed" ? 100 : progress,
    value: input.value ?? null,
    comment: input.comment?.trim().slice(0, 1000) || null,
    author_id: user!.id,
  });
  revalidatePath("/app/reviews/goals");
  revalidatePath("/staff/goals");
  return { ok: true, message: "Progress saved." };
}

export async function deleteGoal(goalId: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("goals").delete({ count: "exact" }).eq("id", goalId);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You can't delete this goal. Mark it as cancelled instead." };
  revalidatePath("/app/reviews/goals");
  revalidatePath("/staff/goals");
  return { ok: true, message: "Deleted." };
}

// ---------------------------------------------------------------------
// Surveys
// ---------------------------------------------------------------------
const surveySchema = z.object({
  title: z.string().trim().min(1, "Give the survey a title.").max(160),
  description: z.string().trim().max(1000).optional(),
  is_anonymous: z.boolean(),
  min_responses_to_show: z.number().int().min(1).max(50),
  closes_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  department_ids: z.array(z.string().uuid()).default([]),
  questions: z
    .array(
      z.object({
        question: z.string().trim().min(1, "Every question needs some text.").max(300),
        kind: z.enum(["scale", "nps", "single", "multiple", "text"]),
        options: z.array(z.string().trim().min(1, "Fill in every option.").max(120)).max(10),
        is_required: z.boolean(),
      }),
    )
    .min(1, "Add at least one question.")
    .max(40),
});

/** Create or update a draft survey, replacing its questions. */
export async function saveSurvey(id: string | null, input: unknown): Promise<ActionResult & { id?: string }> {
  const active = await business();
  const parsed = surveySchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  for (const q of d.questions) {
    if ((q.kind === "single" || q.kind === "multiple") && q.options.length < 2) return { error: `"${q.question}" needs at least two options.` };
    if (new Set(q.options).size !== q.options.length) return { error: `"${q.question}" has the same option twice.` };
  }
  const row = {
    title: d.title,
    description: d.description || null,
    is_anonymous: d.is_anonymous,
    min_responses_to_show: d.min_responses_to_show,
    // Stays open until the end of the chosen day, company time.
    closes_at: d.closes_at ? endOfDayIn(d.closes_at, active.timezone) : null,
    audience: d.department_ids.length ? { department_ids: d.department_ids } : {},
  };
  const supabase = await createClient();
  let surveyId = id;
  if (id) {
    const { error, count } = await supabase.from("surveys").update(row, { count: "exact" }).eq("id", id).eq("status", "draft");
    if (error) return { error: friendly(error.message) };
    if (!count) return { error: "Only draft surveys can be changed." };
    const { error: delErr } = await supabase.from("survey_questions").delete().eq("survey_id", id);
    if (delErr) return { error: friendly(delErr.message) };
  } else {
    const { data, error } = await supabase.from("surveys").insert({ ...row, business_id: active.business_id }).select("id").single();
    if (error) return { error: error.code === "42501" ? "You don't have permission to make surveys." : friendly(error.message) };
    surveyId = data.id;
  }
  const { error: qErr } = await supabase.from("survey_questions").insert(
    d.questions.map((q, i) => ({
      business_id: active.business_id,
      survey_id: surveyId,
      question: q.question,
      kind: q.kind,
      options: q.kind === "single" || q.kind === "multiple" ? q.options : [],
      is_required: q.is_required,
      sort: i + 1,
    })),
  );
  if (qErr) return { error: friendly(qErr.message) };
  revalidatePath("/app/reviews/surveys");
  revalidatePath(`/app/reviews/surveys/${surveyId}`);
  return { ok: true, message: "Survey saved.", id: surveyId! };
}

export async function setSurveyStatus(id: string, status: "open" | "closed"): Promise<ActionResult> {
  const active = await business();
  const supabase = await createClient();
  if (status === "open") {
    const { count } = await supabase.from("survey_questions").select("id", { count: "exact", head: true }).eq("survey_id", id);
    if (!count) return { error: "Add at least one question first." };
  }
  const { error, count } = await supabase
    .from("surveys")
    .update({ status, ...(status === "open" ? { opens_at: new Date().toISOString() } : {}) }, { count: "exact" })
    .eq("id", id)
    .in("status", status === "open" ? ["draft"] : ["open"]);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to change this survey." };
  if (status === "open") sendEmailsAfterResponse(active.business_id);
  revalidatePath(`/app/reviews/surveys/${id}`);
  revalidatePath("/app/reviews/surveys");
  return { ok: true, message: status === "open" ? "Survey is open. Staff have been told." : "Survey closed." };
}

export async function deleteSurvey(id: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("surveys").delete({ count: "exact" }).eq("id", id).eq("status", "draft");
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "Only draft surveys can be deleted." };
  revalidatePath("/app/reviews/surveys");
  return { ok: true, message: "Deleted." };
}

export async function submitSurvey(id: string, answers: Record<string, unknown>): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_survey", { p_survey: id, p_answers: answers });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/staff/surveys");
  return { ok: true, message: "Thanks for your answers." };
}
