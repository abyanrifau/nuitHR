/** How pay run statuses are shown. */
export const RUN_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  draft: { label: "Draft", tone: "neutral" },
  calculated: { label: "Ready to check", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  finalized: { label: "Finalized", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  reversed: { label: "Reversed", tone: "danger" },
};
