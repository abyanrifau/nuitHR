import { TabNav } from "@/components/ui/tab-nav";

/** The parts of Time off, across the top of each of its pages. */
export function TimeOffTabs({ current, canEdit }: { current: string; canEdit: boolean }) {
  const tabs = [
    { key: "requests", label: "Requests", href: "/app/time-off" },
    { key: "balances", label: "Balances", href: "/app/time-off?tab=balances" },
    { key: "documents", label: "Documents", href: "/app/time-off?tab=documents" },
    { key: "calendar", label: "Calendar", href: "/app/time-off/calendar" },
    { key: "holidays", label: "Holidays", href: "/app/time-off/holidays" },
    ...(canEdit
      ? [
          { key: "types", label: "Leave types", href: "/app/time-off/types" },
          { key: "grants", label: "Granted leave", href: "/app/time-off/grants" },
        ]
      : []),
  ];
  return <TabNav label="Time off" tabs={tabs} current={current} />;
}
