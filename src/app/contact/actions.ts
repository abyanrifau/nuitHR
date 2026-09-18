"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { appConfig } from "@/config/app.config";
import { escapeHtml, emailLayout, sendEmail } from "@/lib/email";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export interface ContactState {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  values?: Record<string, string>;
}

const schema = z.object({
  name: z.string().trim().min(2, "Tell us your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter an email we can reply to."),
  company: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  message: z.string().trim().min(10, "A little more detail helps us reply properly.").max(4000),
});

const recent = new Map<string, number>();

export async function sendContactMessage(_: ContactState, fd: FormData): Promise<ContactState> {
  const values = Object.fromEntries(["name", "email", "company", "phone", "message"].map((k) => [k, String(fd.get(k) ?? "")]));
  // Hidden field only bots fill in.
  if (String(fd.get("website") ?? "")) return { ok: true };

  const parsed = schema.safeParse(values);
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };

  // Light protection against repeated sends from the same address.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const last = recent.get(ip) ?? 0;
  if (Date.now() - last < 30_000) return { error: "Please wait a moment before sending another message.", values };
  recent.set(ip, Date.now());

  let stored = false;
  if (isAdminConfigured()) {
    const { error } = await createAdminClient().from("contact_messages").insert(parsed.data);
    stored = !error;
  }
  const d = parsed.data;
  const mailed = await sendEmail({
    to: appConfig.brand.salesEmail,
    subject: `New message from ${d.name}`,
    text: `${d.name} <${d.email}>${d.company ? `, ${d.company}` : ""}${d.phone ? `, ${d.phone}` : ""}\n\n${d.message}`,
    html: emailLayout(
      "New contact message",
      `<p><strong>${escapeHtml(d.name)}</strong> &lt;${escapeHtml(d.email)}&gt;${d.company ? `<br>${escapeHtml(d.company)}` : ""}${d.phone ? `<br>${escapeHtml(d.phone)}` : ""}</p><p style="white-space:pre-wrap">${escapeHtml(d.message)}</p>`,
    ),
  });

  if (!stored && !mailed.ok) {
    return { error: "We couldn't send that just now. Please message us on WhatsApp instead.", values };
  }
  return { ok: true };
}
