import { writeFileSync } from "node:fs";
import { emailButton, emailFacts, emailLayout, emailNote, emailParagraphs } from "../src/lib/email/design";

const out = process.argv[2];
const link = "https://harbor.nuit.works/invite/4f8a2c1e9b";
const samples: [string, string][] = [
  [
    "invitation",
    emailLayout(
      "Join Coral Bay Resort",
      `<p style="margin:0 0 14px">Aishath Nasheed has invited you to Coral Bay Resort on Harbor, where the team handles people, time, leave and pay.</p>${emailFacts([
        ["Company", "Coral Bay Resort"],
        ["Your access", "Manager"],
        ["Invited by", "Aishath Nasheed"],
      ])}${emailButton(link, "Accept invitation")}${emailNote("The link works for 14 days and only once. If you weren't expecting this, you can safely ignore this email.")}`,
      { preheader: "Aishath Nasheed has invited you to Coral Bay Resort on Harbor." },
    ),
  ],
  [
    "sign-in",
    emailLayout(
      "Your sign-in link",
      `<p style="margin:0 0 14px">Tap the button below to sign in. No password needed.</p>${emailButton("https://harbor.nuit.works/auth/confirm?token=abc", "Sign in")}${emailNote("This link expires shortly and can only be used once. If you didn't ask for it, you can ignore this email.")}`,
      { preheader: "Your sign-in link for Harbor. It expires shortly." },
    ),
  ],
  [
    "billing",
    emailLayout(
      "Your Harbor free trial ends on 05/10/2026",
      `${emailParagraphs(
        "The free trial for Coral Bay Resort ends on 05/10/2026.\n\nTo keep using Harbor, pay by bank transfer or mobile payment and send us the receipt. Payment details are in Workspace, Billing. If the trial ends without payment, you keep full access for 7 more days, then the account becomes read-only until payment arrives.",
      )}${emailButton("https://harbor.nuit.works/app/workspace/billing", "See billing details")}`,
      { preheader: "The free trial for Coral Bay Resort ends on 05/10/2026." },
    ),
  ],
  [
    "notification",
    emailLayout(
      "Your payslip for September is ready",
      `${emailParagraphs("Your payslip for September 2026 has been published. You can open it, download it as a PDF or check the breakdown.")}${emailButton("https://harbor.nuit.works/staff/pay", "Open Harbor")}${emailNote("Coral Bay Resort. You can change which emails you get in your account settings.")}`,
      { preheader: "Your payslip for September 2026 has been published." },
    ),
  ],
];
for (const [name, html] of samples) writeFileSync(`${out}/${name}.html`, html);
writeFileSync(
  `${out}/all.html`,
  `<div style="background:#f2f2f3">${samples.map(([n, h]) => `<div style="font:12px monospace;color:#888;padding:10px 20px 0">${n}</div>${h.slice(h.indexOf("<body"))}`).join("")}</div>`,
);
console.log("written");
