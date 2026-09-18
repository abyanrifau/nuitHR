"use server";

import { randomBytes, createHash } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser, ACTIVE_BUSINESS_COOKIE } from "@/lib/auth/session";
import { siteUrl } from "@/lib/env";
import { emailButton, emailLayout, escapeHtml, sendEmail } from "@/lib/email";
import { appConfig } from "@/config/app.config";
import { defaultRolesPayload } from "@/modules/roles";
import { CORE_MODULE_KEYS } from "@/modules/registry";
import { normalizeSelection } from "@/modules/selection";
import { EMPLOYEE_COUNT_RANGES } from "@/modules/pricing";
import { isSetupModule, SETUP_SCHEMAS } from "@/modules/setup-defaults";
import { previewImport, type ImportRow } from "@/modules/employee-import";
import { getOnboardingState, saveDraft, setupModulesFor, type DraftData } from "./state";

export interface ActionState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

function friendly(message: string): string {
  // Database errors are already written for people; strip technical prefixes.
  return message.replace(/^.*?ERROR:\s*/i, "").replace(/\s*\(SQLSTATE.*\)$/, "");
}

async function setActiveBusiness(businessId: string) {
  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

// ---------------------------------------------------------------------
// Step 2: business profile
// ---------------------------------------------------------------------
const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter your business name.").max(120),
  industry: z.enum(["resort", "guesthouse", "hotel", "restaurant", "retail", "office", "construction", "manufacturing", "other"], {
    message: "Choose your industry.",
  }),
  country: z.string().length(2, "Choose a country."),
  currency: z.string().length(3, "Choose a currency."),
  timezone: z.string().min(3, "Choose a time zone."),
  date_format: z.string().min(8),
  employee_count_range: z.enum(EMPLOYEE_COUNT_RANGES, { message: "Choose roughly how many employees you have." }),
  address: z.string().trim().max(300).optional(),
  registration_no: z.string().trim().max(60).optional(),
  tin: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email.")]).optional(),
});

const branchesSchema = z
  .array(z.object({ id: z.string().optional(), name: z.string().trim().max(80), atoll_island: z.string().trim().max(80).optional() }))
  .transform((b) => b.filter((x) => x.name))
  .refine((b) => b.length > 0, "Add at least one branch or location.")
  .refine((b) => new Set(b.map((x) => x.name.toLowerCase())).size === b.length, "Each branch needs a different name.");

const LOGO_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export async function saveBusinessStep(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser("/onboarding");
  const state = await getOnboardingState();
  const raw = Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
  const parsed = businessSchema.safeParse(raw);
  let branches: z.infer<typeof branchesSchema> | null = null;
  const branchResult = branchesSchema.safeParse(JSON.parse(raw.branches || "[]"));
  const fieldErrors: Record<string, string[] | undefined> = parsed.success ? {} : parsed.error.flatten().fieldErrors;
  if (branchResult.success) branches = branchResult.data;
  else fieldErrors.branches = branchResult.error.issues.map((i) => i.message);

  const logo = fd.get("logo");
  const logoFile = logo instanceof File && logo.size > 0 ? logo : null;
  if (logoFile && !LOGO_TYPES[logoFile.type]) fieldErrors.logo = ["Use a PNG, JPG or WebP image."];
  if (logoFile && logoFile.size > 2 * 1024 * 1024) fieldErrors.logo = ["The logo must be smaller than 2 MB."];

  if (!parsed.success || !branches || Object.keys(fieldErrors).length) {
    return { error: "Please check the highlighted fields.", fieldErrors };
  }

  const supabase = await createClient();
  const profile = parsed.data;
  let businessId = state.businessId;

  if (!businessId) {
    const { data, error } = await supabase.rpc("create_business", {
      p_business: { ...profile, trial_days: appConfig.trial.days },
      p_roles: defaultRolesPayload(),
      p_modules: CORE_MODULE_KEYS,
    });
    if (error) return { error: friendly(error.message) };
    businessId = data as string;
    await saveDraft(user.id, { business_id: businessId, step: 3 });
    await setActiveBusiness(businessId);
  }

  let logoPath: string | undefined;
  if (logoFile) {
    logoPath = `${businessId}/branding/logo-${Date.now()}.${LOGO_TYPES[logoFile.type]}`;
    const { error } = await supabase.storage.from("tenant-files").upload(logoPath, logoFile, { contentType: logoFile.type, upsert: false });
    if (error) return { error: `Your details were saved, but the logo couldn't be uploaded: ${error.message}` };
  }

  const { error } = await supabase.rpc("save_business_profile", {
    p_business: businessId,
    p_profile: { ...profile, ...(logoPath ? { logo_path: logoPath } : {}) },
    p_branches: branches,
  });
  if (error) return { error: friendly(error.message) };

  await saveDraft(user.id, { step: Math.max(3, state.currentStep) });
  redirect("/onboarding/modules");
}

