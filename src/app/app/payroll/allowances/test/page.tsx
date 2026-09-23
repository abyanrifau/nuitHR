import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, fullName, localDay } from "@/lib/format";
import { PAY_VARIABLES } from "@/lib/payroll/formula";
import { previewPayItems } from "@/lib/payroll/component-actions";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Test allowances & deductions" };

/** Pick a person and a month: every allowance and deduction, what it comes to, and why. Nothing is saved. */
export default async function PayItemTestPage(props: PageProps<"/app/payroll/allowances/test">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "payroll", "view", "all")) {
    return <Alert tone="warning" title="No access">Allowances and deductions are only shown to the owner and payroll.</Alert>;
  }
  const supabase = await createClient();
  const { data: people } = await supabase
    .from("employees")
    .select("id, first_name, last_name, preferred_name, employee_code")
    .eq("business_id", active.business_id)
    .in("status", ["active", "probation", "on_leave", "suspended"])
    .order("first_name")
    .limit(3000);
  const today = localDay(new Date(), active.timezone);
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const person = sp.person && (people ?? []).some((p) => p.id === sp.person) ? sp.person : undefined;
  const result = person ? await previewPayItems(person, month) : null;
  const money = (n: number) => formatMoney(n, active.currency);
  const applied = (result?.items ?? []).filter((i) => i.applies);
  const notApplied = (result?.items ?? []).filter((i) => !i.applies);
  const total = (kind: string) => applied.filter((i) => i.kind === kind).reduce((s, i) => s + Number(i.amount ?? 0), 0);
  const who = (people ?? []).find((p) => p.id === person);

  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ href: "/app/payroll/allowances", label: "Allowances & deductions" }}
        title="Test panel"
        description="Choose a person and a month to see every allowance and deduction worked out, and why. Nothing is saved or paid."
      />
      <form method="get" className="mb-8 flex flex-wrap items-end gap-3">
        <Field label="Person" htmlFor="person" className="min-w-64 flex-1">
          <Select
            id="person"
            name="person"
            defaultValue={person ?? ""}
            placeholder="Choose a person"
            options={(people ?? []).map((p) => ({ value: p.id, label: `${fullName(p)}${p.employee_code ? ` (${p.employee_code})` : ""}` }))}
          />
        </Field>
        <Field label="Month" htmlFor="month">
          <Input id="month" name="month" type="month" defaultValue={month} />
        </Field>
        <Button type="submit">Work it out</Button>
      </form>

      {!person ? (
        <EmptyState title="Choose someone" description="Their attendance for the month is used, exactly as payroll will use it." />
      ) : result?.error ? (
        <Alert tone="danger">{result.error}</Alert>
      ) : result ? (
        <div className="space-y-8">
          <section aria-labelledby="res">
            <h2 id="res" className="section-label mb-3">
              {fullName(who)}, {formatDate(result.start, active.date_format)} to {formatDate(result.end, active.date_format)}
            </h2>
            {applied.length ? (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {applied.map((i) => (
                  <li key={i.id} className="flex gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/app/payroll/allowances/${i.id}`} className="text-foreground hover:underline">
                        {i.name}
                      </Link>
                      <p className="text-[13px] text-muted-foreground">{i.explanation}</p>
                    </div>
                    <p className={cn("shrink-0 text-right tabular", Number(i.amount) === 0 && "text-subtle-foreground")}>
                      {i.kind === "deduction" && Number(i.amount) > 0 ? "−" : ""}
                      {money(Number(i.amount))}
                    </p>
                  </li>
                ))}
                <li className="flex justify-between gap-4 bg-accent-soft px-4 py-3 text-sm">
                  <span>Allowances {money(total("earning"))} · Deductions {money(total("deduction"))}</span>
                  <span className="tabular">
                    Net {total("earning") - total("deduction") < 0 ? "−" : ""}
                    {money(Math.abs(total("earning") - total("deduction")))}
                  </span>
                </li>
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No allowances or deductions apply to them that month.</p>
            )}
            <p className="mt-2 text-[12px] text-subtle-foreground">
              Basic salary, overtime, approved claims, loans, pension and tax are added in the pay run itself.
            </p>
          </section>

          {notApplied.length > 0 && (
            <section aria-labelledby="skip">
              <h2 id="skip" className="section-label mb-3">
                not included
              </h2>
              <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                {notApplied.map((i) => (
                  <li key={i.id} className="flex justify-between gap-3 px-4 py-2.5">
                    <Link href={`/app/payroll/allowances/${i.id}`} className="text-muted-foreground hover:underline">
                      {i.name}
                    </Link>
                    <span className="text-subtle-foreground">{i.why_not}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {result.vars && (
            <section aria-labelledby="vars">
              <h2 id="vars" className="section-label mb-3">
                their month in numbers
              </h2>
              <dl className="grid gap-x-6 sm:grid-cols-2">
                {PAY_VARIABLES.filter((x) => x.key !== "amount").map((x) => (
                  <div key={x.key} className="flex justify-between gap-3 border-b border-border py-2 text-sm">
                    <dt>
                      <span className="text-foreground">{x.label}</span>
                      <span className="block font-mono text-[11px] text-subtle-foreground">{x.key}</span>
                    </dt>
                    <dd className="tabular">{x.key === "basic_salary" ? money(Number(result.vars![x.key])) : String(result.vars![x.key] ?? 0)}</dd>
                  </div>
                ))}
              </dl>
              {!result.vars._has_salary && <p className="mt-2 text-[13px] text-warning">They have no salary for this month yet, so basic salary is 0.</p>}
            </section>
          )}
        </div>
      ) : null}
    </div>
  );
}
