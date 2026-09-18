"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { createInvitation } from "@/lib/invitations";
import { friendly, type ActionResult } from "@/lib/errors";

// Empty form fields become null so optional columns are cleared, not set to "".
const opt = z
  .string()
  .trim()
  .max(500)
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optDate = z
  .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.")])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optEmail = z
  .union([z.literal(""), z.string().trim().toLowerCase().email("Enter a valid email.")])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();
const optUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .optional();

/** Each profile tab saves its own group of fields, so one tab can never wipe another. */
const SECTIONS = {
  personal: z.object({
    first_name: z.string().trim().min(1, "First name is required.").max(80),
    last_name: z.string().trim().max(80).default(""),
    preferred_name: opt,
    gender: z.union([z.literal(""), z.enum(["female", "male", "other", "undisclosed"])]).transform((v) => v || null).optional(),
    date_of_birth: optDate,
    marital_status: opt,
    nationality: opt,
    is_expatriate: z.coerce.boolean().optional(),
  }),
  contact: z.object({
    work_email: optEmail,
    personal_email: optEmail,
    phone: opt,
    current_address: opt,
    permanent_address: opt,
  }),
  employment: z.object({
    employee_code: z.string().trim().min(1, "Enter an employee number.").max(40),
    join_date: optDate,
    probation_end_date: optDate,
    confirmation_date: optDate,
    contract_type: z.enum(["permanent", "fixed_term", "part_time", "casual", "intern", "consultant"]),
    contract_end_date: optDate,
    branch_id: optUuid,
    department_id: optUuid,
    position_id: optUuid,
    manager_id: optUuid,
    notes: opt,
  }),
  id: z.object({
    national_id: opt,
    passport_no: opt,
    passport_expiry: optDate,
  }),
} as const;

export type ProfileSection = keyof typeof SECTIONS;

function formToObject(form: FormData) {
  const o: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string" && !k.startsWith("$")) o[k] = v;
  return o;
}

async function activeBusinessId() {
  const b = await getActiveBusiness();
  if (!b) throw new Error("No company selected.");
  return b.business_id;
}

/** Add a new person (personal + employment basics in one go). */
export async function createPerson(_: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const businessId = await activeBusinessId();
  const raw = formToObject(form);
  const personal = SECTIONS.personal.safeParse(raw);
  const contact = SECTIONS.contact.safeParse(raw);
  const employment = SECTIONS.employment.safeParse(raw);
  const status = z.enum(["active", "probation"]).safeParse(raw.status || "active");
  const fieldErrors = {
    ...(personal.success ? {} : personal.error.flatten().fieldErrors),
    ...(contact.success ? {} : contact.error.flatten().fieldErrors),
    ...(employment.success ? {} : employment.error.flatten().fieldErrors),
  };
  if (!personal.success || !contact.success || !employment.success || !status.success) {
    return { error: "Check the highlighted fields.", fieldErrors };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employees")
    .insert({ business_id: businessId, ...personal.data, ...contact.data, ...employment.data, status: status.data })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "That employee number is already used.", fieldErrors: { employee_code: ["Already used."] } };
    return { error: friendly(error.message) };
  }
  revalidatePath("/app/people");
  redirect(`/app/people/${data.id}?added=1`);
}

/** Save one tab of a profile. */
export async function saveProfileSection(employeeId: string, section: ProfileSection, _: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const schema = SECTIONS[section];
  if (!schema) return { error: "Unknown section." };
  const parsed = schema.safeParse(formToObject(form));
  if (!parsed.success) return { error: "Check the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors };
  if (section === "employment" && "manager_id" in parsed.data && parsed.data.manager_id === employeeId) {
    return { error: "Someone can't report to themselves.", fieldErrors: { manager_id: ["Choose someone else."] } };
  }
  const supabase = await createClient();
  const { error, count } = await supabase.from("employees").update(parsed.data, { count: "exact" }).eq("id", employeeId);
  if (error) {
    if (error.code === "23505") return { error: "That employee number is already used.", fieldErrors: { employee_code: ["Already used."] } };
    return { error: friendly(error.message) };
  }
  if (!count) return { error: "You don't have permission to change this." };
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true, message: "Saved." };
}

const statusSchema = z
  .object({
    status: z.enum(["active", "probation", "on_leave", "suspended", "resigned", "terminated"]),
    exit_date: optDate,
    exit_reason: opt,
    exit_notes: opt,
  })
  .refine((v) => !["resigned", "terminated"].includes(v.status) || (v.exit_date && v.exit_reason), {
    message: "Add a last working day and a reason.",
    path: ["exit_date"],
  });

