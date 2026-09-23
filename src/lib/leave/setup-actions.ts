"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getActiveBusiness, requireUser, toAccessContext } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { maldivesHolidays } from "@/modules/data/holidays-mv";
import { can } from "@/modules/access";

async function business() {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) throw new Error("Choose a company first.");
  return active;
}

async function editor() {
  const active = await business();
  if (!can(toAccessContext(active), "leave", "edit", "all")) return { active, denied: "You don't have permission to change time off settings." };
  return { active, denied: null };
}

function refresh() {
  revalidatePath("/app/time-off", "layout");
  revalidatePath("/staff/time-off");
}

const flag = (form: FormData, name: string) => form.getAll(name).includes("true");
const int = (min: number, max: number) => z.coerce.number().int(`Use a whole number.`).min(min, `Use ${min} or more.`).max(max, `Use ${max} or less.`);
const optDays = z
  .union([z.literal(""), z.coerce.number().min(0.5, "Use at least half a day.").max(366)])
  .transform((v) => (v === "" ? null : v));
const optInt = (max: number) => z.union([z.literal(""), int(1, max)]).transform((v) => (v === "" ? null : v));
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const optDate = z.union([z.literal(""), date]).transform((v) => v || null);

const typeSchema = z
  .object({
    name: z.string().trim().min(2, "Give the type a name.").max(60),
    code: z
      .string()
      .trim()
      .min(1, "Add a short code, for example AL.")
      .max(6, "Up to 6 letters.")
      .regex(/^[A-Za-z0-9]+$/, "Letters and numbers only."),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour."),
    entitlement_mode: z.enum(["annual", "unlimited", "granted", "birthday"]),
    entitlement_days: z.coerce.number().min(0, "Can't be negative.").max(366),
    year_basis: z.enum(["calendar", "anniversary"]),
    notice_value: int(0, 10000),
    notice_unit: z.enum(["minutes", "hours", "days"]),
    eligible_after_value: int(0, 1000),
    eligible_after_unit: z.enum(["days", "months", "years"]),
    applies_to: z.enum(["all", "selected"]),
    gender_eligibility: z.enum(["any", "female", "male"]),
    min_days_per_request: optDays,
    max_days_per_request: optDays,
    max_consecutive_days: optInt(366),
    max_off_per_department: optInt(1000),
    document_rule: z.enum(["none", "always", "over_days"]),
    document_over_days: optDays,
    document_deadline_days: int(0, 60),
    birthday_window: z.enum(["month", "days_after"]),
    birthday_window_days: int(1, 366),
  })
  .refine((v) => v.document_rule !== "over_days" || v.document_over_days !== null, {
    message: "Say after how many days a document is needed.",
    path: ["document_over_days"],
  })
  .refine((v) => v.min_days_per_request === null || v.max_days_per_request === null || v.min_days_per_request <= v.max_days_per_request, {
    message: "The least can't be more than the most.",
    path: ["min_days_per_request"],
  });

const TARGETS = ["position", "department", "branch", "employee", "role"] as const;

