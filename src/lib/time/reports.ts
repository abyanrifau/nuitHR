import "server-only";
import type { BusinessAccess } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { loadAttendanceMonth } from "./attendance-data";
import { hours2, type AttendanceDay } from "./day-status";

export type ReportKind = "late" | "absence" | "overtime" | "hours";

export const REPORTS: { key: ReportKind; label: string; description: string }[] = [
  { key: "late", label: "Lateness", description: "Who arrived late, how often, and by how much." },
  { key: "absence", label: "Absences", description: "Unapproved absences, time off, half days and the longest run of absences." },
  { key: "overtime", label: "Overtime", description: "Overtime counted by kind of day, waiting for approval, and over the monthly limit." },
  { key: "hours", label: "Hours worked", description: "Working days, days present and hours worked." },
];

export interface Report {
  title: string;
  /** A line shown under the title, such as a reminder to check rates. */
  note?: string;
  columns: { label: string; numeric?: boolean }[];
  rows: (string | number)[][];
}

const dayList = (days: AttendanceDay[], match: (d: AttendanceDay) => boolean, fmt: string) =>
  days
    .filter(match)
    .map((d) => formatDate(d.day, fmt).slice(0, 5))
    .join(", ");

/** One report for a month, for the people the viewer may see. Hours are decimal, as payroll uses them. */
export async function buildReport(active: BusinessAccess, range: { start: string; end: string; label: string }, kind: ReportKind, filters: { branch?: string; department?: string } = {}): Promise<Report> {
  const { people, days, summaries } = await loadAttendanceMonth(active, range, filters);
  const base = (p: (typeof people)[number]) => [p.code, p.name, p.department ?? ""];
  const head = [{ label: "Employee no." }, { label: "Name" }, { label: "Team" }];
  const title = `${REPORTS.find((r) => r.key === kind)!.label}, ${range.label}`;
  const fmt = active.date_format;

  if (kind === "late") {
    return {
      title,
      columns: [...head, { label: "Times late", numeric: true }, { label: "Minutes late", numeric: true }, { label: "Days" }],
      rows: people
        .map((p) => ({ p, m: summaries.get(p.id), d: days.get(p.id) ?? [] }))
        .filter((x) => (x.m?.late_count ?? 0) > 0)
        .sort((a, b) => (b.m?.late_minutes ?? 0) - (a.m?.late_minutes ?? 0))
        .map(({ p, m, d }) => [...base(p), m!.late_count, m!.late_minutes, dayList(d, (x) => x.late_minutes > 0, fmt)]),
    };
  }
  if (kind === "absence") {
    return {
      title,
      columns: [
        ...head,
        { label: "Unapproved absences", numeric: true },
        { label: "On approved time off", numeric: true },
        { label: "Half days", numeric: true },
        { label: "Longest run of absences", numeric: true },
        { label: "Days absent" },
      ],
      rows: people
        .map((p) => ({ p, m: summaries.get(p.id), d: days.get(p.id) ?? [] }))
        .filter((x) => x.m && (x.m.unapproved_absences || x.m.approved_absences || x.m.half_days))
        .sort((a, b) => (b.m?.unapproved_absences ?? 0) - (a.m?.unapproved_absences ?? 0))
        .map(({ p, m, d }) => [...base(p), m!.unapproved_absences, m!.approved_absences, m!.half_days, m!.longest_absence_run, dayList(d, (x) => x.status === "absent", fmt)]),
    };
  }
  if (kind === "overtime") {
    return {
      title,
      columns: [
        ...head,
        { label: "Normal days (hours)", numeric: true },
        { label: "Rest days (hours)", numeric: true },
        { label: "Public holidays (hours)", numeric: true },
        { label: "Total counted (hours)", numeric: true },
        { label: "Waiting for approval (hours)", numeric: true },
        { label: "Over the monthly limit (hours)", numeric: true },
      ],
      rows: people
        .map((p) => ({ p, m: summaries.get(p.id) }))
        .filter((x) => x.m && (x.m.overtime_normal_minutes || x.m.overtime_rest_day_minutes || x.m.overtime_holiday_minutes || x.m.overtime_pending_minutes || x.m.overtime_over_cap_minutes))
        .map(({ p, m }) => {
          const total = m!.overtime_normal_minutes + m!.overtime_rest_day_minutes + m!.overtime_holiday_minutes;
          return [
            ...base(p),
            Number(hours2(m!.overtime_normal_minutes)),
            Number(hours2(m!.overtime_rest_day_minutes)),
            Number(hours2(m!.overtime_holiday_minutes)),
            Number(hours2(total)),
            Number(hours2(m!.overtime_pending_minutes)),
            Number(hours2(m!.overtime_over_cap_minutes)),
          ];
        }),
    };
  }
  return {
    title,
    columns: [
      ...head,
      { label: "Working days", numeric: true },
      { label: "Days present", numeric: true },
      { label: "Half days", numeric: true },
      { label: "Hours worked", numeric: true },
      { label: "Average hours a day", numeric: true },
    ],
    rows: people
      .map((p) => ({ p, m: summaries.get(p.id) }))
      .filter((x) => x.m)
      .map(({ p, m }) => {
        const attended = m!.days_present + m!.half_days;
        return [...base(p), m!.working_days, m!.days_present, m!.half_days, Number(hours2(m!.worked_minutes)), attended ? Number(hours2(m!.worked_minutes / attended)) : 0];
      }),
  };
}
