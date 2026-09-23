"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveBusiness, requireUser, toAccessContext } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/access";

/** Salaries: one person at a time, a group at once, or from a file. Every change is a new dated row, so history is kept. */

async function salaryEditor() {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) throw new Error("Choose a company first.");
  return { active, allowed: can(toAccessContext(active), "compensation", "edit", "all") };
}

function refresh(employeeId?: string) {
  revalidatePath("/app/payroll/salaries");
  if (employeeId) revalidatePath(`/app/people/${employeeId}`);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date it starts.");

const salarySchema = z.object({
  basic_salary: z.coerce.number({ message: "Enter the salary." }).min(0, "Can't be negative.").max(100_000_000),
  pay_basis: z.enum(["monthly", "daily", "hourly"]),
  effective_date: date,
  reason: z.string().trim().max(200).optional(),
});

export interface SalaryRow {
  id: string;
  effective_date: string;
  basic_salary: number;
  currency: string;
  pay_basis: string;
  reason: string | null;
  created_at: string;
}

export async function salaryHistory(employeeId: string): Promise<{ rows?: SalaryRow[]; error?: string }> {
  const { active } = await salaryEditor();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("employee_compensation")
    .select("id, effective_date, basic_salary, currency, pay_basis, reason, created_at")
    .eq("business_id", active.business_id)
    .eq("employee_id", employeeId)
    .order("effective_date", { ascending: false });
  if (error) return { error: friendly(error.message) };
  return { rows: (data ?? []).map((r) => ({ ...r, basic_salary: Number(r.basic_salary) })) };
}

/** A new salary from a date. The same date again replaces that day's row. */
export async function saveSalary(employeeId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const { active, allowed } = await salaryEditor();
  if (!allowed) return { error: "Only the owner and payroll can change salaries." };
  const parsed = salarySchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase
    .from("employee_compensation")
    .upsert(
      { ...parsed.data, reason: parsed.data.reason || null, business_id: active.business_id, employee_id: employeeId, currency: active.currency ?? "MVR" },
      { onConflict: "employee_id,effective_date" },
    );
  if (error) return { error: error.code === "42501" ? "Only the owner and payroll can change salaries." : friendly(error.message) };
  const schedule = String(form.get("pay_schedule_id") ?? "");
  if (form.has("pay_schedule_id")) {
    await supabase
      .from("employees")
      .update({ pay_schedule_id: schedule || null })
      .eq("id", employeeId)
      .eq("business_id", active.business_id);
  }
  refresh(employeeId);
  return { ok: true, message: "Salary saved. Earlier salaries stay in the history." };
}

export async function deleteSalaryRow(employeeId: string, id: string): Promise<ActionResult> {
  const { active, allowed } = await salaryEditor();
  if (!allowed) return { error: "Only the owner and payroll can change salaries." };
  const supabase = await createClient();
  const { error, count } = await supabase.from("employee_compensation").delete({ count: "exact" }).eq("id", id).eq("business_id", active.business_id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "Only the owner and payroll can change salaries." };
  refresh(employeeId);
  return { ok: true, message: "Removed from the history." };
}

export interface BulkRow {
  employee_id: string;
  name: string;
  code: string | null;
  old: number | null;
  new: number | null;
  skipped?: string;
}

const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Choose at least one person.").max(3000),
  mode: z.enum(["percent", "add", "set"]),
  value: z.coerce.number({ message: "Enter the change." }).min(-100_000_000).max(100_000_000),
  effective: date,
  reason: z.string().trim().max(200),
});

/** Raise a group by a percentage or amount, or set one salary for them, from a date. Previews first. */
export async function bulkChangeSalaries(input: unknown, dryRun: boolean): Promise<ActionResult & { rows?: BulkRow[]; changed?: number }> {
  const { active, allowed } = await salaryEditor();
  if (!allowed) return { error: "Only the owner and payroll can change salaries." };
  const parsed = bulkSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("bulk_change_salaries", {
    p_business: active.business_id,
    p_employees: v.ids,
    p_mode: v.mode,
    p_value: v.value,
    p_effective: v.effective,
    p_reason: v.reason,
    p_dry_run: dryRun,
  });
  if (error) return { error: friendly(error.message) };
  const r = data as { changed: number; rows: BulkRow[] };
  if (!dryRun) refresh();
  return { ok: true, ...r, message: dryRun ? undefined : `${r.changed} ${r.changed === 1 ? "salary" : "salaries"} changed.` };
}

export interface SalaryImportRow {
  row: number;
  code: string;
  salary: string;
  date: string;
  basis?: string;
  reason?: string;
}

export async function importSalaries(rows: SalaryImportRow[], dryRun: boolean): Promise<ActionResult & { valid?: number; imported?: number; errors?: { row: number; message: string }[] }> {
  const { active, allowed } = await salaryEditor();
  if (!allowed) return { error: "Only the owner and payroll can change salaries." };
  if (rows.length > 5000) return { error: "Import up to 5,000 rows at a time." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_salaries", { p_business: active.business_id, p_rows: rows, p_dry_run: dryRun });
  if (error) return { error: friendly(error.message) };
  const r = data as { valid: number; imported: number; errors: { row: number; message: string }[] };
  if (!dryRun && r.imported) refresh();
  return { ok: true, ...r, message: dryRun ? undefined : r.imported ? `${r.imported} ${r.imported === 1 ? "salary" : "salaries"} imported.` : undefined };
}