/** Saves a type's rules and who it's for. New types go to their page afterwards. */
export async function saveLeaveType(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const { active, denied } = await editor();
  if (denied) return { error: denied };
  const parsed = typeSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const v = parsed.data;
  const targets = TARGETS.flatMap((t) =>
    form
      .getAll(`target_${t}`)
      .map(String)
      .filter((x) => /^[0-9a-f-]{36}$/i.test(x))
      .map((target_id) => ({ target_type: t, target_id })),
  );
  if (v.applies_to === "selected" && !targets.length) return { error: "Choose who this type is for, or set it to everyone." };
  const row = {
    ...v,
    code: v.code.toUpperCase(),
    entitlement_days: v.entitlement_mode === "unlimited" || v.entitlement_mode === "granted" ? 0 : v.entitlement_days,
    is_paid: flag(form, "is_paid"),
    allow_half_day: flag(form, "allow_half_day"),
    allow_after_the_fact: flag(form, "allow_after_the_fact"),
    allow_during_probation: flag(form, "allow_during_probation"),
    document_later_allowed: flag(form, "document_later_allowed"),
    document_over_days: v.document_rule === "over_days" ? v.document_over_days : null,
  };
  const supabase = await createClient();
  let typeId = id;
  if (id) {
    const { error } = await supabase.from("leave_types").update(row).eq("id", id).eq("business_id", active.business_id);
    if (error) return { error: error.code === "23505" ? "Another type already uses that name or code." : friendly(error.message) };
  } else {
    const { data: last } = await supabase.from("leave_types").select("sort").eq("business_id", active.business_id).order("sort", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await supabase
      .from("leave_types")
      .insert({ ...row, business_id: active.business_id, sort: (last?.sort ?? 0) + 1 })
      .select("id")
      .single();
    if (error) return { error: error.code === "23505" ? "Another type already uses that name or code." : friendly(error.message) };
    typeId = data.id;
  }
  // Who it's for: replace the list with what's ticked.
  await supabase.from("leave_type_targets").delete().eq("leave_type_id", typeId!).eq("business_id", active.business_id);
  if (v.applies_to === "selected") {
    const { error } = await supabase
      .from("leave_type_targets")
      .insert(targets.map((t) => ({ ...t, business_id: active.business_id, leave_type_id: typeId! })));
    if (error) return { error: friendly(error.message) };
  }
  refresh();
  if (!id) redirect(`/app/time-off/types/${typeId}?saved=1`);
  return { ok: true, message: "Rules saved. They apply to new requests from now on." };
}

/** Types in use can't be deleted (their history stays); they're switched off instead. */
export async function setLeaveTypeActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { active, denied } = await editor();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { error } = await supabase.from("leave_types").update({ is_active: isActive }).eq("id", id).eq("business_id", active.business_id);
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: isActive ? "Switched back on." : "Switched off. Nobody can ask for it now; past time off stays." };
}

const grantSchema = z
  .object({
    employee_id: z.string().uuid("Choose a person."),
    leave_type_id: z.string().uuid("Choose a type."),
    days: z.coerce
      .number()
      .min(0.5, "Give at least half a day.")
      .max(366)
      .refine((v) => Math.round(v * 2) === v * 2, "Use whole or half days."),
    reason: z.string().trim().min(3, "Add a reason.").max(300),
    starts_on: date,
    expires_on: optDate,
  })
  .refine((v) => !v.expires_on || v.expires_on >= v.starts_on, { message: "The expiry must be after the start.", path: ["expires_on"] });

/** Gives one person extra days of a type, with a reason and an optional expiry. */
export async function grantLeave(_: ActionResult, form: FormData): Promise<ActionResult> {
  const { active, denied } = await editor();
  if (denied) return { error: denied };
  const parsed = grantSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.from("leave_allocations").insert({ ...parsed.data, business_id: active.business_id });
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: "Days given. They can ask for them now." };
}

export async function deleteGrant(id: string): Promise<ActionResult> {
  const { active, denied } = await editor();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { error } = await supabase.from("leave_allocations").delete().eq("id", id).eq("business_id", active.business_id);
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: "Removed. Time off already asked for stays." };
}

const holidaySchema = z.object({
  name: z.string().trim().min(2, "Give the holiday a name.").max(100),
  holiday_date: date,
  branch_id: z.union([z.literal(""), z.string().uuid()]).transform((v) => v || null),
});

/** Changing holidays changes who's expected at work, so recent attendance is worked out again. */
async function afterHolidayChange(businessId: string, from: string) {
  const supabase = await createClient();
  await supabase.rpc("refresh_attendance_month", { p_business: businessId, p_month: `${from.slice(0, 7)}-01` });
  revalidatePath("/app/time", "layout");
}

