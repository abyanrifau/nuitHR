import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Pay" };

export default async function StaffPay() {
  const { active, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  // Only published payslips are visible to staff (after the run is finalized).
  const { data } = await supabase
    .from("payroll_run_employees")
    .select("id, gross_pay, total_deductions, net_pay, run:payroll_runs(name, period_start, period_end, pay_date, status)")
    .eq("employee_id", me.id)
    .not("payslip_published_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(24);
  const slips = (data ?? []).map((d) => ({ ...d, run: d.run as unknown as { name: string; period_start: string; period_end: string; pay_date: string; status: string } }));
  const latest = slips.find((s) => s.run.status !== "reversed");

  return (
    <div className="space-y-8">
      <h1 className="text-3xl">Pay</h1>
      {latest ? (
        <section className="rounded-2xl border border-border-strong p-6">
          <p className="text-sm text-muted-foreground">Last paid on {formatDate(latest.run.pay_date, active.date_format)}</p>
          <p className="mt-2 font-display text-4xl tabular">{formatMoney(latest.net_pay, active.currency)}</p>
          <p className="mt-1 text-[13px] text-subtle-foreground tabular">
            {formatMoney(latest.gross_pay, active.currency)} earned · {formatMoney(latest.total_deductions, active.currency)} taken off
          </p>
          <a href={`/staff/pay/payslip/${latest.id}`} target="_blank" rel="noopener" className={buttonClasses({ className: "mt-5 w-full", size: "lg" })}>
            <FileText className="size-4" aria-hidden /> Open payslip
          </a>
        </section>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">No payslips yet. They appear here once payroll is finalized each month.</p>
      )}
      {slips.length > 1 && (
        <section aria-labelledby="past">
          <h2 id="past" className="section-label mb-3">
            all payslips
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {slips.map((s) => (
              <li key={s.id}>
                <a href={`/staff/pay/payslip/${s.id}`} target="_blank" rel="noopener" className="flex items-center gap-3 px-4 py-3.5 hover:bg-accent-soft">
                  <FileText className="size-4 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground">{s.run.name}</span>
                    <span className="block text-[12px] text-subtle-foreground">{s.run.status === "reversed" ? "Cancelled and redone" : `Paid ${formatDate(s.run.pay_date, active.date_format)}`}</span>
                  </span>
                  <span className="tabular">{formatMoney(s.net_pay, active.currency)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
