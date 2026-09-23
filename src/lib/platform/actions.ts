"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { appConfig } from "@/config/app.config";
import { ACTIVE_BUSINESS_COOKIE, SUPPORT_COOKIE } from "@/lib/auth/session";
import { emailButton, emailLayout, emailParagraphs, sendEmail } from "@/lib/email";
import type { ActionResult } from "@/lib/errors";
import { endOfDayIn, formatDate } from "@/lib/format";
import { siteUrl } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { CORE_MODULE_KEYS, MODULE_MAP } from "@/modules/registry";
import { suspendedEmail } from "./billing-emails";
import { logAdminAction } from "./data";
import { platformAdminEmails, requirePlatformAdmin } from "./guard";

/**
 * Platform admin actions. Every one checks, on the server, that the caller is
 * a platform admin with two-step sign-in (anyone else gets "not found"), then
 * records who did what, to which company, why, and the before and after values.
 */

const PLAN_FIELDS = "id, name, timezone, plan_status, trial_ends_at, paid_until, custom_monthly_price, discount_percent, price_override_until";
const reason = z.string().trim().min(3, "Give a short reason (it goes in the admin log).").max(500);
const id = z.string().uuid();

async function loadBusiness(businessId: string) {
  const { data } = await createAdminClient().from("businesses").select(PLAN_FIELDS).eq("id", businessId).maybeSingle();
  if (!data) throw new Error("Company not found.");
  return data;
}

async function updatePlan(businessId: string, patch: Record<string, unknown>) {
  const { error } = await createAdminClient().from("businesses").update(patch).eq("id", businessId);
  if (error) throw new Error(error.message);
}

function done(businessId: string, message: string): ActionResult {
  revalidatePath(`/admin/businesses/${businessId}`);
  revalidatePath("/admin/businesses");
  revalidatePath("/admin");
  return { ok: true, message };
}

/** The last moment of a calendar day in the company's time zone, so it displays as that day. */
const lastMomentOf = (day: string, tz: string) => new Date(new Date(endOfDayIn(day, tz)).getTime() - 1000).toISOString();

