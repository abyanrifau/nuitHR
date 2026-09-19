import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { appConfig } from "@/config/app.config";
import { getActiveBusiness } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { estimateMonthlyPrice } from "@/modules/pricing";
import type { ModuleKey } from "@/modules/types";

export const metadata: Metadata = { title: "Billing" };

const LABEL = {
  trial: { label: "Free trial", tone: "info" },
  active: { label: "Active", tone: "success" },
  grace: { label: "Payment overdue", tone: "warning" },
  suspended: { label: "Paused (read-only)", tone: "danger" },
  cancelled: { label: "Cancelled (read-only)", tone: "neutral" },
} as const;
const METHOD: Record<string, string> = { bank_transfer: "Bank transfer", mobile_payment: "Mobile payment", cash: "Cash", other: "Other" };

interface Plan {
  status: keyof typeof LABEL;
  plan_status: string;
  trial_ends_at: string | null;
  paid_until: string | null;
  ends_at: string | null;
  custom_monthly_price: number | null;
  discount_percent: number | null;
  price_override_until: string | null;
}

/** For owners: their plan, what it costs, payments made, and how to pay. */
export default async function BillingPage() {
  const active = (await getActiveBusiness())!;
  if (!active.is_owner) {
    return (
      <Alert tone="info" title="For the company owner">
        Only the owner sees billing. Ask them if you have questions about your plan.
      </Alert>
    );
  }
  const supabase = await createClient();
  const [{ data: raw }, { data: payments }, { count: staff }] = await Promise.all([
    supabase.rpc("my_plan", { p_business: active.business_id }),
    supabase.from("platform_payments").select("id, amount, currency, paid_on, method, reference, period_start, period_end").eq("business_id", active.business_id).order("paid_on", { ascending: false }),
    supabase.from("employees").select("id", { count: "exact", head: true }).eq("business_id", active.business_id).in("status", ["active", "probation", "on_leave", "suspended"]),
  ]);
  const plan = raw as Plan;
  const today = new Date().toISOString().slice(0, 10);
  const overrideOn = !plan.price_override_until || plan.price_override_until >= today;
  const standard = estimateMonthlyPrice(active.modules as ModuleKey[], Math.max(1, staff ?? 1)).monthlyTotal;
  const price =
    plan.custom_monthly_price != null && overrideOn
      ? Number(plan.custom_monthly_price)
      : Math.round(standard * (1 - (plan.discount_percent != null && overrideOn ? Number(plan.discount_percent) : 0) / 100) * 100) / 100;
  const bank = appConfig.billing.bankTransfer;
  const hasBank = Boolean(bank.bankName && bank.accountNumber);
  const receiptTo = appConfig.billing.receiptEmail || appConfig.brand.supportEmail;
  const s = LABEL[plan.status];

  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader label="workspace" title="Billing" description={`Your ${appConfig.brand.name} plan and payments. We don't take cards: pay by bank transfer or mobile payment and send us the receipt.`} />

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border p-4">
          <p className="text-[12px] text-muted-foreground">Status</p>
          <p className="mt-1">
            <StatusDot tone={s.tone}>{s.label}</StatusDot>
          </p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-[12px] text-muted-foreground">{plan.plan_status === "trial" ? "Trial ends" : "Paid until"}</p>
          <p className="mt-1 text-lg tabular">{formatDate(plan.ends_at, active.date_format, active.timezone)}</p>
        </div>
        <div className="rounded-xl border border-border p-4">
          <p className="text-[12px] text-muted-foreground">Monthly price</p>
          <p className="mt-1 text-lg tabular">{formatMoney(price, "MVR")}</p>
          <p className="text-[12px] text-subtle-foreground">
            {plan.custom_monthly_price != null && overrideOn
              ? "Your agreed price"
              : plan.discount_percent != null && overrideOn
                ? `Includes ${Number(plan.discount_percent)}% off`
                : `For ${staff ?? 0} staff and your tools`}
          </p>
        </div>
      </section>

      {(plan.status === "grace" || plan.status === "suspended") && (
        <Alert tone={plan.status === "grace" ? "warning" : "danger"}>
          {plan.status === "grace"
            ? `Your plan has ended. Pay within ${appConfig.billing.graceDays} days of the end date to keep full access.`
            : "Your account is read-only until we receive your payment. Your data is safe and you can still export it."}
        </Alert>
      )}

      <section className="space-y-3">
        <h2 className="text-lg">How to pay</h2>
        <div className="rounded-xl border border-border p-4 text-sm">
          {hasBank ? (
            <dl className="space-y-1.5">
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-muted-foreground">Bank</dt>
                <dd>{bank.bankName}</dd>
              </div>
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-muted-foreground">Account name</dt>
                <dd>{bank.accountName}</dd>
              </div>
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-muted-foreground">Account number</dt>
                <dd className="tabular">{bank.accountNumber}</dd>
              </div>
              <div className="grid grid-cols-[9rem_1fr] gap-3">
                <dt className="text-muted-foreground">Reference</dt>
                <dd>{active.business_name}</dd>
              </div>
              {bank.otherWays && <p className="pt-2 text-muted-foreground">{bank.otherWays}</p>}
            </dl>
          ) : (
            <p className="text-muted-foreground">
              Email <a href={`mailto:${receiptTo}`} className="text-foreground underline underline-offset-4">{receiptTo}</a> and we&apos;ll send you our bank details.
            </p>
          )}
          <p className="mt-4 border-t border-border pt-3 text-muted-foreground">
            After paying, send the receipt to{" "}
            <a href={`mailto:${receiptTo}?subject=${encodeURIComponent(`Payment receipt: ${active.business_name}`)}`} className="text-foreground underline underline-offset-4">
              {receiptTo}
            </a>
            . We&apos;ll confirm it and update your paid-until date, usually within one working day.
          </p>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg">Payments</h2>
        {payments?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Paid on</Th>
                <Th className="text-right">Amount</Th>
                <Th>Method</Th>
                <Th>Reference</Th>
                <Th>Covers</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <Tr key={p.id}>
                  <Td className="tabular">{formatDate(p.paid_on, active.date_format)}</Td>
                  <Td className="text-right tabular">{formatMoney(p.amount, p.currency)}</Td>
                  <Td>{METHOD[p.method] ?? p.method}</Td>
                  <Td>{p.reference || "—"}</Td>
                  <Td className="tabular">{p.period_start ? `${formatDate(p.period_start, active.date_format)} to ${formatDate(p.period_end, active.date_format)}` : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">No payments yet.</p>
        )}
      </section>
    </div>
  );
}
