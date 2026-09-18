"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { emailLayout, escapeHtml, sendEmail } from "@/lib/email";
import { appConfig } from "@/config/app.config";

export async function markRead(ids: string[] | "all"): Promise<ActionResult> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const supabase = await createClient();
  let q = supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).eq("business_id", active.business_id).is("read_at", null);
  if (ids !== "all") {
    const parsed = z.array(z.string().uuid()).max(200).safeParse(ids);
    if (!parsed.success) return { error: "Invalid notifications." };
    q = q.in("id", parsed.data);
  }
  const { error } = await q;
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true };
}

/** Recent notifications for the bell (read on open, so the list is always fresh). */
export async function recentNotifications(): Promise<{ id: string; title: string; body: string | null; link: string | null; read: boolean; created_at: string }[]> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  if (!active) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, link, read_at, created_at")
    .eq("user_id", user.id)
    .eq("business_id", active.business_id)
    .order("created_at", { ascending: false })
    .limit(12);
  return (data ?? []).map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, read: Boolean(n.read_at), created_at: n.created_at }));
}

const prefSchema = z.array(z.object({ event_type: z.string().min(3).max(60), channel: z.enum(["in_app", "email"]), enabled: z.boolean() })).max(200);

/** Your own choices: which events reach you in the app and by email. */
export async function savePreferences(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = prefSchema.safeParse(input);
  if (!parsed.success) return { error: "Those settings aren't valid." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_preferences")
    .upsert(parsed.data.map((p) => ({ ...p, business_id: active.business_id, user_id: user.id, updated_at: new Date().toISOString() })), { onConflict: "business_id,user_id,event_type,channel" });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app/account");
  return { ok: true, message: "Notification settings saved." };
}

const channelSchema = z.object({
  channel: z.enum(["email", "sms", "whatsapp"]),
  enabled: z.boolean(),
  config: z.record(z.string(), z.string().max(200)).optional(),
});

/** Company-wide switch for each channel (settings editors only; the database checks). */
export async function saveChannel(input: unknown): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = channelSchema.safeParse(input);
  if (!parsed.success) return { error: "Those settings aren't valid." };
  if (parsed.data.channel !== "email" && parsed.data.enabled) return { error: "Text and WhatsApp messages aren't available yet." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_channels")
    .upsert({ business_id: active.business_id, channel: parsed.data.channel, enabled: parsed.data.enabled, config: parsed.data.config ?? {}, updated_at: new Date().toISOString() }, { onConflict: "business_id,channel" });
  if (error) return { error: error.code === "42501" ? "You don't have permission to change these settings." : friendly(error.message) };
  revalidatePath("/app/workspace/notifications");
  return { ok: true, message: "Saved." };
}

/** Sends a test email to yourself, so you know emails arrive. */
export async function sendTestEmail(): Promise<ActionResult> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  if (!user.email) return { error: "Your account has no email address." };
  const sent = await sendEmail({
    to: user.email,
    subject: `Test email from ${appConfig.brand.name}`,
    text: `This is a test from ${active.business_name}. If you can read this, emails are working.`,
    html: emailLayout("Emails are working", `<p>This is a test from ${escapeHtml(active.business_name)}. If you can read this, emails are working.</p>`),
  });
  const supabase = await createClient();
  // Email is on unless the company switched it off, so a first test creates the row switched on.
  const { data: row } = await supabase.from("notification_channels").select("channel").eq("business_id", active.business_id).eq("channel", "email").maybeSingle();
  const now = new Date().toISOString();
  if (row) await supabase.from("notification_channels").update({ last_tested_at: now }).eq("business_id", active.business_id).eq("channel", "email");
  else await supabase.from("notification_channels").insert({ business_id: active.business_id, channel: "email", enabled: true, last_tested_at: now });
  revalidatePath("/app/workspace/notifications");
  if (!sent.ok) return { error: `The email couldn't be sent: ${sent.error}` };
  return {
    ok: true,
    message: sent.provider === "console" ? "Test email written to the server log (email sending isn't set up on this computer)." : `Test email sent to ${user.email}. It can take a minute to arrive.`,
  };
}

const nameSchema = z.object({
  full_name: z.string().trim().min(2, "Enter your name.").max(120),
  phone: z.string().trim().max(40).optional(),
});

/** Your own name and phone, shown to colleagues and on requests. */
export async function saveMyProfile(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = nameSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ full_name: parsed.data.full_name, phone: parsed.data.phone || null }).eq("id", user.id);
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app/account");
  return { ok: true, message: "Saved." };
}