// ---------------------------------------------------------------------
// Step 3: modules (also used by Settings → Modules)
// ---------------------------------------------------------------------
export async function saveModules(businessId: string, selected: string[]): Promise<ActionState & { enabled?: string[] }> {
  await requireUser();
  const modules = normalizeSelection(selected);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_business_modules", { p_business: businessId, p_enabled: modules });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app", "layout");
  return { message: "Modules saved.", enabled: modules };
}

export async function saveModulesStep(selected: string[]): Promise<ActionState> {
  const user = await requireUser("/onboarding");
  const state = await getOnboardingState();
  if (!state.businessId) redirect("/onboarding/business");
  const result = await saveModules(state.businessId, selected);
  if (result.error) return result;
  await saveDraft(user.id, { step: Math.max(4, state.currentStep) });
  const first = setupModulesFor(result.enabled as never)[0];
  redirect(first ? `/onboarding/setup/${first}` : "/onboarding/team");
}

// ---------------------------------------------------------------------
// Step 4: quick setup per module
// ---------------------------------------------------------------------
async function nextAfterSetup(module: string): Promise<string> {
  const state = await getOnboardingState();
  const list = setupModulesFor(state.modules);
  const idx = list.indexOf(module as never);
  return list[idx + 1] ? `/onboarding/setup/${list[idx + 1]}` : "/onboarding/team";
}

export async function saveSetupStep(module: string, config: unknown): Promise<ActionState> {
  const user = await requireUser("/onboarding");
  if (!isSetupModule(module)) return { error: "Unknown setup step." };
  const state = await getOnboardingState();
  if (!state.businessId) redirect("/onboarding/business");

  const parsed = SETUP_SCHEMAS[module].safeParse(config);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: `Please check your entries: ${first.message}${first.path.length ? ` (${first.path.join(" › ")})` : ""}` };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_module_setup", { p_business: state.businessId, p_module: module, p_config: parsed.data });
  if (error) return { error: friendly(error.message) };

  const skipped = (state.draft.skipped ?? []).filter((s) => s !== module);
  await saveDraft(user.id, { step: Math.max(4, state.currentStep), data: { skipped } });
  redirect(await nextAfterSetup(module));
}

export async function skipSetupStep(module: string): Promise<void> {
  const user = await requireUser("/onboarding");
  const state = await getOnboardingState();
  const skipped = [...new Set([...(state.draft.skipped ?? []), module])];
  await saveDraft(user.id, { step: Math.max(4, state.currentStep), data: { skipped } as DraftData });
  redirect(await nextAfterSetup(module));
}

// ---------------------------------------------------------------------
// Step 5: team (invite / add manually / import)
// ---------------------------------------------------------------------
export interface InviteOutcome {
  name: string;
  email?: string;
  status: "added" | "invited" | "invite_link" | "error";
  detail?: string;
  link?: string;
}

async function origin(): Promise<string> {
  return (await headers()).get("origin") ?? siteUrl();
}

