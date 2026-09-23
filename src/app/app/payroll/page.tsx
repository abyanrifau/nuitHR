import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Settings2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { RUN_STATUS } from "@/lib/payroll/labels";
import { NewRunButton, type ScheduleOption } from "./payroll-client";

export const metadata: Metadata = { title: "Payroll" };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => iso(new Date(day(s).getTime() + n * 86400000));

/** The next pay period for a schedule, after its last run (or starting this month). */
function suggestPeriod(frequency: string, lastEnd: string | null, today: string, payDay: number) {
  const start = lastEnd ? addDays(lastEnd, 1) : `${today.slice(0, 7)}-01`;
  const d = day(start);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const monthEnd = iso(new Date(Date.UTC(y, m + 1, 0)));
  let end: string;
  if (frequency === "weekly") end = addDays(start, 6);
  else if (frequency === "biweekly") end = addDays(start, 13);
  else if (frequency === "semi_monthly") end = d.getUTCDate() <= 15 ? `${start.slice(0, 7)}-15` : monthEnd;
  else end = iso(new Date(Date.UTC(y, m + 1, d.getUTCDate() - 1)));
  if (frequency !== "monthly") return { start, end, pay: end };
  const e = day(end);
  const lastDay = new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth() + 1, 0)).getUTCDate();
  return { start, end, pay: iso(new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), Math.min(payDay, lastDay)))) };
}

export default async function PayrollPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "payroll", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Only people the owner allows can see payroll. Your own payslips are in the staff app under Pay.
      </Alert>
    );
  }
  const supabase = await createClient();
  const today = localDay(new Date(), active.timezone);
  const [{ data: runs }, { data: schedules }, { count: salaries }, { count: people }] = await Promise.all([
    supabase
      .from("payroll_runs")
      .select("id, name, period_start, period_end, pay_date, status, run_type, pay_schedule_id, employee_count, total_gross, total_net, total_employer_contributions, schedule:pay_schedules(name)")
      .eq("business_id", active.business_id)
      .order("period_start", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.from("pay_schedules").select("id, name, frequency, pay_day, is_default").eq("business_id", active.business_id).eq("is_active", true).order("is_default", { ascending: false }).order("name"),
    supabase.from("employee_compensation").select("employee_id", { count: "exact", head: true }).eq("business_id", active.business_id),
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("business_id", active.business_id).in("status", ["active", "probation", "on_leave"]),
  ]);
  const options: ScheduleOption[] = (schedules ?? []).map((s) => {
    const last = runs?.find((r) => r.run_type === "regular" && r.status !== "reversed" && r.pay_schedule_id === s.id)?.period_end ?? null;
    return { id: s.id, name: s.name, frequency: s.frequency, suggestion: suggestPeriod(s.frequency, last, today, s.pay_day ?? 28) };
  });
  const adhoc = { start: `${today.slice(0, 7)}-01`, end: iso(new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0))), pay: today };

  return (
    <div>
      <PageHeader
        label="pay"
        title="Payroll"
        description="Each pay period: create a run, check it, approve it, then finalize it. Payslips then appear in everyone's staff app and can be emailed."
        actions={
          <>
            <Link href="/app/payroll/reports" className={buttonClasses({ variant: "secondary" })}>
              <BarChart3 className="size-4" aria-hidden /> Reports
            </Link>
            <Link href="/app/workspace/tools/payroll" className={buttonClasses({ variant: "secondary" })}>
              <Settings2 className="size-4" aria-hidden /> Pay settings
            </Link>
            {can(ctx, "payroll", "create") && <NewRunButton schedules={options} adhocSuggestion={adhoc} />}
          </>
        }
      />
      {(salaries ?? 0) < (people ?? 0) && (
        <Alert tone="warning" className="mb-6" title="Some people have no salary yet">
          Add them in{" "}
          <Link href="/app/payroll/salaries?salary=missing" className="underline underline-offset-4">
            Salaries
          </Link>
          , or they&apos;ll be flagged on the pay run.
        </Alert>
      )}
      <Alert tone="info" className="mb-6">
        Pension and tax rates are starting points. Check them against the current rules from the Pension Office and MIRA in Pay settings before your first real run.
      </Alert>
      {runs?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Pay run</Th>
              <Th className="hidden md:table-cell">Pay day</Th>
              <Th className="hidden text-right sm:table-cell">People</Th>
              <Th className="text-right">Net pay</Th>
              <Th className="hidden text-right lg:table-cell">Cost to company</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const s = RUN_STATUS[r.status];
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/app/payroll/${r.id}`} className="block text-foreground hover:underline">
                      {r.name}
                    </Link>
                    <span className="block text-[12px] text-subtle-foreground tabular">
                      {r.run_type === "adhoc" ? "Ad-hoc · " : (r.schedule as unknown as { name: string } | null)?.name ? `${(r.schedule as unknown as { name: string }).name} · ` : ""}
                      {formatDate(r.period_start, active.date_format)} to {formatDate(r.period_end, active.date_format)}
                    </span>
                  </Td>
                  <Td className="hidden text-muted-foreground tabular md:table-cell">{formatDate(r.pay_date, active.date_format)}</Td>
                  <Td className="hidden text-right tabular sm:table-cell">{r.employee_count}</Td>
                  <Td className="text-right tabular">{formatMoney(r.total_net, active.currency)}</Td>
                  <Td className="hidden text-right text-muted-foreground tabular lg:table-cell">{formatMoney(Number(r.total_gross) + Number(r.total_employer_contributions), active.currency)}</Td>
                  <Td>
                    <StatusDot tone={s.tone}>{s.label}</StatusDot>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <EmptyState title="No pay runs yet" description="Create your first pay run. It works out everyone's pay from their salary, allowances, time records, time off and claims, and you check it before anything is final." />
      )}
    </div>
  );
}
