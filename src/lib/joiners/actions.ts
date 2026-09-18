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

function refresh(id?: string) {
  revalidatePath("/app/joiners-leavers");
  if (id) revalidatePath(`/app/joiners-leavers/${id}`);
  revalidatePath("/staff/tasks");
}

export async function startChecklist(employeeId: string, kind: "onboarding" | "offboarding", templateId?: string): Promise<ActionResult & { id?: string }> {
  const active = await business();
  if (!z.string().uuid().safeParse(employeeId).success) return { error: "Choose a person." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("start_checklist", { p_employee: employeeId, p_kind: kind, p_template: templateId || null, p_source: "manual" });
  if (error) return { error: friendly(error.message) };
  if (!data) return { error: "There's no checklist to use yet. Add one under Checklists." };
  sendEmailsAfterResponse(active.business_id);
  refresh();
  return { ok: true, id: data as string, message: "Checklist started." };
}

export async function setTaskStatus(taskId: string, status: "todo" | "done" | "skipped", checklistId?: string): Promise<ActionResult> {
  await business();
  if (!z.string().uuid().safeParse(taskId).success) return { error: "Task not found." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("employee_checklist_tasks")
    .update(status === "todo" ? { status, completed_at: null, completed_by: null } : { status }, { count: "exact" })
    .eq("id", taskId);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You can't change this task." };
  refresh(checklistId);
  return { ok: true, message: status === "done" ? "Done." : status === "skipped" ? "Skipped." : "Opened again." };
}

export async function cancelChecklist(id: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("employee_checklists").update({ status: "cancelled" }, { count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You can't change this checklist." };
  refresh(id);
  return { ok: true, message: "Checklist cancelled." };
}

const taskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  assignee_type: z.enum(["hr", "manager", "employee"]),
  due_offset_days: z.coerce.number().int().min(-365).max(365),
});

const templateSchema = z.object({
  name: z.string().trim().min(2, "Name the checklist.").max(100),
  kind: z.enum(["onboarding", "offboarding"]),
  department_id: z
    .union([z.literal(""), z.string().uuid()])
    .nullable()
    .optional()
    .transform((v) => v || null),
  is_default: z.boolean(),
  tasks: z.array(taskSchema).min(1, "Add at least one task.").max(60),
});

/** Save a checklist template and its tasks (replacing the old task list). */
export async function saveTemplate(id: string | null, input: unknown): Promise<ActionResult> {
  const active = await business();
  const parsed = templateSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { tasks, ...t } = parsed.data;
  const supabase = await createClient();
  if (t.is_default) {
    await supabase.from("checklist_templates").update({ is_default: false }).eq("business_id", active.business_id).eq("kind", t.kind).neq("id", id ?? "00000000-0000-0000-0000-000000000000");
  }
  let templateId = id;
  if (id) {
    const { error } = await supabase.from("checklist_templates").update(t).eq("id", id);
    if (error) return { error: error.code === "42501" ? "You don't have permission to change checklists." : friendly(error.message) };
    const { error: delErr } = await supabase.from("checklist_template_tasks").delete().eq("template_id", id);
    if (delErr) return { error: friendly(delErr.message) };
  } else {
    const { data, error } = await supabase.from("checklist_templates").insert({ ...t, business_id: active.business_id }).select("id").single();
    if (error) return { error: error.code === "23505" ? "There's already a checklist with that name." : error.code === "42501" ? "You don't have permission to add checklists." : friendly(error.message) };
    templateId = data.id;
  }
  const { error } = await supabase
    .from("checklist_template_tasks")
    .insert(tasks.map((x, i) => ({ ...x, business_id: active.business_id, template_id: templateId, sort: i + 1 })));
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app/joiners-leavers/checklists");
  return { ok: true, message: "Checklist saved. New joiners and leavers get this list; ones already started keep theirs." };
}

export async function deleteTemplate(id: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error, count } = await supabase.from("checklist_templates").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to remove checklists." };
  revalidatePath("/app/joiners-leavers/checklists");
  return { ok: true, message: "Removed." };
}
