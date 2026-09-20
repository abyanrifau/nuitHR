/**
 * Writes the Supabase sign-in and confirmation emails into
 * supabase/email-templates/, using Harbor's own email design, so the
 * emails Supabase sends look like the ones Harbor sends.
 *
 *   npx tsx scripts/email-templates.ts
 *
 * Then paste each file into Supabase → Authentication → Emails.
 * The {{ .ConfirmationURL }} bits are filled in by Supabase.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { appConfig } from "../src/config/app.config";
import { emailButton, emailLayout, emailNote } from "../src/lib/email/design";

const brand = appConfig.brand.name;
const URL_TOKEN = "__CONFIRMATION_URL__";
const CODE_TOKEN = "__TOKEN__";

const TEMPLATES: { file: string; subject: string; title: string; preheader: string; body: string; button?: string }[] = [
  {
    file: "confirm-signup.html",
    subject: `Confirm your email for ${brand}`,
    title: "Confirm your email",
    preheader: `One tap and your ${brand} account is ready.`,
    body: `<p style="margin:0 0 14px">Thanks for signing up. Confirm this email address and your ${brand} account is ready to use.</p>`,
    button: "Confirm email",
  },
  {
    file: "magic-link.html",
    subject: `Your ${brand} sign-in link`,
    title: "Your sign-in link",
    preheader: `Your sign-in link for ${brand}. It expires shortly.`,
    body: `<p style="margin:0 0 14px">Tap the button below to sign in. No password needed.</p>`,
    button: "Sign in",
  },
  {
    file: "reset-password.html",
    subject: `Reset your ${brand} password`,
    title: "Reset your password",
    preheader: "Choose a new password for your account.",
    body: `<p style="margin:0 0 14px">We got a request to reset the password for your ${brand} account. Choose a new one below.</p>`,
    button: "Choose a new password",
  },
  {
    file: "email-change.html",
    subject: `Confirm your new email for ${brand}`,
    title: "Confirm your new email",
    preheader: "Confirm the new address for your account.",
    body: `<p style="margin:0 0 14px">Confirm this address so we can use it for your ${brand} account from now on.</p>`,
    button: "Confirm new email",
  },
  {
    file: "invite.html",
    subject: `You've been invited to ${brand}`,
    title: `You've been invited to ${brand}`,
    preheader: `Set up your ${brand} account.`,
    body: `<p style="margin:0 0 14px">Someone has invited you to ${brand}. Accept below to set up your account.</p>`,
    button: "Accept and set up",
  },
  {
    file: "reauthentication.html",
    subject: `Your ${brand} verification code`,
    title: "Your verification code",
    preheader: "Your verification code.",
    body: `<p style="margin:0 0 14px">Enter this code to confirm it's you:</p>
<p style="margin:0 0 4px;font-size:30px;font-weight:bold;letter-spacing:6px">${CODE_TOKEN}</p>`,
  },
];

mkdirSync("supabase/email-templates", { recursive: true });
const index: string[] = [];
for (const t of TEMPLATES) {
  const html = emailLayout(t.title, `${t.body}${t.button ? emailButton(URL_TOKEN, t.button) : ""}${emailNote("This link expires shortly and can only be used once. If you didn't ask for it, you can ignore this email.")}`, {
    preheader: t.preheader,
  })
    .replaceAll(URL_TOKEN, "{{ .ConfirmationURL }}")
    .replaceAll(CODE_TOKEN, "{{ .Token }}");
  writeFileSync(`supabase/email-templates/${t.file}`, html);
  index.push(`${t.file.padEnd(26)} subject: ${t.subject}`);
}
writeFileSync("supabase/email-templates/README.txt", `Paste each file into Supabase -> Authentication -> Emails.\nRebuild them with: npx tsx scripts/email-templates.ts\n\n${index.join("\n")}\n`);
console.log(index.join("\n"));