const pick = (b: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, b[k] ?? null]));
const later = (a: string | null) => (a && new Date(a) > new Date() ? new Date(a) : new Date());
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
function addMonths(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

// ---------------------------------------------------------------------
// Trial and subscription dates
// ---------------------------------------------------------------------
const extendSchema = z.object({
  businessId: id,
  mode: z.enum(["by", "to"]),
  amount: z.coerce.number().int().min(1).max(365).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reason,
});

export async function extendTrial(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = extendSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const b = await loadBusiness(d.businessId);
  let until: string;
  if (d.mode === "by") {
    if (!d.amount) return { error: "Enter how many days." };
    until = addDays(later(b.trial_ends_at), d.amount).toISOString();
  } else {
    if (!d.date) return { error: "Choose the date." };
    until = lastMomentOf(d.date, b.timezone);
  }
  const before = pick(b, ["plan_status", "trial_ends_at"]);
  const after = { plan_status: "trial", trial_ends_at: until };
  await updatePlan(b.id, after);
  await logAdminAction(admin, { action: "trial.extend", businessId: b.id, businessName: b.name, reason: d.reason, before, after });
  return done(b.id, `Trial now ends ${formatDate(until, "DD/MM/YYYY", b.timezone)}.`);
}

export async function extendSubscription(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = extendSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const b = await loadBusiness(d.businessId);
  let until: string;
  if (d.mode === "by") {
    if (!d.amount || d.amount > 36) return { error: "Enter 1 to 36 months." };
    until = addMonths(later(b.paid_until), d.amount).toISOString();
  } else {
    if (!d.date) return { error: "Choose the date." };
    until = lastMomentOf(d.date, b.timezone);
  }
  const before = pick(b, ["plan_status", "paid_until"]);
  const after = { plan_status: "active", paid_until: until };
  await updatePlan(b.id, after);
  await logAdminAction(admin, { action: "subscription.extend", businessId: b.id, businessName: b.name, reason: d.reason, before, after });
  return done(b.id, `Paid until ${formatDate(until, "DD/MM/YYYY", b.timezone)}.`);
}

// ---------------------------------------------------------------------
// Plan status (includes suspend and reactivate)
// ---------------------------------------------------------------------
const statusSchema = z.object({ businessId: id, status: z.enum(["trial", "active", "suspended", "cancelled", "reactivate"]), reason });

export async function setPlanStatus(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = statusSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const b = await loadBusiness(d.businessId);
  // Reactivate: back to a trial if the trial is still running, otherwise active.
  const status = d.status === "reactivate" ? (b.trial_ends_at && new Date(b.trial_ends_at) > new Date() && !b.paid_until ? "trial" : "active") : d.status;
  const before = pick(b, ["plan_status"]);
  const after = { plan_status: status };
  await updatePlan(b.id, after);
  await logAdminAction(admin, { action: "status.change", businessId: b.id, businessName: b.name, reason: d.reason, before, after });
  // A suspension email goes out straight away.
  if (status === "suspended") await emailOwners(b.id, suspendedEmail(b.name));
  return done(b.id, d.status === "reactivate" ? "Reactivated." : status === "suspended" ? "Suspended. They're read-only now and have been emailed." : "Status changed.");
}

// ---------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------
const toolsSchema = z.object({ businessId: id, modules: z.array(z.string()).max(40), reason });

export async function setTools(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = toolsSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const b = await loadBusiness(d.businessId);
  const wanted = [...new Set([...CORE_MODULE_KEYS, ...d.modules.filter((m) => m in MODULE_MAP)])];
  const db = createAdminClient();
  const { data: current } = await db.from("business_modules").select("module_key").eq("business_id", b.id).eq("enabled", true);
  const { error } = await db.rpc("set_business_modules", { p_business: b.id, p_enabled: wanted });
  if (error) return { error: error.message };
  await logAdminAction(admin, {
    action: "tools.change",
    businessId: b.id,
    businessName: b.name,
    reason: d.reason,
    before: { tools: (current ?? []).map((m) => m.module_key).sort() },
    after: { tools: wanted.sort() },
  });
  return done(b.id, "Tools updated.");
}

// ---------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------
const priceSchema = z.object({
  businessId: id,
  kind: z.enum(["standard", "custom", "discount"]),
  customPrice: z.coerce.number().min(0).max(10_000_000).optional(),
  discount: z.coerce.number().min(0).max(100).optional(),
  until: z
    .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)])
    .optional()
    .transform((v) => v || null),
  reason,
});

export async function setPrice(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = priceSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const b = await loadBusiness(d.businessId);
  if (d.kind === "custom" && d.customPrice == null) return { error: "Enter the monthly price." };
  if (d.kind === "discount" && d.discount == null) return { error: "Enter the discount." };
  const after = {
    custom_monthly_price: d.kind === "custom" ? d.customPrice : null,
    discount_percent: d.kind === "discount" ? d.discount : null,
    price_override_until: d.kind === "standard" ? null : d.until,
  };
  const before = pick(b, ["custom_monthly_price", "discount_percent", "price_override_until"]);
  await updatePlan(b.id, after);
  await logAdminAction(admin, { action: "price.change", businessId: b.id, businessName: b.name, reason: d.reason, before, after });
  return done(b.id, "Price saved.");
}

