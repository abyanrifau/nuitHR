/**
 * The eight day statuses, with the short code and colour used in the
 * attendance register, calendars and reports. Colours are fixed hues that
 * read on both light and dark backgrounds; the code letters carry the
 * meaning too, so colour is never the only signal.
 */
export type DayStatus = "present" | "late" | "half_day" | "early_leave" | "absent" | "on_leave" | "holiday" | "rest_day";

export const DAY_STATUS: Record<DayStatus, { code: string; label: string; color: string; text: string }> = {
  present: { code: "P", label: "Present", color: "#16a34a", text: "#ffffff" },
  late: { code: "L", label: "Late", color: "#d97706", text: "#ffffff" },
  half_day: { code: "HD", label: "Half day", color: "#7c3aed", text: "#ffffff" },
  early_leave: { code: "EL", label: "Early leave", color: "#ea580c", text: "#ffffff" },
  absent: { code: "A", label: "Absent (unapproved)", color: "#dc2626", text: "#ffffff" },
  on_leave: { code: "LV", label: "On leave", color: "#2563eb", text: "#ffffff" },
  holiday: { code: "H", label: "Holiday", color: "#0891b2", text: "#ffffff" },
  rest_day: { code: "R", label: "Rest day", color: "#6b7280", text: "#ffffff" },
};

export const STATUS_ORDER: DayStatus[] = ["present", "late", "half_day", "early_leave", "absent", "on_leave", "holiday", "rest_day"];

export const OT_TYPE_LABEL: Record<string, string> = { normal: "Normal day", rest_day: "Rest day", holiday: "Public holiday" };

export interface AttendanceDay {
  employee_id: string;
  day: string;
  kind: "working" | "rest" | "holiday";
  status: DayStatus | null;
  worked_minutes: number;
  late_minutes: number;
  early_leave_minutes: number;
  overtime_minutes: number;
  overtime_type: string | null;
  overtime_state: "approved" | "pending" | "rejected" | null;
  record_id: string | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  leave_name: string | null;
  missing_clock_out: boolean;
  source: string | null;
}

export interface AttendanceMonth {
  employee_id: string;
  month: string;
  days_in_month: number;
  days_employed: number;
  working_days: number;
  days_present: number;
  half_days: number;
  unapproved_absences: number;
  approved_absences: number;
  late_count: number;
  late_minutes: number;
  early_leaves: number;
  longest_absence_run: number;
  rest_days: number;
  holidays: number;
  worked_minutes: number;
  overtime_normal_minutes: number;
  overtime_rest_day_minutes: number;
  overtime_holiday_minutes: number;
  overtime_pending_minutes: number;
  overtime_over_cap_minutes: number;
  locked_at: string | null;
}

/** "7h 30m" */
export function hm(minutes: number | null | undefined): string {
  const m = Math.round(minutes ?? 0);
  if (!m) return "0h";
  return `${Math.floor(m / 60)}h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}m` : ""}`;
}

/** Hours with two decimals, as payroll uses them: 450 minutes → "7.50". */
export const hours2 = (minutes: number) => (minutes / 60).toFixed(2);

/** "2026-02" from a query string, or this month; returns the first and last day. */
export function monthRange(param: string | undefined, today: string): { month: string; start: string; end: string; label: string; prev: string; next: string } {
  const month = param && /^\d{4}-\d{2}$/.test(param) ? param : today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  return {
    month,
    start: `${month}-01`,
    end: `${month}-${String(last).padStart(2, "0")}`,
    label: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1))),
    prev: shift(-1),
    next: shift(1),
  };
}