/** Creates an invitation and emails it. Returns the link so it can also be shared by hand. */
async function createInvitation(opts: {
  businessId: string;
  businessName: string;
  email: string;
  roleId: string;
  roleName: string;
  employeeId?: string | null;
  inviterName: string;
}): Promise<{ link?: string; emailed: boolean; error?: string }> {
  const supabase = await createClient();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  // Cancel older pending invitations for the same person.
  await supabase
    .from("invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("business_id", opts.businessId)
    .ilike("email", opts.email)
    .is("accepted_at", null)
    .is("revoked_at", null);
  const { error } = await supabase.from("invitations").insert({
    business_id: opts.businessId,
    email: opts.email.toLowerCase(),
    role_id: opts.roleId,
    employee_id: opts.employeeId ?? null,
    token_hash: tokenHash,
  });
  if (error) return { emailed: false, error: friendly(error.message) };

  const link = `${await origin()}/invite/${token}`;
  const sent = await sendEmail({
    to: opts.email,
    subject: `You're invited to join ${opts.businessName} on ${appConfig.brand.name}`,
    text: `${opts.inviterName} invited you to join ${opts.businessName} on ${appConfig.brand.name} as ${opts.roleName}.\n\nAccept the invitation: ${link}\n\nThe link expires in 14 days.`,
    html: emailLayout(
      `Join ${opts.businessName}`,
      `<p>${escapeHtml(opts.inviterName)} invited you to join <strong>${escapeHtml(opts.businessName)}</strong> on ${escapeHtml(appConfig.brand.name)} as <strong>${escapeHtml(opts.roleName)}</strong>.</p>${emailButton(link, "Accept invitation")}<p style="font-size:13px;color:#5a6473">The link expires in 14 days. If you weren't expecting this, you can ignore this email.</p>`,
    ),
  });
  return { link, emailed: sent.ok, error: sent.ok ? undefined : sent.error };
}

const personSchema = z.object({
  first_name: z.string().trim().min(1, "First name is required."),
  last_name: z.string().trim().max(80).default(""),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email.")]).default(""),
  role_id: z.string().uuid("Choose a role."),
  department: z.string().trim().max(80).default(""),
  position: z.string().trim().max(80).default(""),
  add_as_employee: z.boolean().default(true),
  send_invite: z.boolean().default(true),
});

export async function addTeamMembers(businessId: string, people: unknown[]): Promise<{ error?: string; results?: InviteOutcome[] }> {
  const user = await requireUser();
  const supabase = await createClient();
  const parsed = z.array(personSchema).min(1, "Add at least one person.").max(100).safeParse(people);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const [{ data: business }, { data: roles }, { data: profile }] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", businessId).maybeSingle(),
    supabase.from("roles").select("id, name, is_owner").eq("business_id", businessId),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!business) return { error: "Business not found." };

  const results: InviteOutcome[] = [];
  for (const p of parsed.data) {
    const name = `${p.first_name} ${p.last_name}`.trim();
    const role = roles?.find((r) => r.id === p.role_id);
    if (!role) {
      results.push({ name, status: "error", detail: "That role doesn't exist." });
      continue;
    }
    let employeeId: string | null = null;
    if (p.add_as_employee) {
      const { data, error } = await supabase.rpc("import_employees", {
        p_business: businessId,
        p_rows: [{ first_name: p.first_name, last_name: p.last_name, work_email: p.email, department: p.department, position: p.position }],
      });
      if (error) {
        results.push({ name, email: p.email, status: "error", detail: friendly(error.message) });
        continue;
      }
      employeeId = (data as { id: string }[])[0]?.id ?? null;
    }
    if (p.email && p.send_invite) {
      const inv = await createInvitation({
        businessId,
        businessName: business.name,
        email: p.email,
        roleId: role.id,
        roleName: role.name,
        employeeId,
        inviterName: profile?.full_name || "Your manager",
      });
      if (!inv.link) results.push({ name, email: p.email, status: "error", detail: inv.error });
      else if (inv.emailed) results.push({ name, email: p.email, status: "invited", link: inv.link });
      else results.push({ name, email: p.email, status: "invite_link", link: inv.link, detail: inv.error });
    } else {
      results.push({ name, email: p.email || undefined, status: "added" });
    }
  }
  revalidatePath("/app", "layout");
  return { results };
}

