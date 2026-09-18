"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { friendly } from "@/lib/errors";
import { sendEmailsAfterResponse } from "@/lib/notifications/deliver";

export interface ApplyState {
  error?: string;
  done?: boolean;
}

const schema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,80}$/),
  vacancy_id: z.string().uuid(),
  full_name: z.string().trim().min(2, "Enter your full name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  phone: z.string().trim().max(40).optional(),
  cover_letter: z.string().trim().max(5000).optional(),
});

const TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** Public job application. The CV is checked here and stored privately; only the hiring company can open it. */
export async function apply(_: ApplyState, form: FormData): Promise<ApplyState> {
  if (String(form.get("website") ?? "")) return { done: true };
  const parsed = schema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const supabase = await createClient();

  // Which company this is for (and that it's taking applications) before storing anything.
  const { data: careers } = await supabase.rpc("get_public_careers", { p_slug: d.slug });
  const open = (careers as { vacancies: { id: string }[] } | null)?.vacancies.some((v) => v.id === d.vacancy_id);
  if (!open) return { error: "This role isn't open for applications any more." };

  let cvPath: string | null = null;
  const cv = form.get("cv");
  if (cv instanceof File && cv.size > 0) {
    if (cv.size > 2 * 1024 * 1024) return { error: "The CV must be smaller than 2 MB." };
    const ext = TYPES[cv.type];
    if (!ext) return { error: "Send your CV as a PDF, Word file or photo." };
    if (!isAdminConfigured()) return { error: "Uploading isn't available right now. Apply without a CV, or try later." };
    const admin = createAdminClient();
    const { data: v } = await admin.from("vacancies").select("business_id").eq("id", d.vacancy_id).single();
    cvPath = `${v!.business_id}/recruitment/${crypto.randomUUID()}/cv.${ext}`;
    const { error } = await admin.storage.from("tenant-files").upload(cvPath, cv, { contentType: cv.type });
    if (error) return { error: "Your CV didn't upload. Please try again." };
  }

  const { error } = await supabase.rpc("submit_application", {
    p_slug: d.slug,
    p_vacancy: d.vacancy_id,
    p_full_name: d.full_name,
    p_email: d.email,
    p_phone: d.phone || null,
    p_cover_letter: d.cover_letter || null,
    p_cv_path: cvPath,
  });
  if (error) {
    if (cvPath) await createAdminClient().storage.from("tenant-files").remove([cvPath]);
    return { error: friendly(error.message) };
  }
  if (isAdminConfigured()) {
    const { data: v } = await createAdminClient().from("vacancies").select("business_id").eq("id", d.vacancy_id).single();
    if (v) sendEmailsAfterResponse(v.business_id);
  }
  return { done: true };
}
