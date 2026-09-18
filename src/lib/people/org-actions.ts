"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";

const opt = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optNum = (min: number, max: number) =>
  z
    .union([z.literal(""), z.coerce.number().min(min).max(max)])
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const SCHEMAS = {
  branches: z
    .object({
      name: z.string().trim().min(1, "Enter a name.").max(120),
      code: opt,
      address: opt,
      atoll_island: opt,
      phone: opt,
      latitude: optNum(-90, 90),
      longitude: optNum(-180, 180),
      geofence_radius_m: optNum(20, 20000),
      geofence_mode: z.enum(["off", "flag", "block"]).default("off"),
    })
    .refine((v) => v.geofence_mode === "off" || (v.latitude != null && v.longitude != null && v.geofence_radius_m != null), {
      message: "To check where people clock in, add the location's map position and a radius.",
      path: ["geofence_radius_m"],
    }),
  departments: z.object({
    name: z.string().trim().min(1, "Enter a name.").max(120),
    code: opt,
    parent_id: optUuid,
    branch_id: optUuid,
    head_employee_id: optUuid,
    cost_center: opt,
  }),
  positions: z.object({
    title: z.string().trim().min(1, "Enter a job title.").max(120),
    department_id: optUuid,
    grade: opt,
    description: opt,
  }),
} as const;

export type OrgKind = keyof typeof SCHEMAS;

function formToObject(form: FormData) {
  const o: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$")) o[k] = v;
  return o;
}

const NOUN: Record<OrgKind, string> = { branches: "Location", departments: "Department", positions: "Job title" };

export async function saveOrgItem(kind: OrgKind, id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const schema = SCHEMAS[kind];
  if (!schema) return { error: "Unknown item." };
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  if (kind === "departments" && id && (parsed.data as { parent_id?: string | null }).parent_id === id) {
    return { error: "A department can't sit inside itself.", fieldErrors: { parent_id: ["Choose another department."] } };
  }
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from(kind).update(parsed.data).eq("id", id).eq("business_id", active.business_id)
    : await supabase.from(kind).insert({ ...parsed.data, business_id: active.business_id });
  if (error) {
    if (error.code === "23505") return { error: `${NOUN[kind]} already exists with that name.` };
    if (error.code === "42501") return { error: "You don't have permission to change the company structure." };
    return { error: friendly(error.message) };
  }
  revalidatePath("/app/people/org-chart");
  return { ok: true, message: `${NOUN[kind]} saved.` };
}

/** Archive instead of delete when people are still linked, so nobody loses their details. */
export async function removeOrgItem(kind: OrgKind, id: string): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const supabase = await createClient();
  const col = { branches: "branch_id", departments: "department_id", positions: "position_id" }[kind];
  const { count } = await supabase.from("employees").select("id", { count: "exact", head: true }).eq("business_id", active.business_id).eq(col, id);
  if (count) {
    const { error } = await supabase.from(kind).update({ is_active: false }).eq("id", id);
    if (error) return { error: friendly(error.message) };
    revalidatePath("/app/people/org-chart");
    return { ok: true, message: `${count} ${count === 1 ? "person is" : "people are"} still linked, so it was archived instead. It no longer appears in lists.` };
  }
  const { error, count: removed } = await supabase.from(kind).delete({ count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!removed) return { error: "You don't have permission to remove this." };
  revalidatePath("/app/people/org-chart");
  return { ok: true, message: `${NOUN[kind]} removed.` };
}

export async function restoreOrgItem(kind: OrgKind, id: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from(kind).update({ is_active: true }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app/people/org-chart");
  return { ok: true, message: "Restored." };
}