export async function saveHoliday(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const { active, denied } = await editor();
  if (denied) return { error: denied };
  const parsed = holidaySchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const row = { ...parsed.data, is_optional: flag(form, "is_optional") };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("public_holidays").update(row).eq("id", id).eq("business_id", active.business_id)
    : await supabase.from("public_holidays").insert({ ...row, business_id: active.business_id, country: active.country ?? "MV" });
  if (error) return { error: error.code === "23505" ? "That holiday is already on that day." : friendly(error.message) };
  await afterHolidayChange(active.business_id, parsed.data.holiday_date);
  refresh();
  return { ok: true, message: id ? "Holiday saved." : "Holiday added." };
}

export async function deleteHoliday(id: string): Promise<ActionResult> {
  const { active, denied } = await editor();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { data, error } = await supabase.from("public_holidays").delete().eq("id", id).eq("business_id", active.business_id).select("holiday_date").maybeSingle();
  if (error) return { error: friendly(error.message) };
  if (data) await afterHolidayChange(active.business_id, data.holiday_date);
  refresh();
  return { ok: true, message: "Holiday deleted." };
}

/** Adds the Maldives public holidays for a year. Ones already there are left alone. */
export async function loadMaldivesHolidays(year: number): Promise<ActionResult> {
  const { active, denied } = await editor();
  if (denied) return { error: denied };
  const list = maldivesHolidays(year);
  if (!list.length) return { error: `The Maldives list for ${year} isn't ready yet. Add the days yourself.` };
  const supabase = await createClient();
  const { data: existing } = await supabase.from("public_holidays").select("holiday_date, name").eq("business_id", active.business_id).gte("holiday_date", `${year}-01-01`).lte("holiday_date", `${year}-12-31`);
  const have = new Set((existing ?? []).map((h) => `${h.holiday_date}|${h.name}`));
  const rows = list.filter((h) => !have.has(`${h.date}|${h.name}`)).map((h) => ({ business_id: active.business_id, name: h.name, holiday_date: h.date, country: "MV" }));
  if (rows.length) {
    const { error } = await supabase.from("public_holidays").insert(rows);
    if (error) return { error: friendly(error.message) };
    await afterHolidayChange(active.business_id, rows[0].holiday_date);
  }
  refresh();
  return { ok: true, message: rows.length ? `${rows.length} holidays added for ${year}. Check the moon-based dates when they're announced.` : `All of ${year}'s holidays are already there.` };
}

const eventSchema = z
  .object({
    title: z.string().trim().min(2, "Give it a title.").max(100),
    kind: z.enum(["event", "blackout"]),
    start_date: date,
    end_date: date,
    branch_id: z.union([z.literal(""), z.string().uuid()]).transform((v) => v || null),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.end_date >= v.start_date, { message: "The last day must be on or after the first day.", path: ["end_date"] });

/** Company events and blackout dates (when time off can't be taken) on the calendar. */
export async function saveCompanyEvent(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const { active, denied } = await editor();
  if (denied) return { error: denied };
  const parsed = eventSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const types = form
    .getAll("leave_type_ids")
    .map(String)
    .filter((x) => /^[0-9a-f-]{36}$/i.test(x));
  const row = { ...parsed.data, notes: parsed.data.notes || null, leave_type_ids: parsed.data.kind === "blackout" && types.length ? types : null };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("company_events").update(row).eq("id", id).eq("business_id", active.business_id)
    : await supabase.from("company_events").insert({ ...row, business_id: active.business_id });
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: parsed.data.kind === "blackout" ? "Blackout dates saved. New requests on those days are refused." : "Event saved." };
}

export async function deleteCompanyEvent(id: string): Promise<ActionResult> {
  const { active, denied } = await editor();
  if (denied) return { error: denied };
  const supabase = await createClient();
  const { error } = await supabase.from("company_events").delete().eq("id", id).eq("business_id", active.business_id);
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: "Deleted." };
}
