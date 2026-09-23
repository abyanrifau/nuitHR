/** The date range for a payroll report: a month (by pay day) or, for year-to-date, the year so far. */
export function payReportRange(yearly: boolean, month: string | undefined, year: string | undefined, today: string) {
  if (yearly) {
    const y = year && /^\d{4}$/.test(year) ? year : today.slice(0, 4);
    const end = y === today.slice(0, 4) ? today : `${y}-12-31`;
    return { start: `${y}-01-01`, end, label: y === today.slice(0, 4) ? `${y} so far` : y, key: y };
  }
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : today.slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const end = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, mo - 1, 1)));
  return { start: `${m}-01`, end, label: `paid in ${label}`, key: m };
}
