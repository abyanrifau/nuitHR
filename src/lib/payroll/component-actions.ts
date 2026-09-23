"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActiveBusiness, requireUser, toAccessContext } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/access";
import { PAY_VARIABLES, parseFormula } from "./formula";
import { unreachableRules } from "./pay-items";

/**
 * Allowances and deductions ("pay items"). Formulas are checked here on
 * the server before saving (never trusted from the browser), then stored
 * as a checked tree that the database calculates.
 */

async function payrollEditor() {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) throw new Error("Choose a company first.");
  const ctx = toAccessContext(active);
  return { active, allowed: can(ctx, "payroll", "edit", "all") };
}

function refresh(id?: string) {
  revalidatePath("/app/payroll/allowances");
  if (id) revalidatePath(`/app/payroll/allowances/${id}`);
}

const VAR_KEYS = PAY_VARIABLES.map((v) => v.key) as [string, ...string[]];
const money = z.coerce.number().min(0, "Use 0 or more.").max(100_000_000);
const optDate = z
  .union([z.literal(""), z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.")])
  .transform((v) => v || null);

const ruleSchema = z.object({
  label: z.string().trim().max(80).default(""),
  join: z.enum(["and", "or"]),
  clauses: z
    .array(z.object({ var: z.enum(VAR_KEYS), op: z.enum([">=", ">", "<=", "<", "=", "!="]), value: z.coerce.number().min(-1_000_000).max(100_000_000) }))
    .min(1, "Each rule needs at least one condition.")
    .max(10),
  outcome: z.object({ type: z.enum(["full", "percent", "nothing", "subtract", "fixed"]), value: z.coerce.number().min(0).max(100_000_000).nullable().optional() }),
});

const itemSchema = z
  .object({
    name: z.string().trim().min(2, "Give it a name.").max(80),
    description: z.string().trim().max(300).optional().default(""),
    kind: z.enum(["earning", "deduction"]),
    is_taxable: z.boolean(),
    is_pensionable: z.boolean(),
    effective_from: optDate,
    effective_to: optDate,
    method: z.enum(["fixed", "per_day", "prorated", "percent", "per_occurrence", "formula"]),
    default_amount: money,
    default_percent: z.coerce.number().min(0).max(1000).nullable().optional(),
    prorate_basis: z.enum(["calendar", "working"]),
    occurrence_var: z.enum(VAR_KEYS).nullable().optional(),
    occurrence_after: z.coerce.number().int().min(0).max(1000).default(0),
    formula: z.string().max(500).nullable().optional(),
    rules_mode: z.enum(["none", "builder", "formula"]),
    rules: z.array(ruleSchema).max(20),
    rules_formula: z.string().max(500).nullable().optional(),
    applies_to: z.enum(["all", "selected"]),
    targets: z.array(z.object({ target_type: z.enum(["department", "position", "branch", "employee"]), target_id: z.string().uuid() })).max(2000),
    template_key: z.string().max(40).nullable().optional(),
  })
  .refine((v) => !v.effective_from || !v.effective_to || v.effective_to >= v.effective_from, { message: "The end date must be after the start date.", path: ["effective_to"] })
  .refine((v) => v.method !== "percent" || v.default_percent != null, { message: "Enter the percentage of basic salary.", path: ["default_percent"] })
  .refine((v) => v.method !== "per_occurrence" || v.occurrence_var, { message: "Choose what is counted.", path: ["occurrence_var"] })
  .refine((v) => v.applies_to === "all" || v.targets.length > 0, { message: "Choose who gets it, or give it to all staff.", path: ["targets"] })
  .refine((v) => v.rules.every((r) => !["percent", "subtract", "fixed"].includes(r.outcome.type) || r.outcome.value != null), {
    message: "Enter the amount or percentage for each rule.",
    path: ["rules"],
  });

export type PayItemInput = z.input<typeof itemSchema>;

/** Turns the editor's input into the row the database stores, checking formulas on the way. */
function toRow(input: unknown): { row?: Record<string, unknown>; targets?: { target_type: string; target_id: string }[]; error?: string; field?: string } {
  const parsed = itemSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message, field: String(parsed.error.issues[0].path[0] ?? "") };
  const v = parsed.data;
  let formula_ast: unknown = null;
  if (v.method === "formula") {
    const f = parseFormula(v.formula ?? "");
    if (!f.ok) return { error: `Formula: ${f.error}`, field: "formula" };
    formula_ast = f.ast;
  }
  let rules_ast: unknown = null;
  if (v.rules_mode === "formula") {
    const f = parseFormula(v.rules_formula ?? "");
    if (!f.ok) return { error: `Rule formula: ${f.error}`, field: "rules_formula" };
    rules_ast = f.ast;
  }
  if (v.rules_mode === "builder" && !v.rules.length) return { error: "Add a rule, or choose no rules.", field: "rules" };
  const { targets, ...rest } = v;
  return {
    row: {
      ...rest,
      description: rest.description || null,
      default_percent: v.method === "percent" ? v.default_percent : null,
      occurrence_var: v.method === "per_occurrence" ? v.occurrence_var : null,
      occurrence_after: v.method === "per_occurrence" ? v.occurrence_after : 0,
      formula: v.method === "formula" ? (v.formula ?? "").trim() : null,
      formula_ast,
      rules: v.rules_mode === "builder" ? v.rules : [],
      rules_formula: v.rules_mode === "formula" ? (v.rules_formula ?? "").trim() : null,
      rules_ast,
      category: v.kind === "earning" ? "allowance" : "other",
    },
    targets: v.applies_to === "selected" ? targets : [],
  };
}

function codeFor(name: string) {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 16) || "ITEM";
  return `${base}_${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

export async function savePayItem(id: string | null, input: unknown): Promise<ActionResult & { id?: string; field?: string }> {
  const { active, allowed } = await payrollEditor();
  if (!allowed) return { error: "Only the owner and payroll can change allowances and deductions." };
  const { row, targets, error, field } = toRow(input);
  if (error || !row) return { error, field };
  const supabase = await createClient();
  let itemId = id;
  if (id) {
    const { data: old } = await supabase.from("pay_components").select("is_system").eq("id", id).eq("business_id", active.business_id).maybeSingle();
    if (!old) return { error: "That item no longer exists." };
    if (old.is_system) return { error: "Built-in items can't be changed here." };
    const { error: e } = await supabase.from("pay_components").update(row).eq("id", id).eq("business_id", active.business_id);
    if (e) return { error: friendly(e.message) };
  } else {
    const { data: last } = await supabase.from("pay_components").select("sort").eq("business_id", active.business_id).order("sort", { ascending: false }).limit(1).maybeSingle();
    const { data, error: e } = await supabase
      .from("pay_components")
      .insert({ ...row, business_id: active.business_id, code: codeFor(String(row.name)), sort: Math.min((last?.sort ?? 0) + 1, 800) })
      .select("id")
      .single();
    if (e) return { error: e.code === "23505" ? "Another item already has that name or code." : friendly(e.message) };
    itemId = data.id;
  }
  // Who gets it: replace the list with what's chosen now.
  const { data: current } = await supabase.from("pay_component_targets").select("id, target_type, target_id").eq("component_id", itemId!);
  const want = new Set(targets!.map((t) => `${t.target_type}|${t.target_id}`));
  const have = new Set((current ?? []).map((t) => `${t.target_type}|${t.target_id}`));
  const drop = (current ?? []).filter((t) => !want.has(`${t.target_type}|${t.target_id}`)).map((t) => t.id);
  if (drop.length) await supabase.from("pay_component_targets").delete().in("id", drop);
  const add = targets!.filter((t) => !have.has(`${t.target_type}|${t.target_id}`));
  if (add.length) {
    const { error: e } = await supabase.from("pay_component_targets").insert(add.map((t) => ({ ...t, business_id: active.business_id, component_id: itemId! })));
    if (e) return { error: friendly(e.message) };
  }
  refresh(itemId!);
  const warn = row.rules_mode === "builder" ? unreachableRules(row.rules as never) : [];
  return {
    ok: true,
    id: itemId!,
    message: warn.length ? `Saved, but rule ${warn[0].index + 1} is never reached. Check the order of the rules.` : id ? "Saved. Pay runs already finalized don't change." : "Added.",
  };
}

/** A copy to start from, switched off until it's checked. */
export async function duplicatePayItem(id: string): Promise<ActionResult & { id?: string }> {
  const { active, allowed } = await payrollEditor();
  if (!allowed) return { error: "Only the owner and payroll can change allowances and deductions." };
  const supabase = await createClient();
  const { data: src } = await supabase.from("pay_components").select("*").eq("id", id).eq("business_id", active.business_id).maybeSingle();
  if (!src) return { error: "That item no longer exists." };
  const { id: _id, created_at: _c, updated_at: _u, updated_by: _b, ...copy } = src;
  void _id;
  void _c;
  void _u;
  void _b;
  const name = `${src.name} (copy)`.slice(0, 80);
  const { data, error } = await supabase
    .from("pay_components")
    .insert({ ...copy, name, code: codeFor(src.name), is_system: false, is_active: false })
    .select("id")
    .single();
  if (error) return { error: friendly(error.message) };
  const { data: targets } = await supabase.from("pay_component_targets").select("target_type, target_id").eq("component_id", id);
  if (targets?.length) await supabase.from("pay_component_targets").insert(targets.map((t) => ({ ...t, business_id: active.business_id, component_id: data.id })));
  refresh();
  return { ok: true, id: data.id, message: "Copied. The copy is archived until you switch it on." };
}

/** Archive (switch off) or bring back. Items are never deleted, so past payslips keep them. */
export async function setPayItemActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { active, allowed } = await payrollEditor();
  if (!allowed) return { error: "Only the owner and payroll can change allowances and deductions." };
  const supabase = await createClient();
  const { error } = await supabase.from("pay_components").update({ is_active: isActive }).eq("id", id).eq("business_id", active.business_id);
  if (error) return { error: friendly(error.message) };
  refresh(id);
  return { ok: true, message: isActive ? "Back on. It's in the next pay run." : "Archived. It's left out of pay runs from now on; finalized runs keep it." };
}

const overrideSchema = z
  .object({
    employee_id: z.string().uuid("Choose a person."),
    amount: z.union([z.literal(""), money]).transform((v) => (v === "" ? null : v)),
    percent: z.union([z.literal(""), z.coerce.number().min(0).max(1000)]).transform((v) => (v === "" ? null : v)),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the start date."),
    end_date: optDate,
  })
  .refine((v) => v.amount !== null || v.percent !== null, { message: "Enter their amount.", path: ["amount"] });

/** A person's own amount for an item (they get the item even if it isn't for their group). */
export async function savePayItemOverride(itemId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  const { active, allowed } = await payrollEditor();
  if (!allowed) return { error: "Only the owner and payroll can change allowances and deductions." };
  const parsed = overrideSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.from("employee_pay_components").insert({ ...parsed.data, business_id: active.business_id, component_id: itemId });
  if (error) return { error: friendly(error.message) };
  refresh(itemId);
  return { ok: true, message: "Their own amount is saved." };
}

export async function removePayItemOverride(itemId: string, overrideId: string): Promise<ActionResult> {
  const { active, allowed } = await payrollEditor();
  if (!allowed) return { error: "Only the owner and payroll can change allowances and deductions." };
  const supabase = await createClient();
  const { error } = await supabase.from("employee_pay_components").delete().eq("id", overrideId).eq("component_id", itemId).eq("business_id", active.business_id);
  if (error) return { error: friendly(error.message) };
  refresh(itemId);
  return { ok: true, message: "Removed. They get the usual amount (if the item is for them)." };
}

export interface PreviewResult {
  error?: string;
  vars?: Record<string, number | string | boolean>;
  currency?: string;
  start?: string;
  end?: string;
  items?: { id: string | null; name: string; kind: "earning" | "deduction"; draft: boolean; applies: boolean; why_not: string | null; amount: number | null; explanation: string | null }[];
}

/** The test panel: every item for one person and month, optionally with the item being edited (not saved yet). */
export async function previewPayItems(employeeId: string, month: string, draft?: { id: string | null; input: unknown }): Promise<PreviewResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "Choose a company first." };
  if (!/^[0-9a-f-]{36}$/i.test(employeeId)) return { error: "Choose a person." };
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: "Choose a month." };
  let p_draft: Record<string, unknown> | null = null;
  if (draft) {
    const { row, targets, error } = toRow(draft.input);
    if (error || !row) return { error };
    p_draft = { ...row, id: draft.id, targets, code: "DRAFT" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pay_items_preview", { p_business: active.business_id, p_employee: employeeId, p_month: `${month}-01`, p_draft });
  if (error) return { error: friendly(error.message) };
  return data as PreviewResult;
}
