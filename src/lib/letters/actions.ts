"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser, type BusinessAccess } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { sendEmailsAfterResponse } from "@/lib/notifications/deliver";
import { formatDate, today } from "@/lib/format";
import { can } from "@/modules/access";
import { toAccessContext } from "@/lib/auth/session";
import { mergeValues, renderTemplate, type MergeData } from "./merge";
import { renderLetterPdf } from "./pdf";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const templateSchema = z.object({
  name: z.string().trim().min(2, "Give the template a name.").max(100),
  kind: z.enum(["employment_certificate", "salary_certificate", "warning", "experience", "noc", "offer", "custom"]),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(10, "Write the letter.").max(20000),
  include_signature: z.coerce.boolean().optional(),
  include_stamp: z.coerce.boolean().optional(),
  requestable_by_staff: z.coerce.boolean().optional(),
  is_active: z.coerce.boolean().optional(),
});

export async function saveTemplate(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = templateSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const row = {
    ...parsed.data,
    subject: parsed.data.subject || null,
    include_signature: parsed.data.include_signature ?? false,
    include_stamp: parsed.data.include_stamp ?? false,
    requestable_by_staff: parsed.data.requestable_by_staff ?? false,
    is_active: parsed.data.is_active ?? true,
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("letter_templates").update(row).eq("id", id)
    : await supabase.from("letter_templates").insert({ ...row, business_id: active.business_id });
  if (error) {
    if (error.code === "23505") return { error: "There's already a template with that name." };
    if (error.code === "42501") return { error: "You don't have permission to change templates." };
    return { error: friendly(error.message) };
  }
  revalidatePath("/app/letters");
  return { ok: true, message: "Template saved." };
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error, count } = await supabase.from("letter_templates").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to remove templates." };
  revalidatePath("/app/letters");
  return { ok: true, message: "Template removed." };
}

async function loadImage(supabase: Supabase, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from("tenant-files").download(path);
  if (!data) return null;
  const buf = Buffer.from(await data.arrayBuffer());
  const type = data.type && data.type.startsWith("image/") ? data.type : "image/png";
  // The PDF library reads PNG and JPEG only.
  if (!/png|jpe?g/.test(type)) return null;
  return `data:${type};base64,${buf.toString("base64")}`;
}

async function mergeDataFor(supabase: Supabase, active: BusinessAccess, employeeId: string, letter: MergeData["letter"], withSalary: boolean) {
  const [{ data: e }, { data: b }, comp] = await Promise.all([
    supabase
      .from("employees")
      .select("first_name, last_name, employee_code, join_date, exit_date, national_id, passport_no, nationality, position:positions(title), department:departments!employees_business_id_department_id_fkey(name)")
      .eq("id", employeeId)
      .eq("business_id", active.business_id)
      .maybeSingle(),
    supabase.from("businesses").select("*").eq("id", active.business_id).single(),
    withSalary
      ? supabase.from("employee_compensation").select("basic_salary, currency").eq("employee_id", employeeId).lte("effective_date", today(active.timezone)).order("effective_date", { ascending: false }).limit(1)
      : Promise.resolve({ data: null }),
  ]);
  if (!e || !b) return null;
  const salary = (comp.data as { basic_salary: number; currency: string }[] | null)?.[0];
  const data: MergeData = {
    employee: {
      ...e,
      position: (e.position as unknown as { title: string } | null)?.title ?? null,
      department: (e.department as unknown as { name: string } | null)?.name ?? null,
      salary: salary ? { amount: Number(salary.basic_salary), currency: salary.currency } : null,
    },
    company: { name: b.name, address: b.address, registration_no: b.registration_no, date_format: b.date_format },
    letter,
  };
  return { data, business: b };
}

const generateSchema = z.object({
  employee_id: z.string().uuid("Choose a person."),
  template_id: z.string().uuid("Choose a template."),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(10, "The letter is empty.").max(20000),
  addressed_to: z.string().trim().max(300).optional(),
  save_to_files: z.coerce.boolean().optional(),
  request_id: z
    .union([z.literal(""), z.string().uuid()])
    .transform((v) => v || null)
    .optional(),
});

/** Preview: fills in the template for one person, so it can be checked and edited before the PDF is made. */
export async function previewLetter(input: { employee_id: string; template_id: string; purpose?: string; addressed_to?: string }): Promise<{
  error?: string;
  subject?: string;
  body?: string;
  missing?: string[];
}> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const supabase = await createClient();
  const { data: t } = await supabase.from("letter_templates").select("subject, body").eq("id", input.template_id).maybeSingle();
  if (!t) return { error: "Template not found." };
  const canSalary = can(toAccessContext(active), "compensation", "view");
  const loaded = await mergeDataFor(supabase, active, input.employee_id, { purpose: input.purpose, addressed_to: input.addressed_to }, canSalary && t.body.includes("employee.salary"));
  if (!loaded) return { error: "Person not found." };
  const values = mergeValues(loaded.data);
  const body = renderTemplate(t.body, values);
  const subject = renderTemplate(t.subject ?? "", values);
  const missing = [...new Set([...body.missing, ...subject.missing])];
  if (!canSalary && t.body.includes("employee.salary")) missing.push("employee.salary (you can't see salaries)");
  return { subject: subject.text, body: body.text, missing };
}

