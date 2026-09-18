"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { today } from "@/lib/format";

async function business() {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) throw new Error("No company selected.");
  return active;
}

const date = z
  .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
  .optional()
  .transform((v) => v || null);

const itemSchema = z.object({
  employee_id: z.string().uuid("Choose a person."),
  type_id: z.string().uuid("Choose what it is."),
  reference_no: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  issued_on: date,
  expires_on: date,
  issuing_authority: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((v) => v || null),
  renewal_status: z.enum(["none", "in_progress", "renewed", "not_renewing"]).default("none"),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null),
});

/** Add or update a permit, passport, visa or similar. Extra fields (like permit number or deposit) come as details.* */
export async function saveItem(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const raw = Object.fromEntries(form.entries()) as Record<string, string>;
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const details: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (k.startsWith("details.") && v.trim()) details[k.slice(8)] = v.trim().slice(0, 200);
  const row = { ...parsed.data, details };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("compliance_items").update(row).eq("id", id) : await supabase.from("compliance_items").insert({ ...row, business_id: active.business_id });
  if (error) return { error: error.code === "42501" ? "You don't have permission to change permits." : friendly(error.message) };
  // A new expiry date means reminders start again.
  if (id) await supabase.from("compliance_reminders").delete().eq("item_id", id);
  revalidatePath("/app/permits");
  return { ok: true, message: "Saved." };
}

/** Renewed: record the new expiry, keep the old one as history. */
export async function renewItem(id: string, newExpiry: string, reference?: string): Promise<ActionResult> {
  const active = await business();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newExpiry)) return { error: "Choose the new expiry date." };
  const supabase = await createClient();
  const { data: old } = await supabase.from("compliance_items").select("*").eq("id", id).maybeSingle();
  if (!old) return { error: "Not found." };
  const { error } = await supabase.from("compliance_items").insert({
    business_id: active.business_id,
    employee_id: old.employee_id,
    type_id: old.type_id,
    reference_no: reference?.trim() || old.reference_no,
    issuing_authority: old.issuing_authority,
    details: old.details,
    issued_on: today(active.timezone),
    expires_on: newExpiry,
  });
  if (error) return { error: error.code === "42501" ? "You don't have permission to change permits." : friendly(error.message) };
  await supabase.from("compliance_items").update({ renewal_status: "renewed", is_archived: true }).eq("id", id);
  revalidatePath("/app/permits");
  return { ok: true, message: "Renewed." };
}

export async function archiveItem(id: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("compliance_items").update({ is_archived: true }, { count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to change permits." };
  revalidatePath("/app/permits");
  return { ok: true, message: "Moved to history." };
}
