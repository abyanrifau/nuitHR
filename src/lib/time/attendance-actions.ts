"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveBusiness, requireUser, toAccessContext } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/access";

/** Works out this month's and last month's days again with the current rules and schedules (locked days stay). */
async function recalcRecent(businessId: string, timezone: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
  const [y, m] = today.split("-").map(Number);
  const from = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, "0")}-01`;
  const supabase = await createClient();
  // Only people who may change attendance rules can do this; for others, days update as they're next changed.
  await supabase.rpc("recalc_attendance_since", { p_business: businessId, p_from: from });
}

async function business() {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) throw new Error("Choose a company first.");
  return active;
}

const num = (min: number, max: number) => z.coerce.number().min(min).max(max);
const optNum = (min: number, max: number) => z.union([z.literal(""), num(min, max)]).transform((v) => (v === "" ? null : v));
const flag = (form: FormData, name: string) => form.getAll(name).includes("true");

const rulesSchema = z.object({
  grace_minutes: num(0, 120),
  early_leave_minutes: num(0, 240),
  half_day_min_hours: num(0, 12),
  full_day_hours: num(1, 24),
  overtime_mode: z.enum(["daily_hours", "outside_shift"]),
  overtime_daily_hours: optNum(1, 24),
  overtime_after_minutes: num(0, 240),
  overtime_rounding: z.enum(["none", "nearest", "down", "up"]),
  overtime_round_to: num(1, 120),
  overtime_monthly_cap_hours: optNum(0, 744),
  overtime_rate_weekday: num(1, 5),
  overtime_rate_rest_day: num(1, 5),
  overtime_rate_holiday: num(1, 5),
});

/** The company's attendance and overtime rules (the default rules everyone uses unless given others). */
export async function saveAttendanceRules(_: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  if (!can(toAccessContext(active), "attendance", "edit", "all")) return { error: "You don't have permission to change attendance rules." };
  const parsed = rulesSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const values = {
    ...parsed.data,
    late_mark_after_minutes: parsed.data.grace_minutes,
    overtime_enabled: flag(form, "overtime_enabled"),
    overtime_requires_approval: flag(form, "overtime_requires_approval"),
    require_gps: flag(form, "require_gps"),
    require_selfie: flag(form, "require_selfie"),
  };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("attendance_policies").select("id").eq("business_id", active.business_id).eq("is_default", true).maybeSingle();
  const { error } = existing
    ? await supabase.from("attendance_policies").update(values).eq("id", existing.id)
    : await supabase.from("attendance_policies").insert({ ...values, business_id: active.business_id, name: "Standard rules", is_default: true });
  if (error) return { error: friendly(error.message) };
  await recalcRecent(active.business_id, active.timezone);
  revalidatePath("/app/time", "layout");
  return { ok: true, message: "Rules saved. This month and last month have been worked out again with them; months with finalized payroll don't change." };
}

const scheduleSchema = z.object({
  name: z.string().trim().min(2, "Give the schedule a name.").max(60),
  shift_id: z.union([z.literal(""), z.string().uuid()]).transform((v) => v || null),
});

export async function saveWorkSchedule(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = scheduleSchema.safeParse({ name: form.get("name"), shift_id: form.get("shift_id") ?? "" });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const days = form
    .getAll("working_days")
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  if (!days.length) return { error: "Tick at least one working day." };
  const isDefault = flag(form, "is_default");
  const supabase = await createClient();
  if (isDefault) await supabase.from("work_schedules").update({ is_default: false }).eq("business_id", active.business_id).eq("is_default", true).neq("id", id ?? "00000000-0000-0000-0000-000000000000");
  const row = { name: parsed.data.name, shift_id: parsed.data.shift_id, working_days: [...new Set(days)].sort(), is_default: isDefault };
  const { error } = id
    ? await supabase.from("work_schedules").update(row).eq("id", id).eq("business_id", active.business_id)
    : await supabase.from("work_schedules").insert({ ...row, business_id: active.business_id });
  if (error) return { error: error.code === "42501" ? "You don't have permission to change schedules." : friendly(error.message) };
  await recalcRecent(active.business_id, active.timezone);
  revalidatePath("/app/time/schedules");
  return { ok: true, message: id ? "Schedule saved." : "Schedule added." };
}

export async function deleteWorkSchedule(id: string): Promise<ActionResult> {
  const active = await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("work_schedules").delete({ count: "exact" }).eq("id", id).eq("business_id", active.business_id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to delete schedules." };
  await recalcRecent(active.business_id, active.timezone);
  revalidatePath("/app/time/schedules");
  return { ok: true, message: "Schedule deleted. People on it now follow the default schedule." };
}

/** Puts people on a schedule (or, with null, back on the company's default). */
export async function assignWorkSchedule(scheduleId: string | null, employeeIds: string[]): Promise<ActionResult> {
  const active = await business();
  if (!employeeIds.length) return { error: "Choose at least one person." };
  if (!can(toAccessContext(active), "employees", "edit")) return { error: "You don't have permission to change people's schedules." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("employees")
    .update({ work_schedule_id: scheduleId }, { count: "exact" })
    .eq("business_id", active.business_id)
    .in("id", employeeIds.slice(0, 1000));
  if (error) return { error: friendly(error.message) };
  await recalcRecent(active.business_id, active.timezone);
  revalidatePath("/app/time/schedules");
  return { ok: true, message: `${count ?? 0} ${count === 1 ? "person" : "people"} updated.` };
}

export async function decideOvertime(ids: string[], decision: "approved" | "rejected"): Promise<ActionResult> {
  const active = await business();
  if (!ids.length) return { error: "Choose at least one day." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("decide_overtime", { p_business: active.business_id, p_records: ids, p_decision: decision });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app/time/overtime");
  return { ok: true, message: `${data} ${data === 1 ? "day" : "days"} ${decision === "approved" ? "approved" : "rejected"}.` };
}

export interface ImportRow {
  row: number;
  code: string;
  date: string;
  in: string;
  out: string;
}

/** Checks (dryRun) or saves rows from a clock machine's file. */
export async function importAttendance(rows: ImportRow[], dryRun: boolean): Promise<ActionResult & { valid?: number; imported?: number; errors?: { row: number; message: string }[] }> {
  const active = await business();
  if (rows.length > 5000) return { error: "Import up to 5,000 rows at a time." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_attendance", { p_business: active.business_id, p_rows: rows, p_dry_run: dryRun });
  if (error) return { error: friendly(error.message) };
  const r = data as { valid: number; imported: number; errors: { row: number; message: string }[] };
  if (!dryRun) revalidatePath("/app/time", "layout");
  return { ok: true, ...r, message: dryRun ? undefined : `${r.imported} ${r.imported === 1 ? "day" : "days"} imported.` };
}
