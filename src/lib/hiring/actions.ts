"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";

async function business() {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) throw new Error("No company selected.");
  return active;
}

const opt = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
const optUuid = z
  .union([z.literal(""), z.string().uuid()])
  .optional()
  .transform((v) => v || null);
const optNum = z
  .union([z.literal(""), z.coerce.number().min(0)])
  .optional()
  .transform((v) => (v === "" || v === undefined ? null : v));

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .slice(0, 60) || "role"
  );
}

const vacancySchema = z
  .object({
    title: z.string().trim().min(2, "Give the role a title.").max(120),
    department_id: optUuid,
    branch_id: optUuid,
    position_id: optUuid,
    employment_type: z.enum(["permanent", "fixed_term", "part_time", "casual", "intern", "consultant"]),
    description: z.string().trim().max(10000).default(""),
    requirements: z.string().trim().max(10000).default(""),
    salary_min: optNum,
    salary_max: optNum,
    show_salary: z.coerce.boolean().optional(),
    openings: z.coerce.number().int().min(1).max(500).default(1),
    deadline: z
      .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
      .optional()
      .transform((v) => v || null),
    status: z.enum(["draft", "open", "closed", "filled"]),
    is_public: z.coerce.boolean().optional(),
  })
  .refine((v) => v.salary_max === null || v.salary_min === null || v.salary_max >= v.salary_min, { message: "The top of the range must be above the bottom.", path: ["salary_max"] });

export async function saveVacancy(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult & { id?: string }> {
  const active = await business();
  const parsed = vacancySchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = { ...parsed.data, show_salary: parsed.data.show_salary ?? false, is_public: parsed.data.is_public ?? false };
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase.from("vacancies").update(d).eq("id", id);
    if (error) return { error: error.code === "42501" ? "You don't have permission to change roles." : friendly(error.message) };
    revalidatePath("/app/hiring");
    revalidatePath(`/app/hiring/${id}`);
    return { ok: true, id, message: "Saved." };
  }
  // A readable web address for the careers page, made unique within the company.
  const base = slugify(d.title);
  const { data: taken } = await supabase.from("vacancies").select("slug").eq("business_id", active.business_id).like("slug", `${base}%`);
  const used = new Set((taken ?? []).map((t) => t.slug));
  let slug = base;
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
  const { data, error } = await supabase.from("vacancies").insert({ ...d, slug, business_id: active.business_id }).select("id").single();
  if (error) return { error: error.code === "42501" ? "You don't have permission to add roles." : friendly(error.message) };
  revalidatePath("/app/hiring");
  return { ok: true, id: data.id, message: "Role created." };
}

const careersSchema = z.object({ careers_page_enabled: z.coerce.boolean().optional(), careers_intro: opt(2000) });

export async function saveCareersPage(_: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = careersSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("businesses")
    .update({ careers_page_enabled: parsed.data.careers_page_enabled ?? false, careers_intro: parsed.data.careers_intro }, { count: "exact" })
    .eq("id", active.business_id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "Only people who can change company settings can switch the careers page on or off." };
  revalidatePath("/app/hiring");
  return { ok: true, message: parsed.data.careers_page_enabled ? "Your careers page is live." : "Careers page switched off." };
}

const candidateSchema = z.object({
  vacancy_id: z.string().uuid(),
  full_name: z.string().trim().min(2, "Enter their name.").max(120),
  email: z
    .union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email.")])
    .optional()
    .transform((v) => v || null),
  phone: opt(40),
  current_position: opt(120),
  source: z.enum(["manual", "referral", "agency", "job_board", "other"]).default("manual"),
  cv_path: opt(400),
  notes: opt(2000),
});

/** Add someone you found yourself (a referral, a walk-in, an agency CV). */
export async function addCandidate(input: unknown): Promise<ActionResult> {
  const active = await business();
  const parsed = candidateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { vacancy_id, ...c } = parsed.data;
  if (c.cv_path && !c.cv_path.startsWith(`${active.business_id}/recruitment/`)) return { error: "That file is in the wrong folder." };
  const supabase = await createClient();
  let candidateId: string | null = null;
  if (c.email) {
    const { data } = await supabase.from("candidates").select("id").eq("business_id", active.business_id).ilike("email", c.email).limit(1).maybeSingle();
    candidateId = data?.id ?? null;
  }
  if (!candidateId) {
    const { data, error } = await supabase.from("candidates").insert({ ...c, business_id: active.business_id }).select("id").single();
    if (error) return { error: error.code === "42501" ? "You don't have permission to add candidates." : friendly(error.message) };
    candidateId = data.id;
  }
  const { error } = await supabase.from("applications").insert({ business_id: active.business_id, vacancy_id, candidate_id: candidateId });
  if (error) return { error: error.code === "23505" ? "They're already a candidate for this role." : friendly(error.message) };
  revalidatePath(`/app/hiring/${vacancy_id}`);
  return { ok: true, message: "Candidate added." };
}

