/** Choices used on people forms and filters. */
export const STATUSES = [
  { value: "active", label: "Active", tone: "success" },
  { value: "probation", label: "On probation", tone: "info" },
  { value: "on_leave", label: "On leave", tone: "warning" },
  { value: "suspended", label: "Suspended", tone: "danger" },
  { value: "resigned", label: "Resigned", tone: "neutral" },
  { value: "terminated", label: "Let go", tone: "neutral" },
] as const;

export const CURRENT_STATUSES = ["active", "probation", "on_leave", "suspended"];
export const EXIT_STATUSES = ["resigned", "terminated"];

export const CONTRACT_TYPES = [
  { value: "permanent", label: "Permanent" },
  { value: "fixed_term", label: "Fixed term" },
  { value: "part_time", label: "Part time" },
  { value: "casual", label: "Casual" },
  { value: "intern", label: "Intern" },
  { value: "consultant", label: "Consultant" },
];

export const GENDERS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "undisclosed", label: "Prefer not to say" },
];

export const EXIT_REASONS = [
  { value: "Resigned", label: "Resigned" },
  { value: "End of contract", label: "End of contract" },
  { value: "Let go", label: "Let go" },
  { value: "Retired", label: "Retired" },
  { value: "Did not pass probation", label: "Did not pass probation" },
  { value: "Other", label: "Other" },
];

export const NATIONALITIES = [
  { value: "MV", label: "Maldivian" },
  { value: "IN", label: "Indian" },
  { value: "BD", label: "Bangladeshi" },
  { value: "LK", label: "Sri Lankan" },
  { value: "NP", label: "Nepali" },
  { value: "PH", label: "Filipino" },
  { value: "PK", label: "Pakistani" },
  { value: "TH", label: "Thai" },
  { value: "ID", label: "Indonesian" },
  { value: "CN", label: "Chinese" },
  { value: "GB", label: "British" },
  { value: "OT", label: "Other" },
];

export function statusMeta(status: string) {
  return STATUSES.find((s) => s.value === status) ?? { value: status, label: status, tone: "neutral" as const };
}
