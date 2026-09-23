"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";

const opt = (max = 300) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

const detailsSchema = z.object({
  name: z.string().trim().min(2, "Enter your company name.").max(120),
  industry: z.enum(["resort", "guesthouse", "hotel", "restaurant", "retail", "office", "construction", "manufacturing", "other"]),
  country: z.string().trim().length(2),
  currency: z.string().trim().length(3, "Use a 3-letter currency code, for example MVR."),
  timezone: z.string().trim().min(3).max(60),
  date_format: z.enum(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"]),
  week_start: z.coerce.number().int().min(0).max(6),
  working_days: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Choose at least one working day."),
  address: opt(),
  registration_no: opt(60),
  tin: opt(60),
  phone: opt(40),
  email: z
    .union([z.literal(""), z.string().trim().email("Enter a valid email.")])
    .transform((v) => v || null)
    .optional(),
  website: opt(200),
});

export async function saveCompanyDetails(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const raw = Object.fromEntries([...form.entries()].filter(([k]) => k !== "working_days"));
  const parsed = detailsSchema.safeParse({ ...raw, working_days: form.getAll("working_days") });
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error, count } = await supabase.from("businesses").update(parsed.data, { count: "exact" }).eq("id", active.business_id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to change company settings." };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Company details saved." };
}

const letterheadSchema = z.object({
  signatory_name: opt(120),
  signatory_title: opt(120),
  letterhead_footer: opt(300),
});

export async function saveLetterhead(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = letterheadSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error, count } = await supabase.from("businesses").update(parsed.data, { count: "exact" }).eq("id", active.business_id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to change company settings." };
  revalidatePath("/app/workspace/company");
  return { ok: true, message: "Letterhead saved." };
}

const IMAGE_COLUMNS = { logo: "logo_path", signature: "signature_path", stamp: "stamp_path" } as const;

/** Saves an image the browser already uploaded to the branding folder (or clears it). */
export async function setBrandingImage(kind: keyof typeof IMAGE_COLUMNS, path: string | null): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const column = IMAGE_COLUMNS[kind];
  if (!column) return { error: "Unknown image." };
  if (path && !path.startsWith(`${active.business_id}/branding/`)) return { error: "That image is in the wrong folder." };
  const supabase = await createClient();
  const { data: before } = await supabase.from("businesses").select(column).eq("id", active.business_id).single();
  const { error, count } = await supabase.from("businesses").update({ [column]: path }, { count: "exact" }).eq("id", active.business_id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to change branding." };
  const old = (before as Record<string, string | null> | null)?.[column];
  if (old && old !== path) await supabase.storage.from("tenant-files").remove([old]);
  revalidatePath("/app", "layout");
  return { ok: true, message: path ? "Image saved." : "Image removed." };
}

/** Switches the Celebrations card on Home on or off for everyone in the company. */
export async function setCelebrationsEnabled(enabled: boolean): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "Choose a company first." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("businesses").update({ celebrations_enabled: enabled }).eq("id", active.business_id).select("id");
  if (error) return { error: friendly(error.message) };
  if (!data?.length) return { error: "Only people who can change company settings can do this." };
  revalidatePath("/", "layout");
  return { ok: true, message: enabled ? "Celebrations are on." : "Celebrations are off." };
}