const STAGES = ["applied", "screening", "interview", "offer", "hired", "rejected"] as const;

export async function moveApplication(id: string, stage: (typeof STAGES)[number], vacancyId: string, reason?: string): Promise<ActionResult> {
  await business();
  if (!STAGES.includes(stage) || stage === "hired") return { error: "Use Hire to hire someone." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("applications")
    .update({ stage, stage_changed_at: new Date().toISOString(), ...(stage === "rejected" ? { rejected_reason: reason?.trim() || null } : {}) }, { count: "exact" })
    .eq("id", id)
    .neq("stage", "hired");
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You can't move this candidate." };
  revalidatePath(`/app/hiring/${vacancyId}`);
  return { ok: true };
}

export async function rateApplication(id: string, rating: number, vacancyId: string): Promise<ActionResult> {
  await business();
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "Choose 1 to 5 stars." };
  const supabase = await createClient();
  const { error } = await supabase.from("applications").update({ rating }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/app/hiring/${vacancyId}`);
  return { ok: true };
}

export async function addNote(applicationId: string, body: string, vacancyId: string): Promise<ActionResult> {
  const active = await business();
  if (!body.trim()) return { error: "Write a note." };
  const supabase = await createClient();
  const { error } = await supabase.from("candidate_notes").insert({ business_id: active.business_id, application_id: applicationId, body: body.trim().slice(0, 5000) });
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/app/hiring/${vacancyId}`);
  return { ok: true, message: "Note added." };
}

const interviewSchema = z.object({
  application_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time."),
  duration_minutes: z.coerce.number().int().min(10).max(480).default(30),
  location: opt(200),
});

function offsetFor(timeZone: string, date: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(`${date}T12:00:00Z`));
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+05:00";
  return tz === "GMT" ? "+00:00" : tz.replace("GMT", "");
}

export async function scheduleInterview(vacancyId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const active = await business();
  const parsed = interviewSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("interviews").insert({
    business_id: active.business_id,
    application_id: d.application_id,
    scheduled_at: `${d.date}T${d.time}:00${offsetFor(active.timezone, d.date)}`,
    duration_minutes: d.duration_minutes,
    location: d.location,
    interviewer_user_ids: [user.id],
  });
  if (error) return { error: friendly(error.message) };
  await supabase.from("applications").update({ stage: "interview", stage_changed_at: new Date().toISOString() }).eq("id", d.application_id).in("stage", ["applied", "screening"]);
  revalidatePath(`/app/hiring/${vacancyId}`);
  return { ok: true, message: "Interview booked." };
}

export async function setInterviewStatus(id: string, status: "completed" | "cancelled" | "no_show", vacancyId: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error } = await supabase.from("interviews").update({ status }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/app/hiring/${vacancyId}`);
  return { ok: true };
}

const hireSchema = z.object({
  application_id: z.string().uuid(),
  join_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose their first day."),
  employee_code: z.string().trim().min(1, "Enter an employee number.").max(40),
  position_id: optUuid,
  department_id: optUuid,
  branch_id: optUuid,
  manager_id: optUuid,
  salary: optNum,
});

/** Hire: they become a person in the directory, and their joiner checklist starts. */
export async function hireCandidate(vacancyId: string, _: ActionResult, form: FormData): Promise<ActionResult & { employeeId?: string }> {
  await business();
  const parsed = hireSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hire_candidate", {
    p_application: d.application_id,
    p_join_date: d.join_date,
    p_employee_code: d.employee_code,
    p_position: d.position_id,
    p_department: d.department_id,
    p_branch: d.branch_id,
    p_manager: d.manager_id,
    p_salary: d.salary,
  });
  if (error) {
    if (error.message.includes("employees_business_id_employee_code_key")) return { error: "That employee number is already used.", fieldErrors: { employee_code: ["Already used."] } };
    return { error: friendly(error.message) };
  }
  revalidatePath(`/app/hiring/${vacancyId}`);
  revalidatePath("/app/people");
  revalidatePath("/app/joiners-leavers");
  return { ok: true, employeeId: data as string, message: "Hired. Their profile and joiner checklist are ready." };
}

export async function candidateFileLink(path: string): Promise<{ url?: string; error?: string }> {
  const active = await business();
  if (!path.startsWith(`${active.business_id}/`)) return { error: "You can't open this file." };
  const supabase = await createClient();
  const { data } = await supabase.storage.from("tenant-files").createSignedUrl(path, 120);
  return data ? { url: data.signedUrl } : { error: "You can't open this file." };
}
