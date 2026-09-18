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

const locSchema = z
  .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100000).nullable().optional() })
  .nullable()
  .optional();

/** Clock in from the staff app. Location and photo are checked by the database against the company's rules. */
export async function clockIn(input: { location?: unknown; selfiePath?: string | null }): Promise<ActionResult & { late?: number; flagged?: boolean }> {
  const active = await business();
  const loc = locSchema.safeParse(input.location ?? null);
  if (!loc.success) return { error: "Your location couldn't be read. Try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clock_in", {
    p_business: active.business_id,
    p_lat: loc.data?.lat ?? null,
    p_lng: loc.data?.lng ?? null,
    p_accuracy: loc.data?.accuracy ?? null,
    p_selfie_path: input.selfiePath ?? null,
  });
  if (error) return { error: friendly(error.message) };
  const r = data as { late_minutes: number; flagged: boolean };
  revalidatePath("/staff/time");
  revalidatePath("/staff");
  return {
    ok: true,
    late: r.late_minutes,
    flagged: r.flagged,
    message: r.late_minutes > 0 ? `Clocked in, ${r.late_minutes} min late.` : "Clocked in. Have a good shift.",
  };
}

export async function clockOut(input: { location?: unknown }): Promise<ActionResult> {
  const active = await business();
  const loc = locSchema.safeParse(input.location ?? null);
  if (!loc.success) return { error: "Your location couldn't be read. Try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("clock_out", {
    p_business: active.business_id,
    p_lat: loc.data?.lat ?? null,
    p_lng: loc.data?.lng ?? null,
    p_accuracy: loc.data?.accuracy ?? null,
  });
  if (error) return { error: friendly(error.message) };
  const r = data as { worked_minutes: number; overtime_minutes: number };
  revalidatePath("/staff/time");
  const h = Math.floor(r.worked_minutes / 60);
  const m = r.worked_minutes % 60;
  return { ok: true, message: `Clocked out. You worked ${h} h ${m} min${r.overtime_minutes ? `, including ${r.overtime_minutes} min overtime` : ""}.` };
}

export async function toggleBreak(): Promise<ActionResult> {
  const active = await business();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("toggle_break", { p_business: active.business_id });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/staff/time");
  return { ok: true, message: data === "started" ? "Break started." : "Welcome back." };
}

const fixSchema = z
  .object({
    work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the day."),
    clock_in: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]).default(""),
    clock_out: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]).default(""),
    next_day: z.coerce.boolean().optional(),
    reason: z.string().trim().min(3, "Say what happened.").max(500),
  })
  .refine((v) => v.clock_in || v.clock_out, { message: "Enter the time you started, finished, or both.", path: ["clock_in"] });

/** Offset like "+05:00" for the company's time zone on a given day. */
function offsetFor(timeZone: string, date: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(new Date(`${date}T12:00:00Z`));
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+05:00";
  return tz === "GMT" ? "+00:00" : tz.replace("GMT", "");
}

function addDay(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Ask for a missed or wrong clock time to be fixed. It goes to the manager. */
export async function requestTimeFix(_: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = fixSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const off = offsetFor(active.timezone, d.work_date);
  const inAt = d.clock_in ? `${d.work_date}T${d.clock_in}:00${off}` : null;
  // A finish time earlier than the start means the shift ended after midnight.
  const outDate = d.next_day || (d.clock_in && d.clock_out && d.clock_out <= d.clock_in) ? addDay(d.work_date) : d.work_date;
  const outAt = d.clock_out ? `${outDate}T${d.clock_out}:00${off}` : null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_time_fix", {
    p_business: active.business_id,
    p_work_date: d.work_date,
    p_clock_in: inAt,
    p_clock_out: outAt,
    p_reason: d.reason,
  });
  if (error) return { error: friendly(error.message) };
  sendEmailsAfterResponse(active.business_id);
  revalidatePath("/staff/time");
  revalidatePath("/staff/requests");
  return { ok: true, message: "Sent to your manager." };
}

// ---------------------------------------------------------------------
// Office view
// ---------------------------------------------------------------------

const recordSchema = z.object({
  id: z
    .union([z.literal(""), z.string().uuid()])
    .transform((v) => v || null)
    .optional(),
  employee_id: z.string().uuid("Choose a person."),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  shift_id: z
    .union([z.literal(""), z.string().uuid()])
    .transform((v) => v || null)
    .optional(),
  clock_in: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]).default(""),
  clock_out: z.union([z.literal(""), z.string().regex(/^\d{2}:\d{2}$/)]).default(""),
  status: z.enum(["auto", "absent", "on_leave", "holiday", "rest_day"]).default("auto"),
  notes: z.string().trim().max(500).optional(),
});

/** Office users add or fix a day directly. Late, overtime and hours are worked out by the database. */
export async function saveAttendanceRecord(_: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = recordSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  if (d.status === "auto" && !d.clock_in) return { error: "Enter a start time, or choose absent, on leave, holiday or rest day.", fieldErrors: { clock_in: ["Needed."] } };
  const off = offsetFor(active.timezone, d.work_date);
  const inAt = d.status === "auto" && d.clock_in ? `${d.work_date}T${d.clock_in}:00${off}` : null;
  const outAt =
    d.status === "auto" && d.clock_out ? `${d.clock_in && d.clock_out <= d.clock_in ? addDay(d.work_date) : d.work_date}T${d.clock_out}:00${off}` : null;
  const row = {
    business_id: active.business_id,
    employee_id: d.employee_id,
    work_date: d.work_date,
    shift_id: d.shift_id ?? null,
    clock_in_at: inAt,
    clock_out_at: outAt,
    status: d.status === "auto" ? "present" : d.status,
    source: "manual",
    notes: d.notes || null,
    ...(d.status !== "auto" ? { worked_minutes: 0, late_minutes: 0, overtime_minutes: 0, early_leave_minutes: 0, break_minutes: 0 } : {}),
  };
  const supabase = await createClient();
  const { error } = d.id
    ? await supabase.from("attendance_records").update(row).eq("id", d.id)
    : await supabase.from("attendance_records").upsert(row, { onConflict: "employee_id,work_date" });
  if (error) return { error: error.code === "42501" ? "You don't have permission to change time records." : friendly(error.message) };
  revalidatePath("/app/time");
  return { ok: true, message: "Saved." };
}

