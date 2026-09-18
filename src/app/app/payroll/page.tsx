import type { Metadata } from "next";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { RUN_STATUS } from "@/lib/payroll/labels";
import { NewRunButton } from "./payroll-client";

export const metadata: Metadata = { title: "Payroll" };

/** The next pay period after the last run, using the company's pay day. */
function suggestPeriod(lastEnd: string | null, today: string, payDay: number) {
  const base = lastEnd ? new Date(new Date(`${lastEnd}T00:00:00Z`).getTime() + 86400000) : new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const start = new Date(Date.UTC(y, m, base.getUTCDate()));
  const end = new Date(Date.UTC(y, m + 1, base.getUTCDate() - 1));
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  const pay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), Math.min(payDay, lastDay)));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end), pay: iso(pay) };
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
  const [{ data: runs }, { data: sched }, { count: salaries }, { count: people }] = await Promise.all([
    supabase.from("payroll_runs").select("id, name, period_start, period_end, pay_date, status, employee_count, total_gross, total_net, total_employer_contributions").eq("business_id", active.business_id).order("period_start", { ascending: false }).limit(36),
    supabase.from("pay_schedules").select("pay_day").eq("business_id", active.business_id).eq("is_default", true).maybeSingle(),
    supabase.from("employee_compensation").select("employee_id", { count: "exact", head: true }).eq("business_id", active.business_id),
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("business_id", active.business_id).in("status", ["active", "probation", "on_leave"]),
  ]);
  const lastEnd = runs?.find((r) => r.status !== "reversed")?.period_end ?? null;
  const suggestion = suggestPeriod(lastEnd, localDay(new Date(), active.timezone), sched?.pay_day ?? 28);

  return (
    <div>
      <PageHeader
        label="pay"
        title="Payroll"
        description="Each month: create a pay run, check it, finalize it. Payslips then appear in everyone's staff app."
        actions={
          <>
            <Link href="/app/workspace/tools/payroll" className={buttonClasses({ variant: "secondary" })}>
              <Settings2 className="size-4" aria-hidden /> Pay settings
            </Link>
            {can(ctx, "payroll", "create") && <NewRunButton suggestion={suggestion} />}
          </>
        }
      />
      {(salaries ?? 0) < (people ?? 0) && (
        <Alert tone="warning" className="mb-6" title="Some people have no salary yet">
          Add their basic salary on the Salary &amp; bank tab of their profile in{" "}
          <Link href="/app/people" className="underline underline-offset-4">
            People
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
              <Th className="hidden text-right lg:table-cell">Total cost</Th>
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