// ---------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------
const paymentSchema = z.object({
  businessId: id,
  amount: z.coerce.number().positive("Enter the amount.").max(10_000_000),
  paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it was paid."),
  method: z.enum(["bank_transfer", "mobile_payment", "cash", "other"]),
  reference: z.string().trim().max(120).optional(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose when the period starts."),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose when the period ends."),
  notes: z.string().trim().max(1000).optional(),
});
const RECEIPT_TYPES: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** Records a payment and moves their paid-until date to the end of the period it covers. */
export async function recordPayment(_: ActionResult, form: FormData): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = paymentSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  if (d.period_end < d.period_start) return { error: "The period ends before it starts." };
  const b = await loadBusiness(d.businessId);
  const db = createAdminClient();

  let receiptPath: string | null = null;
  const file = form.get("receipt");
  if (file instanceof File && file.size > 0) {
    if (file.size > 2.5 * 1024 * 1024) return { error: "The receipt must be smaller than 2.5 MB." };
    const ext = RECEIPT_TYPES[file.type];
    if (!ext) return { error: "The receipt must be a PDF, JPG or PNG." };
    receiptPath = `${b.id}/billing/${crypto.randomUUID()}.${ext}`;
    const { error } = await db.storage.from("tenant-files").upload(receiptPath, file, { contentType: file.type });
    if (error) return { error: "The receipt didn't upload. Try again." };
  }

  const row = {
    business_id: b.id,
    amount: d.amount,
    currency: "MVR",
    paid_on: d.paid_on,
    method: d.method,
    reference: d.reference || null,
    receipt_path: receiptPath,
    period_start: d.period_start,
    period_end: d.period_end,
    notes: d.notes || null,
    recorded_by: admin.email,
  };
  const { error } = await db.from("platform_payments").insert(row);
  if (error) {
    if (receiptPath) await db.storage.from("tenant-files").remove([receiptPath]);
    return { error: error.message };
  }
  // Paid until the end of the covered period, never earlier than it already was.
  const periodEnd = lastMomentOf(d.period_end, b.timezone);
  const until = b.paid_until && new Date(b.paid_until) > new Date(periodEnd) ? b.paid_until : periodEnd;
  const before = pick(b, ["plan_status", "paid_until"]);
  const after = { plan_status: "active", paid_until: until };
  await updatePlan(b.id, after);
  await logAdminAction(admin, { action: "payment.record", businessId: b.id, businessName: b.name, reason: d.notes || null, before, after: { ...after, payment: row } });
  return done(b.id, `Payment recorded. Paid until ${formatDate(until, "DD/MM/YYYY", b.timezone)}.`);
}

export async function receiptLink(paymentId: string): Promise<ActionResult & { url?: string }> {
  await requirePlatformAdmin();
  const db = createAdminClient();
  const { data } = await db.from("platform_payments").select("receipt_path").eq("id", paymentId).maybeSingle();
  if (!data?.receipt_path) return { error: "No receipt for this payment." };
  const { data: signed } = await db.storage.from("tenant-files").createSignedUrl(data.receipt_path, 300);
  return signed ? { ok: true, url: signed.signedUrl } : { error: "Couldn't open the receipt." };
}

// ---------------------------------------------------------------------
// Emails
// ---------------------------------------------------------------------
async function ownerEmails(businessId: string): Promise<string[]> {
  const { data } = await createAdminClient().rpc("admin_business_detail", { p_business: businessId });
  const admins = ((data as { admins?: { email: string; is_owner: boolean }[] } | null)?.admins ?? []).filter((a) => a.is_owner && a.email);
  return admins.map((a) => a.email);
}

async function emailOwners(businessId: string, msg: { subject: string; text: string; html: string }) {
  const to = await ownerEmails(businessId);
  for (const email of to) await sendEmail({ to: email, ...msg });
  return to;
}

function billingLink() {
  return `${siteUrl()}/app/workspace/billing`;
}

const reminderSchema = z.object({
  businessId: id,
  kind: z.enum(["trial_ending", "payment_due", "custom"]),
  message: z.string().trim().max(2000).optional(),
});