export async function clearFlag(id: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("attendance_records").update({ is_flagged: false }, { count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to change time records." };
  revalidatePath("/app/time");
  return { ok: true, message: "Marked as checked." };
}

const rosterCellSchema = z.object({
  employee_id: z.string().uuid(),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.union([z.literal(""), z.literal("rest"), z.string().uuid()]),
});

/** Set one person's shift for one day (a shift, a rest day, or nothing). */
export async function setRosterCell(input: unknown): Promise<ActionResult> {
  const active = await business();
  const parsed = rosterCellSchema.safeParse(input);
  if (!parsed.success) return { error: "That change isn't valid." };
  const { employee_id, work_date, value } = parsed.data;
  const supabase = await createClient();
  const { error } =
    value === ""
      ? await supabase.from("roster_entries").delete().eq("employee_id", employee_id).eq("work_date", work_date)
      : await supabase.from("roster_entries").upsert(
          { business_id: active.business_id, employee_id, work_date, shift_id: value === "rest" ? null : value, is_rest_day: value === "rest", published: false },
          { onConflict: "employee_id,work_date" },
        );
  if (error) return { error: error.code === "42501" ? "You don't have permission to change the roster." : friendly(error.message) };
  revalidatePath("/app/time/roster");
  return { ok: true };
}

/** Copy the previous week's roster into this week (only for empty days). */
export async function copyLastWeek(weekStart: string): Promise<ActionResult> {
  const active = await business();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { error: "Invalid week." };
  const start = new Date(`${weekStart}T00:00:00Z`);
  const prevStart = new Date(start.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const prevEnd = new Date(start.getTime() - 86400000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const [{ data: prev }, { data: current }] = await Promise.all([
    supabase.from("roster_entries").select("employee_id, work_date, shift_id, is_rest_day, branch_id").eq("business_id", active.business_id).gte("work_date", prevStart).lte("work_date", prevEnd),
    supabase
      .from("roster_entries")
      .select("employee_id, work_date")
      .eq("business_id", active.business_id)
      .gte("work_date", weekStart)
      .lte("work_date", new Date(start.getTime() + 6 * 86400000).toISOString().slice(0, 10)),
  ]);
  const taken = new Set((current ?? []).map((c) => `${c.employee_id}|${c.work_date}`));
  const rows = (prev ?? [])
    .map((p) => ({ ...p, work_date: new Date(new Date(`${p.work_date}T00:00:00Z`).getTime() + 7 * 86400000).toISOString().slice(0, 10) }))
    .filter((p) => !taken.has(`${p.employee_id}|${p.work_date}`))
    .map((p) => ({ ...p, business_id: active.business_id, published: false }));
  if (!rows.length) return { ok: true, message: "Nothing to copy." };
  const { error } = await supabase.from("roster_entries").insert(rows);
  if (error) return { error: error.code === "42501" ? "You don't have permission to change the roster." : friendly(error.message) };
  revalidatePath("/app/time/roster");
  return { ok: true, message: `Copied ${rows.length} shifts from last week.` };
}

/** Publish a week so staff see it in their app. */
export async function publishWeek(weekStart: string): Promise<ActionResult> {
  const active = await business();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return { error: "Invalid week." };
  const end = new Date(new Date(`${weekStart}T00:00:00Z`).getTime() + 6 * 86400000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("roster_entries")
    .update({ published: true }, { count: "exact" })
    .eq("business_id", active.business_id)
    .gte("work_date", weekStart)
    .lte("work_date", end)
    .eq("published", false);
  if (error) return { error: error.code === "42501" ? "You don't have permission to publish the roster." : friendly(error.message) };
  revalidatePath("/app/time/roster");
  return { ok: true, message: count ? `Published ${count} shifts. Staff can see them now.` : "Everything is already published." };
}

const periodSchema = z.object({ start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function buildTimesheets(input: unknown): Promise<ActionResult> {
  const active = await business();
  const parsed = periodSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a period." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("build_timesheets", { p_business: active.business_id, p_start: parsed.data.start, p_end: parsed.data.end });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app/time/timesheets");
  return { ok: true, message: `Timesheets ready for ${data} ${data === 1 ? "person" : "people"}.` };
}

export async function setTimesheetStatus(ids: string[], status: "approved" | "draft"): Promise<ActionResult> {
  const user = await requireUser();
  await business();
  if (!z.array(z.string().uuid()).min(1).max(1000).safeParse(ids).success) return { error: "Choose timesheets." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("timesheets")
    .update(status === "approved" ? { status, approved_by: user.id, approved_at: new Date().toISOString() } : { status, approved_by: null, approved_at: null }, { count: "exact" })
    .in("id", ids);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to approve timesheets." };
  revalidatePath("/app/time/timesheets");
  return { ok: true, message: status === "approved" ? `Approved ${count}.` : `Reopened ${count}.` };
}
