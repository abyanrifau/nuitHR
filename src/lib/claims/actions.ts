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

const claimSchema = z.object({
  claim_type_id: z.string().uuid("Choose a type of claim."),
  claim_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the date."),
  amount: z.coerce.number().positive("Enter the amount.").max(1_000_000),
  description: z.string().trim().max(500).optional(),
  route: z.string().trim().max(200).optional(),
  receipt_path: z.string().max(400).optional(),
});

/** Staff send a claim. The database checks the limits and the receipt, then sends it for approval. */
export async function submitClaim(input: unknown): Promise<ActionResult> {
  const active = await business();
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_claim", {
    p_business: active.business_id,
    p_type: d.claim_type_id,
    p_date: d.claim_date,
    p_amount: d.amount,
    p_description: d.description || null,
    p_route: d.route || null,
    p_receipt: d.receipt_path || null,
  });
  if (error) {
    if (d.receipt_path) await supabase.storage.from("tenant-files").remove([d.receipt_path]);
    return { error: friendly(error.message) };
  }
  sendEmailsAfterResponse(active.business_id);
  revalidatePath("/staff/claims");
  revalidatePath("/staff/requests");
  revalidatePath("/app/claims");
  return { ok: true, message: "Sent for approval." };
}

export async function decideClaim(claimId: string, decision: "approve" | "reject", comment?: string): Promise<ActionResult> {
  const active = await business();
  const supabase = await createClient();
  const { data: ar } = await supabase.from("approval_requests").select("id").eq("source_table", "claims").eq("source_id", claimId).maybeSingle();
  if (!ar) return { error: "This claim isn't waiting for a decision." };
  const { error } = await supabase.rpc("decide_request", { p_request: ar.id, p_decision: decision, p_comment: comment ?? null });
  if (error) return { error: friendly(error.message) };
  sendEmailsAfterResponse(active.business_id);
  revalidatePath("/app/claims");
  return { ok: true, message: decision === "approve" ? "Approved." : "Declined." };
}

export async function markClaimsPaid(ids: string[], reference: string): Promise<ActionResult> {
  const active = await business();
  if (!z.array(z.string().uuid()).min(1).max(500).safeParse(ids).success) return { error: "Choose claims to mark." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_claims_paid", { p_business: active.business_id, p_ids: ids, p_reference: reference });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/app/claims");
  return { ok: true, message: `Marked ${data} as paid.` };
}

export async function receiptLink(path: string): Promise<{ url?: string; error?: string }> {
  const active = await business();
  if (!path.startsWith(`${active.business_id}/`)) return { error: "You can't open this receipt." };
  const supabase = await createClient();
  const { data } = await supabase.storage.from("tenant-files").createSignedUrl(path, 120);
  return data ? { url: data.signedUrl } : { error: "You can't open this receipt." };
}
