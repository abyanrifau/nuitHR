import "server-only";
import { appConfig } from "@/config/app.config";

/**
 * Sending email. The provider can be swapped: "resend" (real emails) or
 * "console" (prints emails in the terminal, handy while testing). Add
 * another provider by implementing EmailProvider below.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  ok: boolean;
  provider: string;
  error?: string;
}

interface EmailProvider {
  name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

const from = () => `${appConfig.email.fromName} <${appConfig.email.fromAddress}>`;

const resend: EmailProvider = {
  name: "resend",
  async send(m) {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { ok: false, provider: "resend", error: "Email sending isn't set up yet (RESEND_API_KEY is missing)." };
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: from(), to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        return { ok: false, provider: "resend", error: body.message ?? `Email service returned ${res.status}` };
      }
      return { ok: true, provider: "resend" };
    } catch (e) {
      return { ok: false, provider: "resend", error: (e as Error).message };
    }
  },
};

const consoleProvider: EmailProvider = {
  name: "console",
  async send(m) {
    console.info(`\n[email] To: ${m.to}\n[email] Subject: ${m.subject}\n${m.text}\n`);
    return { ok: true, provider: "console" };
  },
};

function provider(): EmailProvider {
  if (appConfig.email.provider === "console") return consoleProvider;
  // Without a key on your own computer, print emails instead of failing.
  if (!process.env.RESEND_API_KEY && process.env.NODE_ENV !== "production") return consoleProvider;
  return resend;
}

export async function sendEmail(message: EmailMessage): Promise<SendResult> {
  return provider().send(message);
}

/** Wraps content in a simple, branded email layout. */
export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#000000">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #ebebeb;border-radius:10px">
<tr><td style="padding:20px 24px;border-bottom:1px solid #ebebeb;font-weight:bold;font-size:18px;letter-spacing:-0.5px;color:#000000">${escapeHtml(appConfig.brand.name)}.</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(title)}</h1>${bodyHtml}</td></tr>
</table>
<p style="font-size:12px;color:#8a93a1;margin-top:16px">${escapeHtml(appConfig.brand.legalName)}</p>
</td></tr></table></body></html>`;
}

export function emailButton(href: string, label: string): string {
  return `<p style="margin:24px 0"><a href="${escapeHtml(href)}" style="background:#000000;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></p>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
