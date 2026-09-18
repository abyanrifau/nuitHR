"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { sendEmailsAfterResponse } from "@/lib/notifications/deliver";

async function business() {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) throw new Error("No company selected.");
  return active;
}

const noPermission = (e: { code?: string; message: string }) =>
  e.code === "42501" ? "You don't have permission to change courses." : friendly(e.message);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

const courseSchema = z.object({
  title: z.string().trim().min(1, "Give the course a name.").max(160),
  description: z.string().trim().max(4000).default(""),
  category: optionalText(80),
  estimated_minutes: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(10000)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  pass_mark: z.coerce.number().int().min(0, "Pass mark is 0 to 100.").max(100, "Pass mark is 0 to 100.").default(70),
  is_mandatory: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  certificate_enabled: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

/** Create or update a course. New courses start as drafts. */
export async function saveCourse(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult & { id?: string }> {
  const active = await business();
  const parsed = courseSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("courses").update(parsed.data).eq("id", id);
    if (error) return { error: noPermission(error) };
    revalidatePath(`/app/training/${id}`);
    return { ok: true, message: "Saved.", id };
  }
  const { data, error } = await supabase.from("courses").insert({ ...parsed.data, business_id: active.business_id }).select("id").single();
  if (error) return { error: noPermission(error) };
  revalidatePath("/app/training");
  return { ok: true, message: "Course created. Now add its lessons.", id: data.id };
}

export async function setCourseStatus(id: string, status: "draft" | "published" | "archived"): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  if (status === "published") {
    const { count } = await supabase.from("course_lessons").select("id", { count: "exact", head: true }).eq("course_id", id);
    if (!count) return { error: "Add at least one lesson before publishing." };
    const { data: quizzes } = await supabase.from("course_lessons").select("id, title, questions:quiz_questions(id)").eq("course_id", id).eq("kind", "quiz");
    const empty = (quizzes ?? []).find((q) => !(q.questions as unknown[]).length);
    if (empty) return { error: `The quiz "${empty.title}" has no questions yet.` };
  }
  const { error, count } = await supabase.from("courses").update({ status }, { count: "exact" }).eq("id", id);
  if (error) return { error: noPermission(error) };
  if (!count) return { error: "You don't have permission to change courses." };
  revalidatePath(`/app/training/${id}`);
  revalidatePath("/app/training");
  return { ok: true, message: status === "published" ? "Published. Now assign it to people." : status === "archived" ? "Archived." : "Moved back to draft." };
}

export async function deleteCourse(id: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { count: started } = await supabase.from("course_enrollments").select("id", { count: "exact", head: true }).eq("course_id", id);
  if (started) return { error: "People are already taking this course. Archive it instead." };
  const { error, count } = await supabase.from("courses").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: noPermission(error) };
  if (!count) return { error: "You don't have permission to delete courses." };
  revalidatePath("/app/training");
  return { ok: true, message: "Deleted." };
}