export async function sendReminder(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = reminderSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const b = await loadBusiness(d.businessId);
  if (d.kind === "custom" && !d.message) return { error: "Write the message." };
  const ends = d.kind === "trial_ending" ? b.trial_ends_at : b.paid_until;
  const when = ends ? formatDate(ends, "DD/MM/YYYY", b.timezone) : null;
  const subject =
    d.kind === "trial_ending"
      ? `Your ${appConfig.brand.name} trial ${when ? `ends on ${when}` : "is ending"}`
      : d.kind === "payment_due"
        ? `Your ${appConfig.brand.name} payment is due`
        : `A message about your ${appConfig.brand.name} account`;
  const body =
    d.kind === "custom"
      ? d.message!
      : `${d.kind === "trial_ending" ? `The free trial for ${b.name}` : `The paid period for ${b.name}`}${when ? ` ends on ${when}` : " is ending"}. To keep using ${appConfig.brand.name}, pay by bank transfer or mobile payment and send us the receipt. Payment details are in Workspace, Billing.${d.message ? `\n\n${d.message}` : ""}`;
  const to = await emailOwners(b.id, {
    subject,
    text: `${body}\n\n${billingLink()}`,
    html: emailLayout(subject, `${emailParagraphs(body)}${emailButton(billingLink(), "See billing details")}`, { preheader: body.slice(0, 120) }),
  });
  if (!to.length) return { error: "This company has no owner email to send to." };
  await logAdminAction(admin, { action: "email.reminder", businessId: b.id, businessName: b.name, reason: d.kind, after: { to, subject, body } });
  return done(b.id, `Sent to ${to.join(", ")}.`);
}

// ---------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------
const noteSchema = z.object({ businessId: id, body: z.string().trim().min(1, "Write the note.").max(4000) });

export async function addNote(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = noteSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const b = await loadBusiness(p.data.businessId);
  const { error } = await createAdminClient().from("platform_admin_notes").insert({ business_id: b.id, author: admin.email, body: p.data.body });
  if (error) return { error: error.message };
  await logAdminAction(admin, { action: "note.add", businessId: b.id, businessName: b.name, after: { body: p.data.body } });
  return done(b.id, "Note added.");
}

// ---------------------------------------------------------------------
// Support access
// ---------------------------------------------------------------------
const supportSchema = z.object({ businessId: id, reason });

/** Opens the company's workspace read-only, only while the company has support access switched on. */
export async function openAsSupport(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = supportSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const b = await loadBusiness(p.data.businessId);
  const { data: grant } = await createAdminClient()
    .from("support_access_grants")
    .select("expires_at")
    .eq("business_id", b.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!grant) return { error: "This company hasn't turned on support access, or it has expired." };
  await logAdminAction(admin, { action: "support.enter", businessId: b.id, businessName: b.name, reason: p.data.reason, after: { support_until: grant.expires_at } });
  const jar = await cookies();
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 8 };
  jar.set(SUPPORT_COOKIE, b.id, opts);
  jar.set(ACTIVE_BUSINESS_COOKIE, b.id, opts);
  redirect("/app");
}

export async function leaveSupport(): Promise<void> {
  const jar = await cookies();
  jar.delete(SUPPORT_COOKIE);
  jar.delete(ACTIVE_BUSINESS_COOKIE);
  redirect("/admin");
}

// ---------------------------------------------------------------------
// Deleting (permanent, for test companies and accounts)
// ---------------------------------------------------------------------
/** Every stored file under a folder (company files by default, or profile pictures). */
async function filesUnder(prefix: string, bucket: "tenant-files" | "avatars" = "tenant-files"): Promise<string[]> {
  const db = createAdminClient();
  const out: string[] = [];
  const walk = async (path: string) => {
    const { data } = await db.storage.from(bucket).list(path, { limit: 1000 });
    for (const entry of data ?? []) {
      const child = `${path}/${entry.name}`;
      if (entry.id) out.push(child);
      else await walk(child);
    }
  };
  await walk(prefix);
  return out;
}

const deleteBusinessSchema = z.object({ businessId: id, confirmName: z.string().trim().min(1), reason });

