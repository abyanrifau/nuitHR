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
const half = z.enum(["full", "first_half", "second_half"]).default("full");

const requestSchema = z.object({
  leave_type_id: z.string().uuid("Choose a type of time off."),
  start_date: date,
  end_date: date,
  start_half: half,
  end_half: half,
  reason: z.string().trim().max(500).optional(),
  attachment_path: z.string().max(400).optional(),
});

function refresh() {
  revalidatePath("/staff/time-off");
  revalidatePath("/staff/requests");
  revalidatePath("/staff");
  revalidatePath("/app/time-off");
}

/** Staff ask for time off. The database checks the rules and the balance, then sends it for approval. */
export async function requestLeave(input: unknown): Promise<ActionResult> {
  const active = await business();
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_leave", {
    p_business: active.business_id,
    p_type: d.leave_type_id,
    p_start: d.start_date,
    p_end: d.end_date < d.start_date ? d.start_date : d.end_date,
    p_start_half: d.start_half,
    p_end_half: d.start_date === d.end_date ? d.start_half : d.end_half,
    p_reason: d.reason || null,
    p_attachment: d.attachment_path || null,
  });
  if (error) {
    if (d.attachment_path) await supabase.storage.from("tenant-files").remove([d.attachment_path]);
    return { error: friendly(error.message) };
  }
  sendEmailsAfterResponse(active.business_id);
  refresh();
  return { ok: true, message: "Sent for approval." };
}

export interface LeavePreview {
  ok?: boolean;
  days?: number;
  error?: string;
  document?: "none" | "attached" | "later";
  document_due?: string | null;
}

/** Checks a request against every rule of its type before it's sent: days used, what's needed, or why it can't be asked. */
export async function previewLeave(input: unknown, hasDocument: boolean): Promise<LeavePreview> {
  const active = await business();
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  if (d.end_date < d.start_date) return { error: "The last day must be on or after the first day." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_my_leave", {
    p_business: active.business_id,
    p_type: d.leave_type_id,
    p_start: d.start_date,
    p_end: d.end_date,
    p_start_half: d.start_half,
    p_end_half: d.start_date === d.end_date ? d.start_half : d.end_half,
    p_has_document: hasDocument,
  });
  if (error) return { error: friendly(error.message) };
  return data as LeavePreview;
}

/** Adds the document for time off already asked for (the file is uploaded from the browser first). */
export async function attachLeaveDocument(requestId: string, path: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error } = await supabase.rpc("attach_leave_document", { p_request: requestId, p_path: path });
  if (error) {
    await supabase.storage.from("tenant-files").remove([path]);
    return { error: friendly(error.message) };
  }
  refresh();
  return { ok: true, message: "Document added." };
}

/** HR gives more time for a document. Undoes the absence if the deadline had already passed. */
export async function extendLeaveDocument(requestId: string, due: string, reason: string): Promise<ActionResult> {
  const active = await business();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return { error: "Choose the new deadline." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("extend_leave_document", { p_request: requestId, p_due: due, p_reason: reason });
  if (error) return { error: friendly(error.message) };
  sendEmailsAfterResponse(active.business_id);
  refresh();
  revalidatePath("/app/time", "layout");
  return { ok: true, message: "New deadline saved." };
}

/** HR decides the document isn't needed. Undoes the absence if the deadline had already passed. */
export async function waiveLeaveDocument(requestId: string, reason: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error } = await supabase.rpc("waive_leave_document", { p_request: requestId, p_reason: reason });
  if (error) return { error: friendly(error.message) };
  refresh();
  revalidatePath("/app/time", "layout");
  return { ok: true, message: "Saved. The time off stands without a document." };
}

const recordSchema = requestSchema.extend({ employee_id: z.string().uuid("Choose a person.") });

/** HR enters approved time off for someone. */
export async function recordLeave(_: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = recordSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_leave", {
    p_business: active.business_id,
    p_employee: d.employee_id,
    p_type: d.leave_type_id,
    p_start: d.start_date,
    p_end: d.end_date < d.start_date ? d.start_date : d.end_date,
    p_start_half: d.start_half,
    p_end_half: d.start_date === d.end_date ? d.start_half : d.end_half,
    p_reason: d.reason || null,
  });
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: "Time off entered." };
}

export async function cancelApprovedLeave(id: string, reason: string): Promise<ActionResult> {
  await business();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_approved_leave", { p_request: id, p_reason: reason });
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: "Cancelled. The days are back in their balance." };
}

const adjustSchema = z.object({
  employee_id: z.string().uuid("Choose a person."),
  leave_type_id: z.string().uuid("Choose a type."),
  period_year: z.coerce.number().int().min(2000).max(2100),
  days: z.coerce
    .number()
    .min(-365)
    .max(365)
    .refine((v) => v !== 0 && Math.round(v * 2) === v * 2, "Use whole or half days, for example 2 or -1.5."),
  reason: z.string().trim().min(3, "Add a reason.").max(300),
});

export async function adjustBalance(_: ActionResult, form: FormData): Promise<ActionResult> {
  const active = await business();
  const parsed = adjustSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { error } = await supabase.from("leave_adjustments").insert({ ...parsed.data, business_id: active.business_id });
  if (error) return { error: error.code === "42501" ? "You don't have permission to change balances." : friendly(error.message) };
  refresh();
  return { ok: true, message: "Balance changed." };
}

export async function startLeaveYear(year: number): Promise<ActionResult> {
  const active = await business();
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_leave_year", { p_business: active.business_id, p_year: year });
  if (error) return { error: friendly(error.message) };
  refresh();
  return { ok: true, message: `${year} is set up. Everyone has their full days for the year.` };
}

/** Decide time off straight from the Time off page, using the same approval steps as the Requests list. */
export async function decideLeave(leaveId: string, decision: "approve" | "reject", comment?: string): Promise<ActionResult> {
  const active = await business();
  const supabase = await createClient();
  const { data: ar } = await supabase.from("approval_requests").select("id").eq("source_table", "leave_requests").eq("source_id", leaveId).maybeSingle();
  if (!ar) return { error: "This request isn't waiting for a decision." };
  const { error } = await supabase.rpc("decide_request", { p_request: ar.id, p_decision: decision, p_comment: comment ?? null });
  if (error) return { error: friendly(error.message) };
  sendEmailsAfterResponse(active.business_id);
  refresh();
  return { ok: true, message: decision === "approve" ? "Approved." : "Declined." };
}

/** A short-lived link to open a time off document. */
export async function leaveDocumentLink(path: string): Promise<{ url?: string; error?: string }> {
  const active = await business();
  if (!path.startsWith(`${active.business_id}/leave/`)) return { error: "You can't open this document." };
  const supabase = await createClient();
  const { data } = await supabase.storage.from("tenant-files").createSignedUrl(path, 120);
  return data ? { url: data.signedUrl } : { error: "You can't open this document." };
}
