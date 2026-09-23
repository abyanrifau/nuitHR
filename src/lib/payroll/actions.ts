"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { sendEmailsAfterResponse } from "@/lib/notifications/deliver";

async function business() {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) throw new Error("No company selected.");
  return active;
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");
const uuid = z.string().uuid();

function refresh(run?: string) {
  revalidatePath("/app/payroll");
  if (run) revalidatePath(`/app/payroll/${run}`);
}

const runSchema = z.object({
  start: date,
  end: date,
  pay_date: date,
  name: z.string().trim().max(80).optional(),
  run_type: z.enum(["regular", "adhoc"]).default("regular"),
  schedule: z.union([z.literal(""), uuid]).optional(),
});

export async function createRun(_: ActionResult, form: FormData): Promise<ActionResult & { id?: string }> {
  const active = await business();
  const parsed = runSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_payroll_run", {
    p_business: active.business_id,
    p_start: d.start,
    p_end: d.end,
    p_pay_date: d.pay_date,
    p_name: d.name || null,
    p_schedule: d.schedule || null,
    p_type: d.run_type,
  });
  if (error) return { error: friendly(error.message) };
  const id = data as string;
  // Work it out straight away so there's something to check.
  const { error: calcErr } = await supabase.rpc("calculate_payroll_run", { p_run: id });
  refresh(id);
  if (calcErr) return { ok: true, id, message: `Pay run created, but it couldn't be calculated: ${friendly(calcErr.message)}` };
  return { ok: true, id, message: d.run_type === "adhoc" ? "Ad-hoc run created. Add the amounts to pay on each person." : "Pay run created and calculated." };
}

async function rpc(name: string, args: Record<string, unknown>, run: string, message: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error } = await supabase.rpc(name, args);
  if (error) return { error: friendly(error.message) };
  refresh(run);
  return { ok: true, message };
}

export async function recalculate(run: string): Promise<ActionResult> {
  if (!uuid.safeParse(run).success) return { error: "Pay run not found." };
  return rpc("calculate_payroll_run", { p_run: run }, run, "Calculated again with the latest details.");
}

export async function setPersonStatus(run: string, employee: string, status: "included" | "on_hold"): Promise<ActionResult> {
  if (!uuid.safeParse(run).success || !uuid.safeParse(employee).success) return { error: "Not found." };
  return rpc("set_payroll_person_status", { p_run: run, p_employee: employee, p_status: status }, run, status === "on_hold" ? "Put on hold. They won't be paid in this run." : "Included again.");
}

const adjSchema = z.object({
  employee_id: uuid,
  name: z.string().trim().min(2, "Name the amount, for example Eid bonus.").max(80),
  kind: z.enum(["earning", "deduction"]),
  amount: z.coerce.number().positive("Enter an amount above zero.").max(10_000_000),
  taxable: z.coerce.boolean().optional(),
  pensionable: z.coerce.boolean().optional(),
  reason: z.string().trim().min(3, "Add the reason. It's kept in the history.").max(300),
});

export async function addAdjustment(run: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = adjSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  return rpc(
    "add_payroll_adjustment",
    { p_run: run, p_employee: d.employee_id, p_name: d.name, p_kind: d.kind, p_amount: d.amount, p_taxable: d.taxable ?? false, p_pensionable: d.pensionable ?? false, p_reason: d.reason },
    run,
    "Added.",
  );
}

export async function removeAdjustment(run: string, line: string): Promise<ActionResult> {
  if (!uuid.safeParse(line).success) return { error: "Not found." };
  return rpc("remove_payroll_adjustment", { p_line: line }, run, "Removed.");
}

export async function approveRun(run: string): Promise<ActionResult> {
  return rpc("approve_payroll_run", { p_run: run }, run, "Approved. It can't change now unless you undo the approval.");
}

export async function unapproveRun(run: string): Promise<ActionResult> {
  return rpc("unapprove_payroll_run", { p_run: run }, run, "Approval undone. You can change and calculate it again.");
}

export async function finalizeRun(run: string): Promise<ActionResult> {
  const active = await business();
  const r = await rpc("finalize_payroll_run", { p_run: run }, run, "Finalized. Payslips are now in everyone's staff app.");
  if (r.ok) sendEmailsAfterResponse(active.business_id);
  return r;
}

export async function markPaid(run: string): Promise<ActionResult> {
  return rpc("mark_payroll_paid", { p_run: run }, run, "Marked as paid.");
}

export async function reverseRun(run: string, reason: string): Promise<ActionResult> {
  return rpc("reverse_payroll_run", { p_run: run, p_reason: reason }, run, "Reversed. Loans and claims are back as they were; you can create a new run for the period.");
}

export async function deleteRun(run: string): Promise<ActionResult> {
  return rpc("delete_payroll_run", { p_run: run }, run, "Deleted.");
}

// ---------------------------------------------------------------------
// Pay settings on a person's profile
// ---------------------------------------------------------------------
const componentSchema = z.object({
  component_id: uuid,
  amount: z.union([z.literal(""), z.coerce.number().min(0)]).transform((v) => (v === "" ? null : v)),
  start_date: date,
  end_date: z
    .union([z.literal(""), date])
    .transform((v) => v || null)
    .optional(),
});

export async function addPersonComponent(employeeId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = componentSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.from("employee_pay_components").insert({ ...parsed.data, business_id: active.business_id, employee_id: employeeId });
  if (error) return { error: error.code === "42501" ? "Only people allowed to change salaries can do this." : friendly(error.message) };
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true, message: "Added. It's included from the next pay run." };
}

export async function endPersonComponent(employeeId: string, id: string, endDate: string): Promise<ActionResult> {
  await business();
  if (!date.safeParse(endDate).success) return { error: "Choose the last date." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("employee_pay_components").update({ end_date: endDate }, { count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "Only people allowed to change salaries can do this." };
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true, message: "Stopped." };
}

const loanSchema = z
  .object({
    kind: z.enum(["loan", "advance"]),
    principal: z.coerce.number().positive("Enter the amount."),
    installment_amount: z.coerce.number().positive("Enter how much to take each month."),
    start_date: date,
    reason: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.installment_amount <= v.principal, { message: "The monthly amount can't be more than the loan.", path: ["installment_amount"] });

export async function addLoan(employeeId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const active = await business();
  const parsed = loanSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase
    .from("loans")
    .insert({ ...parsed.data, reason: parsed.data.reason || null, outstanding: parsed.data.principal, business_id: active.business_id, employee_id: employeeId, approved_by: user.id, disbursed_on: parsed.data.start_date });
  if (error) return { error: error.code === "42501" ? "Only people allowed to change salaries can do this." : friendly(error.message) };
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true, message: "Saved. Repayments come off each pay run from the start date." };
}

export async function setLoanStatus(employeeId: string, id: string, status: "active" | "paused" | "cancelled"): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("loans").update({ status }, { count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "Only people allowed to change salaries can do this." };
  revalidatePath(`/app/people/${employeeId}`);
  return { ok: true, message: status === "paused" ? "Paused." : status === "active" ? "Started again." : "Cancelled." };
}
