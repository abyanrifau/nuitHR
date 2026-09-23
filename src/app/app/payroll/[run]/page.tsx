import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { TabNav } from "@/components/ui/tab-nav";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { RUN_STATUS } from "@/lib/payroll/labels";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { RunActions, RunPeople } from "./run-client";

export const metadata: Metadata = { title: "Pay run" };

type Exception = { code: string; message: string; severity: string };
type RunPerson = {
  id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string | null;
  position_title: string | null;
  department_name: string | null;
  status: string;
  paid_days: number;
  period_days: number;
  unpaid_leave_days: number;
  absent_days: number;
  gross_pay: number;
  total_deductions: number;
  net_pay: number;
  employer_contributions: number;
  exceptions: Exception[];
  payslip_emailed_at: string | null;
};

const EXCEPTION_LABEL: Record<string, string> = {
  no_salary: "No salary",
  negative: "Pay below zero",
  no_bank: "No bank details",
  no_attendance: "No time records",
  no_clock_out: "Missing clock-outs",
  overtime_waiting: "Overtime waiting",
  pending_requests: "Requests waiting",
  big_change: "Big change from last time",
  daily_no_time: "Paid by the day, no time records",
};

export default async function PayRunPage(props: PageProps<"/app/payroll/[run]">) {
  const { run: id } = await props.params;
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "payroll", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Only people the owner allows can see payroll.
      </Alert>
    );
  }
  const view = sp.view === "exceptions" || sp.view === "variance" ? sp.view : "people";
  const supabase = await createClient();
  const [{ data: run }, { data: peopleRows }, { data: lines }] = await Promise.all([
    supabase.from("payroll_runs").select("*, schedule:pay_schedules(name, frequency)").eq("id", id).eq("business_id", active.business_id).maybeSingle(),
    supabase.from("payroll_run_employees").select("*").eq("run_id", id).order("employee_name"),
    supabase.from("payroll_run_lines").select("id, employee_id, code, name, kind, amount, quantity, source, explanation").eq("run_id", id).order("sort").order("name"),
  ]);
  if (!run) notFound();
  const people = (peopleRows ?? []) as unknown as RunPerson[];
  const s = RUN_STATUS[run.status];
  const locked = !["draft", "calculated"].includes(run.status);
  const included = people.filter((p) => p.status === "included");
  const errors = included.filter((p) => p.exceptions.some((x) => x.severity === "error")).length;
  const warnings = people.filter((p) => p.exceptions.some((x) => x.severity === "warning")).length;
  const cur = active.currency;
  const money = (n: number) => formatMoney(n, cur);
  const schedule = run.schedule as { name: string; frequency: string } | null;

  // The last regular run on the same schedule, for the variance view.
  const { data: prevRun } =
    run.run_type === "regular"
      ? await supabase
          .from("payroll_runs")
          .select("id, name, period_start, period_end, total_gross, total_net, total_deductions, total_employer_contributions, employee_count")
          .eq("business_id", active.business_id)
          .eq("run_type", "regular")
          .in("status", ["finalized", "paid"])
          .lt("period_end", run.period_start)
          .filter("pay_schedule_id", run.pay_schedule_id ? "eq" : "is", run.pay_schedule_id ?? null)
          .order("period_end", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };
  const { data: prevPeople } =
    view === "variance" && prevRun
      ? await supabase.from("payroll_run_employees").select("employee_id, employee_name, gross_pay, total_deductions, net_pay").eq("run_id", prevRun.id)
      : { data: null };

  let body: React.ReactNode;
  if (view === "exceptions") {
    const rows = people.flatMap((p) => p.exceptions.map((x) => ({ p, x })));
    const order = (x: Exception) => (x.severity === "error" ? 0 : 1);
    rows.sort((a, b) => order(a.x) - order(b.x) || a.x.code.localeCompare(b.x.code) || a.p.employee_name.localeCompare(b.p.employee_name));
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.x.code, (counts.get(r.x.code) ?? 0) + 1);
    body = rows.length ? (
      <>
        <ul className="mb-4 flex flex-wrap gap-2 text-[13px]">
          {[...counts].map(([code, n]) => (
            <li key={code} className="rounded-full border border-border px-3 py-1 text-muted-foreground">
              {EXCEPTION_LABEL[code] ?? code}: <span className="text-foreground tabular">{n}</span>
            </li>
          ))}
        </ul>
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>What to check</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, x }, i) => (
              <Tr key={i}>
                <Td>
                  <Link href={`/app/people/${p.employee_id}`} className="text-foreground hover:underline">
                    {p.employee_name}
                  </Link>
                  <span className="block text-[12px] text-subtle-foreground">{p.employee_code}</span>
                </Td>
                <Td>
                  <StatusDot tone={x.severity === "error" ? "danger" : "warning"}>{EXCEPTION_LABEL[x.code] ?? x.code}</StatusDot>
                  <span className="block text-[13px] text-muted-foreground">{x.message}</span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
        <p className="mt-3 text-[12px] text-subtle-foreground">Red stops the run until it&apos;s fixed or the person is put on hold. Yellow is for you to check; it doesn&apos;t stop the run.</p>
      </>
    ) : (
      <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">Nothing to check on this run.</p>
    );
  } else if (view === "variance") {
    if (!prevRun) {
      body = <p className="rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">There&apos;s no earlier finalized run on this pay schedule to compare with.</p>;
    } else {
      const prev = new Map((prevPeople ?? []).map((p) => [p.employee_id, p]));
      const ids = [...new Set([...included.map((p) => p.employee_id), ...(prevPeople ?? []).map((p) => p.employee_id)])];
      const rows = ids
        .map((eid) => {
          const now = included.find((p) => p.employee_id === eid);
          const was = prev.get(eid);
          const a = Number(was?.net_pay ?? 0);
          const b = Number(now?.net_pay ?? 0);
          return {
            eid,
            name: now?.employee_name ?? was?.employee_name ?? "",
            wasGross: Number(was?.gross_pay ?? 0),
            nowGross: Number(now?.gross_pay ?? 0),
            was: a,
            now: b,
            diff: b - a,
            pct: a ? ((b - a) / a) * 100 : null,
            note: !was ? "New on this run" : !now ? "Not on this run" : null,
          };
        })
        .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));
      const tNow = included.reduce((a, p) => a + Number(p.net_pay), 0);
      const tWas = (prevPeople ?? []).reduce((a, p) => a + Number(p.net_pay), 0);
      const totals: [string, number, number][] = [
        ["Total earnings", Number(prevRun.total_gross), Number(run.total_gross)],
        ["Total deductions", Number(prevRun.total_deductions), Number(run.total_deductions)],
        ["Net pay to banks", tWas, tNow],
        ["Employer pension", Number(prevRun.total_employer_contributions), Number(run.total_employer_contributions)],
        ["People paid", Number(prevRun.employee_count), Number(run.employee_count)],
      ];
      body = (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Compared with <Link href={`/app/payroll/${prevRun.id}`} className="text-foreground underline underline-offset-4">{prevRun.name}</Link>. Biggest changes first.
          </p>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {totals.map(([k, a, b]) => {
              const d = b - a;
              const isCount = k === "People paid";
              return (
                <div key={k} className="rounded-xl border border-border p-4">
                  <p className="text-[13px] text-muted-foreground">{k}</p>
                  <p className="font-display text-lg tabular">{isCount ? b : money(b)}</p>
                  <p className={cn("text-[12px] tabular", d > 0 ? "text-success" : d < 0 ? "text-danger" : "text-subtle-foreground")}>
                    {d === 0 ? "No change" : `${d > 0 ? "+" : "−"}${isCount ? Math.abs(d) : money(Math.abs(d))}${a && !isCount ? ` (${d > 0 ? "+" : "−"}${Math.abs((d / a) * 100).toFixed(1)}%)` : ""}`}
                  </p>
                </div>
              );
            })}
          </div>
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th className="hidden text-right md:table-cell">Earnings then</Th>
                <Th className="hidden text-right md:table-cell">Earnings now</Th>
                <Th className="text-right">Net then</Th>
                <Th className="text-right">Net now</Th>
                <Th className="text-right">Change</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.eid}>
                  <Td>
                    {r.name}
                    {r.note && <span className="block text-[12px] text-subtle-foreground">{r.note}</span>}
                  </Td>
                  <Td className="hidden text-right text-muted-foreground tabular md:table-cell">{money(r.wasGross)}</Td>
                  <Td className="hidden text-right tabular md:table-cell">{money(r.nowGross)}</Td>
                  <Td className="text-right text-muted-foreground tabular">{money(r.was)}</Td>
                  <Td className="text-right tabular">{money(r.now)}</Td>
                  <Td className={cn("text-right tabular", r.diff > 0 ? "text-success" : r.diff < 0 ? "text-danger" : "text-subtle-foreground")}>
                    {r.diff === 0 ? "–" : `${r.diff > 0 ? "+" : "−"}${money(Math.abs(r.diff))}`}
                    {r.pct !== null && r.diff !== 0 && <span className="block text-[11px]">{`${r.pct > 0 ? "+" : "−"}${Math.abs(r.pct).toFixed(1)}%`}</span>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </>
      );
    }
  } else {
    body = (
      <>
        {!locked && errors > 0 && (
          <Alert tone="danger" className="mb-4" title={`${errors} ${errors === 1 ? "person needs" : "people need"} fixing before you can approve`}>
            Fix the problem and select Calculate again, or put them on hold for this run. See Things to check.
          </Alert>
        )}
        {!locked && errors === 0 && warnings > 0 && (
          <Alert tone="warning" className="mb-4" title={`${warnings} ${warnings === 1 ? "person has" : "people have"} something to check`}>
            These won&apos;t stop the run, but have a look first under <Link href={`/app/payroll/${run.id}?view=exceptions`} className="underline underline-offset-4">Things to check</Link>.
          </Alert>
        )}
        <RunPeople
          runId={run.id}
          locked={locked}
          canEdit={can(ctx, "payroll", "edit")}
          currency={cur}
          people={people.map((p) => ({
            id: p.id,
            employeeId: p.employee_id,
            name: p.employee_name,
            code: p.employee_code,
            position: p.position_title,
            status: p.status,
            paidDays: Number(p.paid_days),
            periodDays: Number(p.period_days),
            unpaid: Number(p.unpaid_leave_days) + Number(p.absent_days),
            gross: Number(p.gross_pay),
            deductions: Number(p.total_deductions),
            net: Number(p.net_pay),
            employer: Number(p.employer_contributions),
            exceptions: p.exceptions,
            lines: (lines ?? [])
              .filter((l) => l.employee_id === p.employee_id)
              .map((l) => ({ id: l.id, name: l.name, kind: l.kind, amount: Number(l.amount), quantity: l.quantity, manual: l.source === "manual", explanation: l.explanation ?? null })),
          }))}
        />
      </>
    );
  }

  return (
    <div>
      <PageHeader
        back={{ href: "/app/payroll", label: "Payroll" }}
        title={run.name}
        description={
          <>
            {run.run_type === "adhoc" ? "Ad-hoc run · " : schedule ? `${schedule.name} · ` : ""}
            {formatDate(run.period_start, active.date_format)} to {formatDate(run.period_end, active.date_format)} · paid on {formatDate(run.pay_date, active.date_format)}
          </>
        }
        actions={
          <RunActions
            run={{ id: run.id, status: run.status, errors, emailed: Boolean(run.payslips_emailed_at) }}
            can={{
              edit: can(ctx, "payroll", "edit"),
              approve: can(ctx, "payroll", "approve"),
              del: can(ctx, "payroll", "delete"),
              exp: can(ctx, "payroll", "export") || can(ctx, "payroll", "view"),
              owner: active.is_owner,
            }}
          />
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusDot tone={s.tone}>{s.label}</StatusDot>
        {run.calculated_at && !locked && <span className="text-[13px] text-subtle-foreground">Calculated {formatDateTime(run.calculated_at, active.date_format, active.timezone)}</span>}
        {run.approved_at && run.status === "approved" && <span className="text-[13px] text-subtle-foreground">Approved {formatDateTime(run.approved_at, active.date_format, active.timezone)}</span>}
        {run.finalized_at && <span className="text-[13px] text-subtle-foreground">Finalized {formatDateTime(run.finalized_at, active.date_format, active.timezone)}</span>}
        {run.payslips_emailed_at && <span className="text-[13px] text-subtle-foreground">Payslips emailed {formatDateTime(run.payslips_emailed_at, active.date_format, active.timezone)}</span>}
        {run.reversal_reason && <span className="text-[13px] text-danger">Reversed: {run.reversal_reason}</span>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ["People paid", String(run.employee_count)],
          ["Total earnings", money(run.total_gross)],
          ["Total deductions", money(run.total_deductions)],
          ["Net pay to banks", money(run.total_net)],
          ["Cost to company", money(Number(run.total_gross) + Number(run.total_employer_contributions))],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border p-4">
            <p className="font-display text-xl tabular sm:text-2xl">{v}</p>
            <p className="text-[13px] text-muted-foreground">{k}</p>
          </div>
        ))}
      </div>

      <TabNav
        label="Pay run"
        current={view}
        tabs={[
          { key: "people", label: `Review (${people.length})`, href: `/app/payroll/${run.id}` },
          { key: "exceptions", label: `Things to check (${people.reduce((a, p) => a + p.exceptions.length, 0)})`, href: `/app/payroll/${run.id}?view=exceptions` },
          ...(run.run_type === "regular" ? [{ key: "variance", label: "Compared with last time", href: `/app/payroll/${run.id}?view=variance` }] : []),
        ]}
      />
      {body}
    </div>
  );
}
