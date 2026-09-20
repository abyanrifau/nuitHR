import { nuitWorksUrl } from "@/lib/brand";
import { appConfig } from "@/config/app.config";

/**
 * The look of every email Harbor sends. Kept to tables and inline styles,
 * because email programs (Outlook especially) ignore stylesheets.
 *
 *   emailLayout("Your payslip is ready", "<p>...</p>" + emailButton(url, "Open"))
 *
 * `preheader` is the grey line of text inboxes show next to the subject.
 * If you leave it out, the inbox shows the start of the email instead.
 */
const INK = "#101113";
const MUTED = "#6b7280";
const HAIRLINE = "#e8e8ea";
const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

export function emailLayout(title: string, bodyHtml: string, options: { preheader?: string } = {}): string {
  const brand = escapeHtml(appConfig.brand.name);
  const studio = escapeHtml(appConfig.brand.byline.studio);
  const site = escapeHtml(appConfig.brand.siteUrl);
  const preheader = options.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0">${escapeHtml(options.preheader)}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f2f2f3;color:${INK};font-family:${FONT};-webkit-font-smoothing:antialiased">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2f2f3">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid ${HAIRLINE};border-radius:14px;overflow:hidden">
<tr><td style="background:${INK};padding:22px 32px">
<a href="${site}" style="color:#ffffff;text-decoration:none;font-size:22px;font-weight:bold;letter-spacing:-0.6px">${brand}.</a>
</td></tr>
<tr><td style="padding:34px 32px 32px">
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;font-weight:bold;letter-spacing:-0.3px;color:${INK}">${escapeHtml(title)}</h1>
<div style="font-size:15px;line-height:1.65;color:#2b2d31">${bodyHtml}</div>
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:${MUTED};text-align:center">
Sent by <a href="${site}" style="color:${MUTED};text-decoration:none">${brand}</a>, built by <a href="${escapeHtml(nuitWorksUrl("email"))}" target="_blank" rel="noopener" style="color:${MUTED};text-decoration:underline">${studio}</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** The main action in an email: a black button that still works in Outlook. */
export function emailButton(href: string, label: string): string {
  const url = escapeHtml(href);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0"><tr>
<td bgcolor="${INK}" style="border-radius:10px">
<a href="${url}" style="display:inline-block;padding:13px 24px;font-family:${FONT};font-size:15px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(label)}</a>
</td></tr></table>
<p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:${MUTED}">Button not working? Copy this link into your browser:<br>
<a href="${url}" style="color:${MUTED};word-break:break-all">${url}</a></p>`;
}

/** Small grey print at the end of an email, for expiry notes and the like. */
export function emailNote(text: string): string {
  return `<p style="margin:22px 0 0;padding-top:18px;border-top:1px solid ${HAIRLINE};font-size:13px;line-height:1.6;color:${MUTED}">${escapeHtml(text)}</p>`;
}

/** Turns plain paragraphs (split by blank lines) into email HTML. */
export function emailParagraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** A short list of facts, such as company, role and start date. */
export function emailFacts(rows: [string, string][]): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;border:1px solid ${HAIRLINE};border-radius:10px">
${rows
  .map(
    ([k, v], i) =>
      `<tr><td style="padding:11px 16px;font-size:13px;color:${MUTED};${i ? `border-top:1px solid ${HAIRLINE}` : ""}">${escapeHtml(k)}</td>
<td style="padding:11px 16px;font-size:14px;color:${INK};text-align:right;${i ? `border-top:1px solid ${HAIRLINE}` : ""}">${escapeHtml(v)}</td></tr>`,
  )
  .join("")}
</table>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]!);
}
