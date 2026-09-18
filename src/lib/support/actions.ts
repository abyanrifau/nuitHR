"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { emailLayout, escapeHtml, sendEmail } from "@/lib/email";
import { appConfig } from "@/config/app.config";

const ticketSchema = z.object({
  subject: z.string().trim().min(3, "Add a short subject.").max(160),
  category: z.enum(["question", "problem", "billing", "idea"]),
  message: z.string().trim().min(10, "Tell us a little more.").max(5000),
});

export async function createTicket(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = ticketSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .insert({ business_id: active.business_id, created_by: user.id, ...parsed.data })
    .select("id")
    .single();
  if (error) return { error: friendly(error.message) };
  const d = parsed.data;
  await sendEmail({
    to: appConfig.brand.supportEmail,
    subject: `[${d.category}] ${d.subject}`,
    text: `From ${user.email} at ${active.business_name}\nTicket ${data.id}\n\n${d.message}`,
    html: emailLayout(d.subject, `<p>From ${escapeHtml(user.email ?? "")} at ${escapeHtml(active.business_name)}<br>Ticket ${data.id}</p><p style="white-space:pre-wrap">${escapeHtml(d.message)}</p>`),
  });
  revalidatePath("/app/workspace/support");
  return { ok: true, message: "Sent. We'll reply by email, usually within one working day." };
}

const grantSchema = z.object({
  days: z.coerce.number().int().refine((d) => [1, 3, 7].includes(d), "Choose how long."),
  reason: z.string().trim().max(300).optional(),
});

/** Lets the support team into this company for a limited time. Only people with support access rights can do this. */
export async function grantSupportAccess(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = grantSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const expires = new Date(Date.now() + parsed.data.days * 86_400_000).toISOString();
  const { error } = await supabase.from("support_access_grants").insert({ business_id: active.business_id, granted_by: user.id, reason: parsed.data.reason || null, expires_at: expires });
  if (error) return { error: error.code === "42501" ? "Only the owner or an admin can let support in." : friendly(error.message) };
  revalidatePath("/app/workspace/support");
  return { ok: true, message: `Support can see your company for ${parsed.data.days} day${parsed.data.days === 1 ? "" : "s"}.` };
}

export async function revokeSupportAccess(id: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error, count } = await supabase.from("support_access_grants").update({ revoked_at: new Date().toISOString() }, { count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You can't change support access." };
  revalidatePath("/app/workspace/support");
  return { ok: true, message: "Support access ended." };
}
