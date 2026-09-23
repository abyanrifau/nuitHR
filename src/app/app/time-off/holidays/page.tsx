import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { MALDIVES_HOLIDAY_YEARS } from "@/modules/data/holidays-mv";
import { cn } from "@/lib/utils";
import { TimeOffTabs } from "../sections";
import { DeleteHolidayButton, HolidayButton, LoadHolidaysButton } from "./holidays-client";

export const metadata: Metadata = { title: "Public holidays" };

export default async function HolidaysPage(props: PageProps<"/app/time-off/holidays">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "leave", "view", "team")) {
    return <Alert tone="warning" title="No access">Ask the owner or an admin if you need to see the holiday list.</Alert>;
  }
  const canEdit = can(ctx, "leave", "edit", "all");
  const today = localDay(new Date(), active.timezone);
  const year = Number(sp.year) || Number(today.slice(0, 4));
  const supabase = await createClient();
  const [{ data: holidays }, { data: branches }] = await Promise.all([
    supabase
      .from("public_holidays")
      .select("id, name, holiday_date, branch_id, is_optional")
      .eq("business_id", active.business_id)
      .gte("holiday_date", `${year}-01-01`)
      .lte("holiday_date", `${year}-12-31`)
      .order("holiday_date"),
    supabase.from("branches").select("id, name").eq("business_id", active.business_id).order("name"),
  ]);
  const branchOpts = (branches ?? []).map((b) => ({ value: b.id, label: b.name }));
  const branchName = new Map(branchOpts.map((b) => [b.value, b.label]));
  const shown = (holidays ?? []).filter((h) => !sp.branch || !h.branch_id || h.branch_id === sp.branch);
  const weekday = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const chip = (on: boolean) => cn("rounded-full border px-3 py-1", on ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground");
  const q = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ year: String(year), branch: sp.branch, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/app/time-off/holidays?${p}`;
  };

  return (
    <div>
      <PageHeader
        label="run"
        title="Time off"
        description="Public holidays are days off for everyone (or one location). They never count as time off or absences, and working on one is holiday overtime."
        actions={
          canEdit ? (
            <>
              {MALDIVES_HOLIDAY_YEARS.includes(year) && <LoadHolidaysButton year={year} />}
              <HolidayButton branches={branchOpts} defaultDate={year === Number(today.slice(0, 4)) ? today : `${year}-01-01`} />
            </>
          ) : undefined
        }
      />
      <TimeOffTabs current="holidays" canEdit={canEdit} />
      <div className="mb-5 flex flex-wrap gap-2 text-[13px]">
        {[year - 1, year, year + 1].map((y) => (
          <Link key={y} href={q({ year: String(y) })} className={chip(y === year)}>
            {y}
          </Link>
        ))}
        {branchOpts.length > 1 && (
          <>
            <span className="mx-1 w-px bg-border" aria-hidden />
            <Link href={q({ branch: undefined })} className={chip(!sp.branch)}>
              All locations
            </Link>
            {branchOpts.map((b) => (
              <Link key={b.value} href={q({ branch: b.value })} className={chip(sp.branch === b.value)}>
                {b.label}
              </Link>
            ))}
          </>
        )}
      </div>
      {shown.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Holiday</Th>
              <Th className="hidden sm:table-cell">Where</Th>
              {canEdit && (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((h) => (
              <Tr key={h.id}>
                <Td className={cn("whitespace-nowrap tabular", h.holiday_date < today && "text-subtle-foreground")}>
                  {formatDate(h.holiday_date, active.date_format)} <span className="text-[12px] text-subtle-foreground">{weekday(h.holiday_date)}</span>
                </Td>
                <Td>
                  <span className="text-foreground">{h.name}</span>
                  {h.is_optional && <span className="block text-[12px] text-subtle-foreground">Optional: people still work unless they take it off</span>}
                </Td>
                <Td className="hidden text-muted-foreground sm:table-cell">{h.branch_id ? branchName.get(h.branch_id) : "Everywhere"}</Td>
                {canEdit && (
                  <Td className="text-right whitespace-nowrap">
                    <HolidayButton branches={branchOpts} holiday={h} />
                    <DeleteHolidayButton id={h.id} name={h.name} />
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title={`No holidays for ${year} yet`}
          description={canEdit ? (MALDIVES_HOLIDAY_YEARS.includes(year) ? "Load the Maldives holidays, or add your own." : "Add the public holidays for this year.") : "HR hasn't added the holidays for this year yet."}
        />
      )}
      <p className="mt-3 text-[12px] text-subtle-foreground">Islamic holidays follow the moon. Check the dates against the official announcements and edit them here.</p>
    </div>
  );
}