const lessonSchema = z.object({
  title: z.string().trim().min(1, "Give the lesson a title.").max(160),
  kind: z.enum(["text", "video", "pdf", "quiz"]),
  content: optionalText(20000),
  video_url: z
    .union([z.literal(""), z.string().trim().url("Paste the full video link, starting with https://").max(500)])
    .optional()
    .transform((v) => v || null),
  file_path: optionalText(400),
  pass_mark: z
    .union([z.literal(""), z.coerce.number().int().min(0).max(100)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

/** Add or update a lesson. PDFs are uploaded by the browser first; the path comes here. */
export async function saveLesson(courseId: string, lessonId: string | null, input: unknown): Promise<ActionResult & { id?: string }> {
  const active = await business();
  const parsed = lessonSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.kind === "text" && !d.content) return { error: "Write the lesson." };
  if (d.kind === "video" && !d.video_url) return { error: "Paste the video link." };
  if (d.kind === "pdf" && !d.file_path) return { error: "Choose the PDF." };
  if (d.file_path && !d.file_path.startsWith(`${active.business_id}/learning/`)) return { error: "That file is in the wrong folder." };
  const row = {
    title: d.title,
    kind: d.kind,
    content: d.kind === "text" || d.kind === "video" || d.kind === "pdf" ? d.content : null,
    video_url: d.kind === "video" ? d.video_url : null,
    file_path: d.kind === "pdf" ? d.file_path : null,
    pass_mark: d.kind === "quiz" ? d.pass_mark : null,
  };
  const supabase = await createClient();
  if (lessonId) {
    const { error } = await supabase.from("course_lessons").update(row).eq("id", lessonId).eq("course_id", courseId);
    if (error) return { error: noPermission(error) };
    revalidatePath(`/app/training/${courseId}`);
    return { ok: true, message: "Lesson saved.", id: lessonId };
  }
  const { data: last } = await supabase.from("course_lessons").select("sort").eq("course_id", courseId).order("sort", { ascending: false }).limit(1).maybeSingle();
  const { data, error } = await supabase
    .from("course_lessons")
    .insert({ ...row, business_id: active.business_id, course_id: courseId, sort: (last?.sort ?? 0) + 1 })
    .select("id")
    .single();
  if (error) return { error: noPermission(error) };
  revalidatePath(`/app/training/${courseId}`);
  return { ok: true, message: d.kind === "quiz" ? "Quiz added. Now add its questions." : "Lesson added.", id: data.id };
}

export async function moveLesson(courseId: string, lessonId: string, direction: -1 | 1): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { data: lessons } = await supabase.from("course_lessons").select("id, sort").eq("course_id", courseId).order("sort");
  const list = lessons ?? [];
  const i = list.findIndex((l) => l.id === lessonId);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= list.length) return { ok: true };
  [list[i], list[j]] = [list[j], list[i]];
  for (const [n, l] of list.entries()) {
    const { error } = await supabase.from("course_lessons").update({ sort: n + 1 }).eq("id", l.id);
    if (error) return { error: noPermission(error) };
  }
  revalidatePath(`/app/training/${courseId}`);
  return { ok: true };
}

export async function deleteLesson(courseId: string, lessonId: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { data: l } = await supabase.from("course_lessons").select("file_path").eq("id", lessonId).maybeSingle();
  const { error, count } = await supabase.from("course_lessons").delete({ count: "exact" }).eq("id", lessonId).eq("course_id", courseId);
  if (error) return { error: noPermission(error) };
  if (!count) return { error: "You don't have permission to change courses." };
  if (l?.file_path) await supabase.storage.from("tenant-files").remove([l.file_path]);
  revalidatePath(`/app/training/${courseId}`);
  return { ok: true, message: "Lesson removed." };
}

const questionSchema = z.object({
  question: z.string().trim().min(1, "Write the question.").max(500),
  kind: z.enum(["single", "multiple", "true_false"]),
  options: z.array(z.object({ id: z.string().min(1).max(8), text: z.string().trim().min(1, "Fill in every answer.").max(300) })).min(2, "Add at least two answers.").max(8),
  correct: z.array(z.string()).min(1, "Tick the right answer."),
  explanation: z.string().trim().max(500).optional(),
});

export async function saveQuestion(courseId: string, lessonId: string, questionId: string | null, input: unknown): Promise<ActionResult> {
  await business();
  const parsed = questionSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_quiz_question", {
    p_lesson: lessonId,
    p_question: questionId,
    p_text: d.question,
    p_kind: d.kind,
    p_options: d.options,
    p_correct: d.correct,
    p_explanation: d.explanation || null,
  });
  if (error) return { error: noPermission(error) };
  revalidatePath(`/app/training/${courseId}`);
  return { ok: true, message: "Question saved." };
}

export async function deleteQuestion(courseId: string, questionId: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("quiz_questions").delete({ count: "exact" }).eq("id", questionId);
  if (error) return { error: noPermission(error) };
  if (!count) return { error: "You don't have permission to change courses." };
  revalidatePath(`/app/training/${courseId}`);
  return { ok: true, message: "Question removed." };
}

const assignSchema = z.object({
  target_type: z.enum(["everyone", "employee", "department", "position", "branch"]),
  target_id: z.string().uuid().optional().or(z.literal("")),
  due_date: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
    .optional()
    .transform((v) => v || null),
  is_mandatory: z.boolean().default(false),
});

export async function assignCourse(courseId: string, input: unknown): Promise<ActionResult> {
  const active = await business();
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.target_type !== "everyone" && !d.target_id) return { error: "Choose who the course is for." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assign_course", {
    p_course: courseId,
    p_target_type: d.target_type,
    p_target_id: d.target_type === "everyone" ? null : d.target_id,
    p_due: d.due_date,
    p_mandatory: d.is_mandatory,
  });
  if (error) return { error: noPermission(error) };
  sendEmailsAfterResponse(active.business_id);
  revalidatePath(`/app/training/${courseId}`);
  const n = Number(data ?? 0);
  return { ok: true, message: n ? `Assigned to ${n} ${n === 1 ? "person" : "people"}. They've been told.` : "Saved. Everyone it covers already has this course." };
}