/** Makes the PDF, stores it in the person's letters folder, and optionally adds it to their files. */
export async function generateLetter(input: unknown): Promise<ActionResult & { url?: string }> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const p = parsed.data;
  const supabase = await createClient();
  const { data: t } = await supabase.from("letter_templates").select("id, name, include_signature, include_stamp").eq("id", p.template_id).maybeSingle();
  if (!t) return { error: "Template not found." };
  const loaded = await mergeDataFor(supabase, active, p.employee_id, {}, false);
  if (!loaded) return { error: "Person not found." };
  const b = loaded.business;
  const todayDate = today(active.timezone);
  const [logo, signature, stamp] = await Promise.all([
    loadImage(supabase, b.logo_path),
    t.include_signature ? loadImage(supabase, b.signature_path) : null,
    t.include_stamp ? loadImage(supabase, b.stamp_path) : null,
  ]);
  const reference = `${loaded.data.employee.employee_code}/${todayDate.replace(/-/g, "")}/${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  let pdf: Buffer;
  try {
    pdf = await renderLetterPdf({
      company: { name: b.name, address: b.address, phone: b.phone, email: b.email, registration_no: b.registration_no, footer: b.letterhead_footer },
      images: { logo, signature, stamp },
      signatory: { name: b.signatory_name, title: b.signatory_title },
      date: formatDate(todayDate, b.date_format),
      reference,
      addressedTo: p.addressed_to || null,
      subject: p.subject || null,
      body: p.body,
    });
  } catch (e) {
    return { error: `The PDF couldn't be made: ${(e as Error).message}` };
  }

  const fileName = `${t.name} - ${loaded.data.employee.first_name} ${loaded.data.employee.last_name}`.trim().replace(/[^\w\- ]+/g, "") + ".pdf";
  const path = `${active.business_id}/letters/${p.employee_id}/${crypto.randomUUID()}.pdf`;
  const { error: upErr } = await supabase.storage.from("tenant-files").upload(path, pdf, { contentType: "application/pdf" });
  if (upErr) return { error: "You don't have permission to save letters for this person." };

  let documentId: string | null = null;
  if (p.save_to_files) {
    const { data: cat } = await supabase.from("document_categories").select("id").eq("business_id", active.business_id).ilike("name", "letters").maybeSingle();
    const { data: doc } = await supabase
      .from("employee_documents")
      .insert({
        business_id: active.business_id,
        employee_id: p.employee_id,
        category_id: cat?.id ?? null,
        title: t.name,
        file_path: path,
        file_name: fileName,
        mime_type: "application/pdf",
        size_bytes: pdf.length,
        issue_date: todayDate,
      })
      .select("id")
      .maybeSingle();
    documentId = doc?.id ?? null;
  }
  const { data: letter, error } = await supabase
    .from("generated_letters")
    .insert({
      business_id: active.business_id,
      template_id: t.id,
      employee_id: p.employee_id,
      title: p.subject || t.name,
      body_rendered: p.body,
      pdf_path: path,
      document_id: documentId,
      generated_by: user.id,
    })
    .select("id")
    .single();
  if (error) {
    await supabase.storage.from("tenant-files").remove([path]);
    return { error: friendly(error.message) };
  }

  if (p.request_id) {
    const { error: reqErr } = await supabase
      .from("letter_requests")
      .update({ status: "issued", generated_letter_id: letter.id })
      .eq("id", p.request_id)
      .in("status", ["approved", "pending"]);
    if (reqErr) return { ok: true, message: "Letter made, but the request couldn't be marked as issued." };
    sendEmailsAfterResponse(active.business_id);
  }

  const { data: signed } = await supabase.storage.from("tenant-files").createSignedUrl(path, 300, { download: fileName });
  revalidatePath("/app/letters");
  revalidatePath(`/app/people/${p.employee_id}`);
  return { ok: true, message: "Letter ready.", url: signed?.signedUrl };
}

export async function declineLetterRequest(id: string, reason: string): Promise<ActionResult> {
  await requireUser();
  if (!reason.trim()) return { error: "Add a short note so they know why." };
  const supabase = await createClient();
  const { data: ar } = await supabase.from("approval_requests").select("id, status").eq("source_table", "letter_requests").eq("source_id", id).maybeSingle();
  if (ar?.status === "pending") {
    const { error } = await supabase.rpc("decide_request", { p_request: ar.id, p_decision: "reject", p_comment: reason });
    if (error) return { error: friendly(error.message) };
  } else {
    const { error } = await supabase.from("letter_requests").update({ status: "rejected", decision_comment: reason }).eq("id", id);
    if (error) return { error: friendly(error.message) };
  }
  revalidatePath("/app/letters");
  return { ok: true, message: "Request declined." };
}

export async function letterLink(letterId: string): Promise<{ url?: string; error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase.from("generated_letters").select("pdf_path, title").eq("id", letterId).maybeSingle();
  if (!data?.pdf_path) return { error: "Letter not found." };
  const { data: signed } = await supabase.storage.from("tenant-files").createSignedUrl(data.pdf_path, 120);
  return signed ? { url: signed.signedUrl } : { error: "You can't open this letter." };
}
