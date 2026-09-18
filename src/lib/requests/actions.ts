"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { sendEmailsAfterResponse } from "@/lib/notifications/deliver";

const decideSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Choose at least one request.").max(100),
  decision: z.enum(["approve", "reject"]),
  comment: z.string().trim().max(1000).optional(),
});

/** Approve or decline one or many requests. Each one is checked separately by the database. */
export async function decideRequests(input: unknown): Promise<ActionResult & { done?: number; failed?: { id: string; error: string }[] }> {
  await requireUser();
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (parsed.data.decision === "reject" && !parsed.data.comment) return { error: "Add a short note so they know why." };
  const supabase = await createClient();
  let done = 0;
  const failed: { id: string; error: string }[] = [];
  for (const id of parsed.data.ids) {
    const { error } = await supabase.rpc("decide_request", { p_request: id, p_decision: parsed.data.decision, p_comment: parsed.data.comment ?? null });
    if (error) failed.push({ id, error: friendly(error.message) });
    else done++;
  }
  revalidatePath("/app/requests");
  revalidatePath("/app", "layout");
  const active = await getActiveBusiness();
  if (active && done) sendEmailsAfterResponse(active.business_id);
  const verb = parsed.data.decision === "approve" ? "Approved" : "Declined";
  if (done === 0) return { error: failed[0]?.error ?? "Nothing was changed.", failed };
  return { ok: true, done, failed, message: failed.length ? `${verb} ${done}. ${failed.length} couldn't be changed.` : `${verb} ${done === 1 ? "" : `${done} requests`}`.trim() + "." };
}

export async function cancelRequest(id: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_request", { p_request: id });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app/requests");
  return { ok: true, message: "Request cancelled." };
}

const delegationSchema = z
  .object({
    delegate_user_id: z.string().uuid("Choose who will stand in."),
    starts_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
    ends_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date."),
    reason: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.ends_at >= v.starts_at, { message: "The end date must be after the start date.", path: ["ends_at"] });

/** Let a colleague decide your requests while you're away. */
export async function createDelegation(_: ActionResult, form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = delegationSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  if (parsed.data.delegate_user_id === user.id) return { error: "Choose someone other than yourself." };
  const supabase = await createClient();
  const { error } = await supabase.from("approval_delegations").insert({
    business_id: active.business_id,
    delegator_user_id: user.id,
    delegate_user_id: parsed.data.delegate_user_id,
    starts_at: `${parsed.data.starts_at}T00:00:00+05:00`,
    ends_at: `${parsed.data.ends_at}T23:59:59+05:00`,
    reason: parsed.data.reason || null,
  });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app/requests");
  return { ok: true, message: "Stand-in set." };
}

export async function revokeDelegation(id: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error, count } = await supabase.from("approval_delegations").update({ revoked_at: new Date().toISOString() }, { count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You can't change this stand-in." };
  revalidatePath("/app/requests");
  return { ok: true, message: "Stand-in ended." };
}

const stepSchema = z.object({
  approver_type: z.enum(["direct_manager", "manager_of_manager", "department_head", "role", "user"]),
  approver_role_id: z.string().uuid().nullable().optional(),
  approver_user_id: z.string().uuid().nullable().optional(),
  min_amount: z.number().min(0).nullable().optional(),
});

const workflowSchema = z.object({
  request_type: z.string().min(2).max(60),
  steps: z
    .array(stepSchema)
    .max(5, "Up to five steps.")
    .refine((steps) => steps.every((s) => (s.approver_type !== "role" || s.approver_role_id) && (s.approver_type !== "user" || s.approver_user_id)), {
      message: "Choose a role or person for every step.",
    }),
});

/**
 * Replace the approval chain for one kind of request. An empty chain
 * means "use the default": the person's manager, then HR.
 */
export async function saveWorkflow(input: unknown): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = workflowSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { request_type, steps } = parsed.data;
  const supabase = await createClient();

  const { data: existing, error: readErr } = await supabase
    .from("approval_workflows")
    .select("id")
    .eq("business_id", active.business_id)
    .eq("request_type", request_type)
    .eq("is_default", true)
    .maybeSingle();
  if (readErr) return { error: friendly(readErr.message) };

  if (steps.length === 0) {
    if (existing) {
      const { error } = await supabase.from("approval_workflows").delete().eq("id", existing.id);
      if (error) return { error: error.code === "42501" ? "You don't have permission to change approval chains." : friendly(error.message) };
    }
    revalidatePath("/app/workspace/requests");
    return { ok: true, message: "Using the default chain." };
  }

  let workflowId = existing?.id as string | undefined;
  if (!workflowId) {
    const { data, error } = await supabase
      .from("approval_workflows")
      .insert({ business_id: active.business_id, request_type, name: request_type, is_default: true })
      .select("id")
      .single();
    if (error) return { error: error.code === "42501" ? "You don't have permission to change approval chains." : friendly(error.message) };
    workflowId = data.id;
  } else {
    const { error } = await supabase.from("approval_workflow_steps").delete().eq("workflow_id", workflowId);
    if (error) return { error: friendly(error.message) };
  }
  const { error } = await supabase.from("approval_workflow_steps").insert(
    steps.map((s, i) => ({
      business_id: active.business_id,
      workflow_id: workflowId,
      step_order: i + 1,
      approver_type: s.approver_type,
      approver_role_id: s.approver_type === "role" ? s.approver_role_id : null,
      approver_user_id: s.approver_type === "user" ? s.approver_user_id : null,
      min_amount: s.min_amount ?? null,
    })),
  );
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app/workspace/requests");
  return { ok: true, message: "Approval chain saved. New requests follow it; ones already waiting keep their chain." };
}