/** Deletes a company and everything in it. Cannot be undone. */
export async function deleteBusiness(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = deleteBusinessSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  const b = await loadBusiness(d.businessId);
  if (d.confirmName.toLowerCase() !== b.name.toLowerCase()) return { error: `Type the company name exactly (${b.name}) to confirm.` };
  const db = createAdminClient();
  const { data: before } = await db.from("businesses").select("id, name, slug, created_at, plan_status, paid_until, trial_ends_at").eq("id", b.id).single();
  const { count: staff } = await db.from("employees").select("id", { count: "exact", head: true }).eq("business_id", b.id);
  // Log first: the log keeps the company name after the company is gone.
  await logAdminAction(admin, {
    action: "business.delete",
    businessId: b.id,
    businessName: b.name,
    reason: d.reason,
    before: { ...before, staff_count: staff ?? 0 },
    after: null,
  });
  const [files, pictures] = await Promise.all([filesUnder(b.id), filesUnder(b.id, "avatars")]);
  if (files.length) await db.storage.from("tenant-files").remove(files);
  if (pictures.length) await db.storage.from("avatars").remove(pictures);
  const { error } = await db.from("businesses").delete().eq("id", b.id);
  if (error) return { error: error.message };
  revalidatePath("/admin/businesses");
  revalidatePath("/admin");
  return { ok: true, message: `${b.name} deleted, with ${staff ?? 0} staff records and ${files.length} files.` };
}

const deleteAccountSchema = z.object({ userId: id, confirmEmail: z.string().trim().email(), reason });

/** Deletes a login. Refused if they're the only owner of a company (delete that company first). */
export async function deleteAccount(input: unknown): Promise<ActionResult> {
  const admin = await requirePlatformAdmin();
  const p = deleteAccountSchema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  if (d.userId === admin.id) return { error: "You can't delete the account you're signed in with." };
  const db = createAdminClient();
  const { data: user, error: findErr } = await db.auth.admin.getUserById(d.userId);
  if (findErr || !user?.user?.email) return { error: "That account no longer exists." };
  const email = user.user.email;
  if (d.confirmEmail.toLowerCase() !== email.toLowerCase()) return { error: `Type the email exactly (${email}) to confirm.` };
  if (platformAdminEmails().includes(email.toLowerCase())) {
    return { error: "That's a Harbor admin account. Take the email out of PLATFORM_ADMIN_EMAILS on Vercel first." };
  }

  // Companies where this account is the only owner must go first.
  const { data: memberships } = await db.from("business_members").select("business_id, status, businesses(name), roles(is_owner)").eq("user_id", d.userId);
  const rows = (memberships ?? []) as unknown as { business_id: string; status: string; businesses: { name: string } | null; roles: { is_owner: boolean } | null }[];
  const blocking: string[] = [];
  for (const m of rows) {
    if (!m.roles?.is_owner) continue;
    const { count } = await db
      .from("business_members")
      .select("id, roles!inner(is_owner)", { count: "exact", head: true })
      .eq("business_id", m.business_id)
      .eq("status", "active")
      .eq("roles.is_owner", true)
      .neq("user_id", d.userId);
    if (!count) blocking.push(m.businesses?.name ?? "a company");
  }
  if (blocking.length) {
    return {
      error: `This account is the only owner of ${blocking.join(", ")}. Delete ${blocking.length === 1 ? "that company" : "those companies"} first, or make someone else the owner.`,
    };
  }

  await logAdminAction(admin, {
    action: "account.delete",
    reason: d.reason,
    before: { email, name: user.user.user_metadata?.full_name ?? null, companies: rows.map((m) => m.businesses?.name).filter(Boolean) },
    after: null,
  });
  const { error } = await db.auth.admin.deleteUser(d.userId);
  if (error) return { error: error.message };
  const pictures = await filesUnder(`users/${d.userId}`, "avatars");
  if (pictures.length) await db.storage.from("avatars").remove(pictures);
  revalidatePath("/admin/accounts");
  revalidatePath("/admin/businesses");
  return { ok: true, message: `${email} deleted.` };
}