/** Change someone's status. Leaving needs a last day and reason; coming back clears them. */
export async function changeStatus(employeeId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const parsed = statusSchema.safeParse(formToObject(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const leaving = ["resigned", "terminated"].includes(parsed.data.status);
  const patch = leaving ? parsed.data : { status: parsed.data.status, exit_date: null, exit_reason: null, exit_notes: null };
  const supabase = await createClient();
  const { error, count } = await supabase.from("employees").update(patch, { count: "exact" }).eq("id", employeeId);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to change this." };
  revalidatePath(`/app/people/${employeeId}`);
  revalidatePath("/app/people");
  return { ok: true, message: "Status updated." };
}

const contactSchema = z.object({
  id: optUuid,
  name: z.string().trim().min(1, "Enter a name.").max(120),
  relationship: opt,
  phone: opt,
  alt_phone: opt,
  address: opt,
  is_primary: z.coerce.boolean().optional(),
});

export async function saveEmergencyContact(employeeId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const businessId = await activeBusinessId();
  const parsed = contactSchema.safeParse(formToObject(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const { id, ...rest } = parsed.data;
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("employee_emergency_contacts").update(rest).eq("id", id)
    : await supabase.from("employee_emergency_contacts").insert({ ...rest, business_id: businessId, employee_id: employeeId });
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true, message: "Contact saved." };
}

export async function deleteEmergencyContact(employeeId: string, contactId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.from("employee_emergency_contacts").delete().eq("id", contactId);
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true };
}

const bankSchema = z.object({
  id: optUuid,
  bank_name: z.string().trim().min(1, "Enter the bank.").max(120),
  account_name: opt,
  account_number: z.string().trim().min(4, "Enter the account number.").max(40),
  branch: opt,
  swift_code: opt,
  currency: opt,
});

export async function saveBankAccount(employeeId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const businessId = await activeBusinessId();
  const parsed = bankSchema.safeParse(formToObject(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const { id, ...rest } = parsed.data;
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("employee_bank_accounts").update(rest).eq("id", id)
    : await supabase.from("employee_bank_accounts").insert({ ...rest, business_id: businessId, employee_id: employeeId, is_primary: true });
  if (error) return { error: friendly(error.message) };
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true, message: "Bank details saved." };
}

const compSchema = z.object({
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it starts."),
  basic_salary: z.coerce.number().min(0, "Enter a salary of 0 or more."),
  currency: z.string().trim().length(3).default("MVR"),
  pay_basis: z.enum(["monthly", "daily", "hourly"]),
  reason: opt,
});

/** Salary changes are added as new rows, so the history is kept. */
export async function addCompensation(employeeId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const businessId = await activeBusinessId();
  const parsed = compSchema.safeParse(formToObject(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.from("employee_compensation").insert({ ...parsed.data, business_id: businessId, employee_id: employeeId });
  if (error) {
    if (error.code === "23505") return { error: "There's already a salary starting on that date. Choose another date." };
    return { error: friendly(error.message) };
  }
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true, message: "Salary saved." };
}

const docSchema = z.object({
  title: z.string().trim().min(1, "Give the file a name.").max(160),
  file_path: z.string().min(10),
  file_name: z.string().max(260),
  mime_type: z.string().max(120).optional(),
  size_bytes: z.coerce.number().int().min(0),
  category_id: optUuid,
  expiry_date: optDate,
  visible_to_employee: z.coerce.boolean().optional(),
});

/** Records a file that the browser has already uploaded to storage (storage rules check the upload itself). */
export async function recordDocument(employeeId: string, input: unknown): Promise<ActionResult> {
  await requireUser();
  const businessId = await activeBusinessId();
  const parsed = docSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!parsed.data.file_path.startsWith(`${businessId}/documents/${employeeId}/`)) return { error: "That file is in the wrong folder." };
  const supabase = await createClient();
  const { error } = await supabase.from("employee_documents").insert({ ...parsed.data, business_id: businessId, employee_id: employeeId });
  if (error) {
    await supabase.storage.from("tenant-files").remove([parsed.data.file_path]);
    return { error: friendly(error.message) };
  }
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true, message: "File added." };
}

export async function deleteDocument(employeeId: string, documentId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { data: doc } = await supabase.from("employee_documents").select("file_path").eq("id", documentId).maybeSingle();
  if (!doc) return { error: "File not found." };
  const { error, count } = await supabase.from("employee_documents").delete({ count: "exact" }).eq("id", documentId);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to remove this file." };
  await supabase.storage.from("tenant-files").remove([doc.file_path]);
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true, message: "File removed." };
}

/** A short-lived private link to open a stored file. */
export async function fileLink(path: string): Promise<{ url?: string; error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("tenant-files").createSignedUrl(path, 120);
  if (error || !data) return { error: "You can't open this file." };
  return { url: data.signedUrl };
}

const loginSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email."), role_id: z.string().uuid("Choose a role.") });

/** Invite this person to sign in; their login is linked to this profile when they accept. */
export async function inviteLogin(employeeId: string, _: ActionResult, form: FormData): Promise<ActionResult & { link?: string }> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = loginSchema.safeParse(formToObject(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const [{ data: role }, { data: profile }] = await Promise.all([
    supabase.from("roles").select("id, name, is_owner").eq("id", parsed.data.role_id).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!role) return { error: "That role doesn't exist." };
  if (role.is_owner && !active.is_owner) return { error: "Only an owner can invite another owner." };
  const inv = await createInvitation({
    businessId: active.business_id,
    businessName: active.business_name,
    email: parsed.data.email,
    roleId: role.id,
    roleName: role.name,
    employeeId,
    inviterName: profile?.full_name || "Your manager",
  });
  if (!inv.link) return { error: inv.error ?? "Could not create the invitation." };
  revalidatePath(`/app/people/${employeeId}`);
  return inv.emailed
    ? { ok: true, message: `Invitation sent to ${parsed.data.email}.`, link: inv.link }
    : { ok: true, message: "Invitation created, but the email couldn't be sent. Copy the link and send it yourself.", link: inv.link };
}
