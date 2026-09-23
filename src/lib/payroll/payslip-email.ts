"use server";

import { revalidatePath } from "next/cache";
import { getActiveBusiness, requireUser, toAccessContext } from "@/lib/auth/session";
import { emailButton, emailLayout, emailParagraphs, escapeHtml, sendEmail } from "@/lib/email";
import { siteUrl } from "@/lib/env";
import { friendly, type ActionResult } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/access";
import { payslipPdf } from "./payslip";

/**
 * Emails everyone on a finalized run their payslip as a PDF. Sent to their
 * work email, else their personal email, else the email they sign in with.
 * Payslips are also in the staff app either way.
 */
export async function emailPayslips(runId: string, onlyNotSent: boolean): Promise<ActionResult & { sent?: number; noEmail?: string[]; failed?: number }> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active || !can(toAccessContext(active), "payroll", "edit", "all")) return { error: "Only payroll can send payslips." };
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return { error: "Pay run not found." };
  const supabase = await createClient();
  const { data: run } = await supabase.from("payroll_runs").select("id, name, status").eq("id", runId).eq("business_id", active.business_id).maybeSingle();
  if (!run) return { error: "Pay run not found." };
  if (!["finalized", "paid"].includes(run.status)) return { error: "Finalize the pay run before sending payslips." };

  let q = supabase.from("payroll_run_employees").select("id, employee_id, employee_name, payslip_emailed_at").eq("run_id", runId).eq("status", "included").order("employee_name");
  if (onlyNotSent) q = q.is("payslip_emailed_at", null);
  const { data: people } = await q.limit(300);
  if (!people?.length) return { ok: true, sent: 0, message: onlyNotSent ? "Everyone's payslip has already been sent." : "Nobody to send to." };

  const { data: emps } = await supabase.from("employees").select("id, work_email, personal_email").in("id", people.map((p) => p.employee_id));
  const emailOf = new Map((emps ?? []).map((e) => [e.id, (e.work_email || e.personal_email || "").trim()]));
  // Sign-in emails for anyone with no email on their profile.
  const missing = people.filter((p) => !emailOf.get(p.employee_id)).map((p) => p.employee_id);
  if (missing.length) {
    const admin = createAdminClient();
    const { data: members } = await admin.from("business_members").select("employee_id, user_id").eq("business_id", active.business_id).in("employee_id", missing);
    for (const m of members ?? []) {
      const { data } = await admin.auth.admin.getUserById(m.user_id);
      if (data.user?.email) emailOf.set(m.employee_id!, data.user.email);
    }
  }

  const link = `${siteUrl()}/staff/pay`;
  const sentIds: string[] = [];
  const noEmail: string[] = [];
  let failed = 0;
  for (const p of people) {
    const to = emailOf.get(p.employee_id);
    if (!to) {
      noEmail.push(p.employee_name);
      continue;
    }
    const pdf = await payslipPdf(supabase, p.id);
    if (!pdf) {
      failed++;
      continue;
    }
    const first = p.employee_name.split(" ")[0];
    const r = await sendEmail({
      to,
      subject: `Your payslip: ${run.name}`,
      html: emailLayout(
        `Your payslip for ${escapeHtml(run.name)}`,
        emailParagraphs(`Hello ${first},\n\nYour payslip from ${active.business_name} is attached as a PDF. You can also see all your payslips in the staff app.`) +
          emailButton(link, "Open the staff app"),
        { preheader: `Your payslip for ${run.name} from ${active.business_name}` },
      ),
      text: `Hello ${first},\n\nYour payslip for ${run.name} from ${active.business_name} is attached as a PDF. All your payslips are also in the staff app: ${link}`,
      attachments: [{ filename: pdf.fileName, content: new Uint8Array(pdf.pdf) }],
    });
    if (r.ok) sentIds.push(p.employee_id);
    else failed++;
  }
  if (sentIds.length) {
    const { error } = await supabase.rpc("mark_payslips_emailed", { p_run: runId, p_employees: sentIds });
    if (error) return { error: friendly(error.message) };
  }
  revalidatePath(`/app/payroll/${runId}`);
  const parts = [`${sentIds.length} ${sentIds.length === 1 ? "payslip" : "payslips"} sent`];
  if (noEmail.length) parts.push(`${noEmail.length} without an email address`);
  if (failed) parts.push(`${failed} couldn't be sent`);
  return { ok: !failed || sentIds.length > 0, sent: sentIds.length, noEmail, failed, message: `${parts.join(", ")}.` };
}
