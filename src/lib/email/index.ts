import "server-only";
import { nuitWorksUrl } from "@/lib/brand";
import { appConfig } from "@/config/app.config";

export { emailButton, emailFacts, emailLayout, emailNote, emailParagraphs, escapeHtml } from "./design";

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
  /** Files sent with the email, such as a payslip PDF. */
  attachments?: { filename: string; content: Uint8Array }[];
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
        body: JSON.stringify({
          from: from(),
          to: [m.to],
          subject: m.subject,
          html: m.html,
          text: m.text,
          ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: Buffer.from(a.content).toString("base64") })) } : {}),
        }),
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
    const files = m.attachments?.length ? `\n[email] Attached: ${m.attachments.map((a) => `${a.filename} (${Math.round(a.content.length / 1024)} KB)`).join(", ")}` : "";
    console.info(`\n[email] To: ${m.to}\n[email] Subject: ${m.subject}${files}\n${m.text}\n`);
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
  const text = `${message.text}

--
Sent by ${appConfig.brand.name}, built by ${appConfig.brand.byline.studio}: ${nuitWorksUrl("email")}`;
  return provider().send({ ...message, text });
}

