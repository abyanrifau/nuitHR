"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { sendEmailsAfterResponse } from "@/lib/notifications/deliver";

const optUuid = z
  .union([z.literal(""), z.string().uuid()])
  .transform((v) => v || null)
  .optional();
const optDate = z
  .union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)])
  .transform((v) => v || null)
  .optional();

const postSchema = z.object({
  title: z.string().trim().min(3, "Add a headline.").max(160),
  body: z.string().trim().min(1, "Write the news.").max(10000),
  branch_id: optUuid,
  department_id: optUuid,
  is_pinned: z.coerce.boolean().optional(),
  when: z.enum(["now", "later", "draft"]),
  publish_at: optDate,
  expires_at: optDate,
});

/** Times typed in the company's own time zone (Maldives is +05:00). */
function toTimestamp(v: string | null | undefined, offset: string) {
  if (!v) return null;
  return v.length === 10 ? `${v}T00:00:00${offset}` : `${v}:00${offset}`;
}

function offsetFor(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" }).formatToParts(new Date());
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+05:00";
  return tz === "GMT" ? "+00:00" : tz.replace("GMT", "");
}

export async function savePost(id: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = postSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const p = parsed.data;
  if (p.when === "later" && !p.publish_at) return { error: "Choose when to post it.", fieldErrors: { publish_at: ["Choose a date and time."] } };
  const offset = offsetFor(active.timezone);
  const published_at = p.when === "now" ? new Date().toISOString() : p.when === "later" ? toTimestamp(p.publish_at, offset) : null;
  const expires_at = p.expires_at ? toTimestamp(p.expires_at.slice(0, 10), offset)?.replace("T00:00:00", "T23:59:59") : null;
  if (published_at && expires_at && expires_at <= published_at) return { error: "The end date must be after it's posted." };
  const row = { title: p.title, body: p.body, branch_id: p.branch_id, department_id: p.department_id, is_pinned: p.is_pinned ?? false, published_at, expires_at };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("announcements").update(row).eq("id", id) : await supabase.from("announcements").insert({ ...row, business_id: active.business_id });
  if (error) return { error: error.code === "42501" ? "You don't have permission to post news." : friendly(error.message) };
  if (p.when === "now") sendEmailsAfterResponse(active.business_id);
  revalidatePath("/app/news");
  return { ok: true, message: p.when === "now" ? "Posted." : p.when === "later" ? "Scheduled." : "Saved as a draft." };
}

export async function deletePost(id: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error, count } = await supabase.from("announcements").delete({ count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to remove news." };
  revalidatePath("/app/news");
  return { ok: true, message: "Removed." };
}
