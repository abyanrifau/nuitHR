/** Display helpers that follow each company's date format and currency. */

/**
 * "2026-09-19" -> "19/09/2026" (or the company's chosen order). Full
 * timestamps are first turned into the company's local day, so something
 * sent at 01:00 Maldives time isn't shown as the day before.
 */
export function formatDate(value: string | null | undefined, format = "DD/MM/YYYY", timeZone = "Indian/Maldives"): string {
  if (!value) return "";
  if (value.length > 10) value = localDay(value, timeZone);
  const d = value.slice(0, 10).split("-");
  if (d.length !== 3) return value;
  const [y, m, day] = d;
  return format.replace("YYYY", y).replace("MM", m).replace("DD", day);
}

export function formatDateTime(value: string | null | undefined, format = "DD/MM/YYYY", timeZone = "Indian/Maldives"): string {
  if (!value) return "";
  const dt = new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(dt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${formatDate(`${get("year")}-${get("month")}-${get("day")}`, format)} ${get("hour")}:${get("minute")}`;
}

export function formatMoney(amount: number | string | null | undefined, currency = "MVR"): string {
  if (amount === null || amount === undefined || amount === "") return "";
  const n = Number(amount);
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "3 minutes ago", "yesterday", or a date. */
export function timeAgo(value: string, format = "DD/MM/YYYY"): string {
  const s = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "yesterday";
  if (s < 604800) return `${Math.floor(s / 86400)} days ago`;
  return formatDate(value, format);
}

export function fullName(p: { first_name?: string | null; last_name?: string | null; preferred_name?: string | null } | null | undefined): string {
  if (!p) return "";
  return [p.preferred_name || p.first_name, p.last_name].filter(Boolean).join(" ");
}

export function initials(p: { first_name?: string | null; last_name?: string | null } | null | undefined): string {
  if (!p) return "?";
  return `${p.first_name?.[0] ?? ""}${p.last_name?.[0] ?? ""}`.toUpperCase() || "?";
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The calendar day (YYYY-MM-DD) a moment falls on in a time zone. */
export function localDay(value: string | Date, timeZone = "Indian/Maldives"): string {
  const dt = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(dt.getTime())) return typeof value === "string" ? value.slice(0, 10) : "";
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(dt);
}

/** Today's date (YYYY-MM-DD) for the company, or for this browser when no time zone is given. */
export function today(timeZone?: string): string {
  return localDay(new Date(), timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}
