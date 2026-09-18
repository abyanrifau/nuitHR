import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { RUN_STATUS } from "@/lib/payroll/labels";
import { can } from "@/modules/access";
import { RunActions, RunPeople } from "./run-client";

export const metadata: Metadata = { title: "Pay run" };

export default async function PayRunPage(props: PageProps<"/app/payroll/[run]">) {
  const { run: id } = await props.params;
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
  const supabase = await createClient();
  const { data: run } = await supabase.from("payroll_runs").select("*").eq("id", id).eq("business_id", active.business_id).maybeSingle();
  if (!run) notFound();
  const [{ data: people }, { data: lines }] = await Promise.all([
    supabase.from("payroll_run_employees").select("*").eq("run_id", id).order("employee_name"),
    supabase.from("payroll_run_lines").select("id, employee_id, code, name, kind, amount, quantity, source").eq("run_id", id).order("sort"),
  ]);
  const s = RUN_STATUS[run.status];
  const locked = !["draft", "calculated"].includes(run.status);
  const errors = (people ?? []).filter((p) => p.status === "included" && (p.exceptions as { severity: string }[]).some((x) => x.severity === "error")).length;
  const warnings = (people ?? []).filter((p) => (p.exceptions as { severity: string }[]).some((x) => x.severity === "warning")).length;
  const cur = active.currency;

  return (
    <div>
      <PageHeader
        back={{ href: "/app/payroll", label: "Payroll" }}
        title={run.name}
        description={
          <>
            {formatDate(run.period_start, active.date_format)} to {formatDate(run.period_end, active.date_format)} · paid on {formatDate(run.pay_date, active.date_format)}
          </>
        }
        actions={
          <RunActions
            run={{ id: run.id, status: run.status, errors }}
            can={{ edit: can(ctx, "payroll", "edit"), approve: can(ctx, "payroll", "approve"), del: can(ctx, "payroll", "delete"), exp: can(ctx, "payroll", "export") || can(ctx, "payroll", "view") }}
          />
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusDot tone={s.tone}>{s.label}</StatusDot>
        {run.calculated_at && !locked && <span className="text-[13px] text-subtle-foreground">Calculated {formatDateTime(run.calculated_at, active.date_format, active.timezone)}</span>}
        {run.finalized_at && <span className="text-[13px] text-subtle-foreground">Finalized {formatDateTime(run.finalized_at, active.date_format, active.timezone)}</span>}
        {run.reversal_reason && <span className="text-[13px] text-danger">Reversed: {run.reversal_reason}</span>}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["People paid", String(run.employee_count)],
          ["Total earnings", formatMoney(run.total_gross, cur)],
          ["Net pay to banks", formatMoney(run.total_net, cur)],
          ["Employer pension", formatMoney(run.total_employer_contributions, cur)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border p-4">
            <p className="font-display text-xl tabular sm:text-2xl">{v}</p>
            <p className="text-[13px] text-muted-foreground">{k}</p>
          </div>
        ))}
      </div>

      {!locked && errors > 0 && (
        <Alert tone="danger" className="mb-4" title={`${errors} ${errors === 1 ? "person needs" : "people need"} fixing before you can finalize`}>
          Fix the problem on their profile and select Calculate again, or put them on hold for this run.
        </Alert>
      )}
      {!locked && errors === 0 && warnings > 0 && (
        <Alert tone="warning" className="mb-4" title={`${warnings} ${warnings === 1 ? "thing" : "things"} to check`}>
          These won&apos;t stop the run, but have a look, for example people without a bank account.
        </Alert>
      )}

      <RunPeople
        runId={run.id}
        locked={locked}
        canEdit={can(ctx, "payroll", "edit")}
        currency={cur}
        people={(people ?? []).map((p) => ({
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
          exceptions: p.exceptions as { code: string; message: string; severity: string }[],
          lines: (lines ?? [])
            .filter((l) => l.employee_id === p.employee_id)
            .map((l) => ({ id: l.id, name: l.name, kind: l.kind, amount: Number(l.amount), quantity: l.quantity, manual: l.source === "manual" })),
        }))}
      />
    </div>
  );
}
