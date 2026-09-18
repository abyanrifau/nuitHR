"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireUser, ACTIVE_BUSINESS_COOKIE, getActiveBusiness } from "@/lib/auth/session";
import { appConfig } from "@/config/app.config";
import { createInvitation } from "@/lib/invitations";
import { defaultRolesPayload } from "@/modules/roles";
import { CORE_MODULE_KEYS } from "@/modules/registry";
import { normalizeSelection } from "@/modules/selection";
import { EMPLOYEE_COUNT_RANGES } from "@/modules/pricing";
import { defaultSetup, isSetupModule, SETUP_SCHEMAS } from "@/modules/setup-defaults";
import { isComplete, SETUP_QUESTIONS } from "@/modules/setup-questions";
import type { Industry } from "@/modules/selection";
import { previewImport, type ImportRow } from "@/modules/employee-import";
import { getOnboardingState, saveDraft } from "./state";

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
// Screen 2: about your company
// ---------------------------------------------------------------------
const businessSchema = z.object({
  name: z.string().trim().min(2, "Enter your company name.").max(120),
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
  .refine((b) => b.length > 0, "Add at least one location.")
  .refine((b) => new Set(b.map((x) => x.name.toLowerCase())).size === b.length, "Each location needs a different name.");

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
  redirect("/onboarding/questions");
}

// ---------------------------------------------------------------------
// Screen 3: "Tell us how you work"
// ---------------------------------------------------------------------
const answersSchema = z.record(z.string(), z.string().max(40));

export async function saveAnswers(answers: Record<string, string>): Promise<ActionState> {
  const user = await requireUser("/onboarding");
  const state = await getOnboardingState();
  if (!state.businessId) redirect("/onboarding/company");
  const parsed = answersSchema.safeParse(answers);
  if (!parsed.success) return { error: "Please answer each question." };
  const known = Object.fromEntries(SETUP_QUESTIONS.map((q) => [q.key, parsed.data[q.key]]).filter(([, v]) => v)) as Record<string, string>;
  if (!isComplete(known)) return { error: "Please answer each question." };
  await saveDraft(user.id, { step: Math.max(4, state.currentStep), data: { answers: known } });
  redirect("/onboarding/tools");
}

// ---------------------------------------------------------------------
// Tools (setup screen 4, and Workspace → Tools)
// ---------------------------------------------------------------------
/** Sensible starting settings for tools that were just switched on (only if they have none yet). */
async function applyStarterSettings(businessId: string, turnedOn: string[]) {
  const supabase = await createClient();
  const { data: b } = await supabase.from("businesses").select("industry, country").eq("id", businessId).maybeSingle();
  if (!b) return;
  const ctx = { industry: b.industry as Industry, country: b.country };
  for (const key of ["employees", "leave", "attendance", "payroll"] as const) {
    if (key !== "employees" && !turnedOn.includes(key)) continue;
    if (key === "employees") {
      const { count } = await supabase.from("departments").select("id", { count: "exact", head: true }).eq("business_id", businessId);
      if (count) continue;
    }
    // Not marked "done": the setup checklist still asks the owner to check these.
    await supabase.rpc("apply_module_setup", { p_business: businessId, p_module: key, p_config: defaultSetup(key, ctx), p_mark_done: false });
  }
}

export async function saveModules(businessId: string, selected: string[]): Promise<ActionState & { enabled?: string[] }> {
  await requireUser();
  const modules = normalizeSelection(selected);
  const supabase = await createClient();
  const { data: newlyOn, error } = await supabase.rpc("set_business_modules", { p_business: businessId, p_enabled: modules });
  if (error) return { error: friendly(error.message) };
  await applyStarterSettings(businessId, (newlyOn as string[] | null) ?? []);
  revalidatePath("/app", "layout");
  return { message: "Tools saved.", enabled: modules };
}

export async function saveToolsStep(selected: string[]): Promise<ActionState> {
  const user = await requireUser("/onboarding");
  const state = await getOnboardingState();
  if (!state.businessId) redirect("/onboarding/company");
  const result = await saveModules(state.businessId, selected);
  if (result.error) return result;
  await saveDraft(user.id, { step: Math.max(5, state.currentStep) });
  redirect("/onboarding/invite");
}

/** Workspace → Tools → (tool): save a tool's settings. */
export async function saveToolSettings(module: string, config: unknown): Promise<ActionState> {
  await requireUser();
  if (!isSetupModule(module)) return { error: "This tool has no settings here." };
  const businessId = (await getActiveBusiness())?.business_id;
  if (!businessId) return { error: "No company selected." };
  const parsed = SETUP_SCHEMAS[module].safeParse(config);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { error: `Please check your entries: ${first.message}${first.path.length ? ` (${first.path.join(" › ")})` : ""}` };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_module_setup", { p_business: businessId, p_module: module, p_config: parsed.data });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app", "layout");
  return { message: "Saved." };
}

const claimTypeSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give each claim type a name.").max(60),
  key: z.enum(["transport", "meals", "travel", "supplies", "custom"]),
  cutoff_day: z.number().int().min(1).max(28).nullable(),
  max_amount: z.number().positive().nullable(),
  requires_receipt: z.boolean(),
  payout_method: z.enum(["payroll", "separate"]),
  is_active: z.boolean(),
});

/** Workspace → Tools → Claims: save claim types and their rules. */
export async function saveClaimTypes(types: unknown[]): Promise<ActionState> {
  await requireUser();
  const businessId = (await getActiveBusiness())?.business_id;
  if (!businessId) return { error: "No company selected." };
  const parsed = z.array(claimTypeSchema).min(1, "Keep at least one claim type.").max(40).safeParse(types);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const names = parsed.data.map((t) => t.name.toLowerCase());
  if (new Set(names).size !== names.length) return { error: "Each claim type needs a different name." };

  const supabase = await createClient();
  for (const [i, t] of parsed.data.entries()) {
    const { id, ...fields } = t;
    const row = { ...fields, sort: i + 1 };
    const { error } = id
      ? await supabase.from("claim_types").update(row).eq("id", id).eq("business_id", businessId)
      : await supabase.from("claim_types").insert({ ...row, business_id: businessId });
    if (error) return { error: friendly(error.message) };
  }
  await supabase
    .from("business_modules")
    .update({ setup_completed_at: new Date().toISOString() })
    .eq("business_id", businessId)
    .eq("module_key", "claims");
  revalidatePath("/app", "layout");
  return { message: "Claim types saved." };
}

// ---------------------------------------------------------------------
// Screen 5: invite people (email invites, add manually, or import)
// ---------------------------------------------------------------------
export interface InviteOutcome {
  name: string;
  email?: string;
  status: "added" | "invited" | "invite_link" | "error";
  detail?: string;
  link?: string;
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

/** Last screen: mark setup finished and open Home. */
export async function finishSetup(): Promise<void> {
  const user = await requireUser("/onboarding");
  const state = await getOnboardingState();
  if (!state.businessId) redirect("/onboarding/company");
  const supabase = await createClient();
  await supabase.from("businesses").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", state.businessId);
  await setActiveBusiness(state.businessId);
  await saveDraft(user.id, { step: 5, completed: true });
  redirect("/app?welcome=1");
}

/** Start setting up another company space. */
export async function startNewBusiness(): Promise<void> {
  const user = await requireUser("/onboarding");
  const supabase = await createClient();
  await supabase.from("onboarding_drafts").delete().eq("user_id", user.id);
  await saveDraft(user.id, { business_id: null, step: 2, data: { furthest: 2, skipped: [], answers: {} } });
  redirect("/onboarding/company");
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