export async function removeAssignment(courseId: string, assignmentId: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("course_assignments").delete({ count: "exact" }).eq("id", assignmentId);
  if (error) return { error: noPermission(error) };
  if (!count) return { error: "You don't have permission to change courses." };
  revalidatePath(`/app/training/${courseId}`);
  return { ok: true, message: "Removed. People who already have the course keep it; new joiners won't get it." };
}

// ---------------------------------------------------------------------
// Learner
// ---------------------------------------------------------------------
export async function completeLesson(courseId: string, enrollmentId: string, lessonId: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error } = await supabase.rpc("complete_lesson", { p_enrollment: enrollmentId, p_lesson: lessonId });
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/staff/courses/${courseId}`);
  revalidatePath("/staff/courses");
  return { ok: true };
}

export interface QuizResult {
  score: number;
  pass_mark: number;
  passed: boolean;
  results: { question_id: string; correct: boolean; correct_ids?: string[]; explanation?: string | null }[];
}

export async function submitQuiz(courseId: string, enrollmentId: string, lessonId: string, answers: Record<string, string[]>): Promise<ActionResult & { result?: QuizResult }> {
  await business();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_quiz", { p_enrollment: enrollmentId, p_lesson: lessonId, p_answers: answers });
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/staff/courses/${courseId}`);
  revalidatePath("/staff/courses");
  return { ok: true, result: data as QuizResult };
}

// ---------------------------------------------------------------------
// Paid training
// ---------------------------------------------------------------------
const paidSchema = z.object({
  provider: z.string().trim().min(1, "Who runs the course?").max(160),
  course_name: z.string().trim().min(1, "Name the course.").max(200),
  location: z.string().trim().max(160).optional(),
  start_date: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
    .optional()
    .transform((v) => v || null),
  end_date: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
    .optional()
    .transform((v) => v || null),
  cost: z.coerce.number().min(0, "Enter the cost.").max(10_000_000),
  notes: z.string().trim().max(2000).optional(),
});

/** Staff ask the company to pay for a course. It goes through approvals like any request. */
export async function requestPaidTraining(_: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = paidSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_paid_training", {
    p_business: active.business_id,
    p_provider: d.provider,
    p_course: d.course_name,
    p_location: d.location || null,
    p_start: d.start_date,
    p_end: d.end_date,
    p_cost: d.cost,
    p_notes: d.notes || null,
  });
  if (error) return { error: friendly(error.message) };
  sendEmailsAfterResponse(active.business_id);
  revalidatePath("/staff/courses");
  revalidatePath("/app/training/paid");
  return { ok: true, message: "Sent for approval." };
}

const recordSchema = paidSchema.extend({
  employee_id: z.string().uuid("Choose a person."),
  status: z.enum(["requested", "approved", "rejected", "in_progress", "completed", "cancelled"]).default("approved"),
  bond_months: z
    .union([z.literal(""), z.coerce.number().int().min(0).max(120)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

/** HR records paid training directly, or updates a record (status, bond). The bond end date is worked out from the end date. */
export async function savePaidTraining(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = recordSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  if (d.start_date && d.end_date && d.end_date < d.start_date) return { error: "The end date is before the start date." };
  let bondEnd: string | null = null;
  const from = d.end_date ?? d.start_date;
  if (d.bond_months && from) {
    const dt = new Date(`${from}T00:00:00Z`);
    dt.setUTCMonth(dt.getUTCMonth() + d.bond_months);
    bondEnd = dt.toISOString().slice(0, 10);
  }
  const row = {
    employee_id: d.employee_id,
    provider: d.provider,
    course_name: d.course_name,
    location: d.location || null,
    start_date: d.start_date,
    end_date: d.end_date,
    cost: d.cost,
    status: d.status,
    bond_months: d.bond_months,
    bond_end_date: bondEnd,
    notes: d.notes || null,
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("training_sponsorships").update(row).eq("id", id)
    : await supabase.from("training_sponsorships").insert({ ...row, business_id: active.business_id, currency: active.currency });
  if (error) return { error: error.code === "42501" ? "You don't have permission to change paid training." : friendly(error.message) };
  revalidatePath("/app/training/paid");
  return { ok: true, message: "Saved." };
}
