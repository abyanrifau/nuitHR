import type { ModuleKey } from "@/modules/types";

/** Plain names for each kind of request, and which tool it belongs to. */
export const REQUEST_TYPES: { key: string; label: string; module: ModuleKey; usesAmount?: boolean }[] = [
  { key: "leave", label: "Time off", module: "leave" },
  { key: "claim", label: "Claims", module: "claims", usesAmount: true },
  { key: "attendance_correction", label: "Clock-in fixes", module: "attendance" },
  { key: "timesheet", label: "Timesheets", module: "attendance" },
  { key: "letter_request", label: "Letters", module: "documents" },
  { key: "training_sponsorship", label: "Training sponsorship", module: "learning", usesAmount: true },
];

export function requestTypeLabel(key: string): string {
  return REQUEST_TYPES.find((t) => t.key === key)?.label ?? key.replace(/_/g, " ");
}

export const REQUEST_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "Waiting", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