export async function importEmployeesCsv(
  businessId: string,
  csvText: string,
  inviteRoleId: string | null,
): Promise<{ error?: string; imported?: number; invited?: InviteOutcome[] }> {
  const user = await requireUser();
  const supabase = await createClient();
  const [{ data: business }, { data: branches }, { data: existing }, { data: roles }, { data: profile }] = await Promise.all([
    supabase.from("businesses").select("name, country").eq("id", businessId).maybeSingle(),
    supabase.from("branches").select("name").eq("business_id", businessId).eq("is_active", true),
    supabase.from("employees").select("employee_code, work_email").eq("business_id", businessId),
    supabase.from("roles").select("id, name").eq("business_id", businessId),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!business) return { error: "Business not found." };

  // Check the file again on the server; never trust the browser's preview alone.
  const preview = previewImport(csvText, {
    branches: (branches ?? []).map((b) => b.name),
    existingCodes: (existing ?? []).map((e) => e.employee_code),
    existingEmails: (existing ?? []).map((e) => e.work_email).filter(Boolean) as string[],
    businessCountry: business.country,
  });
  if (preview.fileErrors.length || preview.errorCount > 0) {
    return { error: `Please fix ${preview.errorCount || "the"} problem(s) in the file and upload it again.` };
  }
  const rows: ImportRow[] = preview.rows.map((r) => r.data);
  const { data, error } = await supabase.rpc("import_employees", { p_business: businessId, p_rows: rows });
  if (error) return { error: friendly(error.message) };
  const created = data as { id: string; line: number }[];

  const invited: InviteOutcome[] = [];
  const role = roles?.find((r) => r.id === inviteRoleId);
  if (role) {
    for (const c of created) {
      const row = rows[c.line - 1];
      if (!row?.work_email) continue;
      const inv = await createInvitation({
        businessId,
        businessName: business.name,
        email: row.work_email,
        roleId: role.id,
        roleName: role.name,
        employeeId: c.id,
        inviterName: profile?.full_name || "Your manager",
      });
      invited.push({
        name: `${row.first_name} ${row.last_name}`.trim(),
        email: row.work_email,
        status: inv.emailed ? "invited" : inv.link ? "invite_link" : "error",
        link: inv.link,
        detail: inv.error,
      });
    }
  }
  revalidatePath("/app", "layout");
  return { imported: created.length, invited };
}

export async function finishTeamStep(): Promise<void> {
  const user = await requireUser("/onboarding");
  const state = await getOnboardingState();
  if (!state.businessId) redirect("/onboarding/business");
  const supabase = await createClient();
  await supabase.from("businesses").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", state.businessId);
  await saveDraft(user.id, { step: 6 });
  redirect("/onboarding/done");
}

/** Last screen: mark the wizard finished and open the dashboard. */
export async function completeOnboarding(): Promise<void> {
  const user = await requireUser("/onboarding");
  const state = await getOnboardingState();
  if (state.businessId) {
    await setActiveBusiness(state.businessId);
    await saveDraft(user.id, { step: 6, completed: true });
  }
  redirect("/app?welcome=1");
}

/** Start setting up an additional business. */
export async function startNewBusiness(): Promise<void> {
  const user = await requireUser("/onboarding");
  const supabase = await createClient();
  await supabase.from("onboarding_drafts").delete().eq("user_id", user.id);
  await saveDraft(user.id, { business_id: null, step: 2, data: { furthest: 2, skipped: [] } });
  redirect("/onboarding/business");
}

/** Used by the invitation page. */
export async function acceptInvitation(token: string): Promise<ActionState> {
  await requireUser(`/invite/${token}`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_invitation", { p_token: token });
  if (error) return { error: friendly(error.message) };
  await setActiveBusiness(data as string);
  redirect("/app");
}

