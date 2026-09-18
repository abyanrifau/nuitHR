"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { sendEmailsAfterResponse } from "@/lib/notifications/deliver";

/** Staff self-service. The database checks each change is for the person's own record. */

async function business() {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) throw new Error("No company selected.");
  return active;
}

const contactSchema = z.object({
  phone: z.string().trim().max(40).default(""),
  personal_email: z.union([z.literal(""), z.string().trim().email("Enter a valid email.")]).default(""),
  current_address: z.string().trim().max(500).default(""),
  permanent_address: z.string().trim().max(500).default(""),
});

export async function updateMyContact(_: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = contactSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_my_contact", {
    p_business: active.business_id,
    p_phone: d.phone,
    p_personal_email: d.personal_email,
    p_current_address: d.current_address,
    p_permanent_address: d.permanent_address,
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/staff/me");
  return { ok: true, message: "Saved." };
}

const emergencySchema = z.object({
  id: z
    .union([z.literal(""), z.string().uuid()])
    .transform((v) => v || null)
    .optional(),
  name: z.string().trim().min(1, "Enter a name.").max(120),
  relationship: z.string().trim().max(80).default(""),
  phone: z.string().trim().max(40).default(""),
  is_primary: z.coerce.boolean().optional(),
});

export async function saveMyEmergencyContact(_: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = emergencySchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_my_emergency_contact", {
    p_business: active.business_id,
    p_id: d.id ?? null,
    p_name: d.name,
    p_relationship: d.relationship,
    p_phone: d.phone,
    p_is_primary: d.is_primary ?? false,
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/staff/me");
  return { ok: true, message: "Contact saved." };
}

export async function deleteMyEmergencyContact(id: string): Promise<ActionResult> {
  const active = await business();
  if (!z.string().uuid().safeParse(id).success) return { error: "Contact not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_my_emergency_contact", { p_business: active.business_id, p_id: id });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/staff/me");
  return { ok: true, message: "Contact removed." };
}

const letterSchema = z.object({
  template_id: z.string().uuid("Choose which letter you need."),
  purpose: z.string().trim().min(3, "Say what it's for, for example a bank loan.").max(300),
  addressed_to: z.string().trim().max(300).optional(),
});

/** Ask HR for a letter. It goes through the company's approval steps. */
export async function askForLetter(_: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = letterSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_letter", {
    p_business: active.business_id,
    p_template: parsed.data.template_id,
    p_purpose: parsed.data.purpose,
    p_addressed_to: parsed.data.addressed_to || null,
  });
  if (error) return { error: friendly(error.message) };
  sendEmailsAfterResponse(active.business_id);
  revalidatePath("/staff/letters");
  revalidatePath("/staff/requests");
  return { ok: true, message: "Sent. You'll get a notification when it's ready." };
}

/** A short-lived private link to one of my files or letters. The storage rules check it's mine. */
export async function myFileLink(path: string): Promise<{ url?: string; error?: string }> {
  const active = await business();
  if (!path.startsWith(`${active.business_id}/`)) return { error: "You can't open this file." };
  const supabase = await createClient();
  const { data } = await supabase.storage.from("tenant-files").createSignedUrl(path, 120);
  return data ? { url: data.signedUrl } : { error: "You can't open this file." };
}
