import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { methodSummary, TEMPLATES } from "@/lib/payroll/pay-items";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { ItemActions } from "./allowances-client";

export const metadata: Metadata = { title: "Allowances & deductions" };

type Item = {
  id: string;
  name: string;
  kind: "earning" | "deduction";
  description: string | null;
  method: string;
  default_amount: number;
  default_percent: number | null;
  prorate_basis: string;
  occurrence_var: string | null;
  occurrence_after: number;
  formula: string | null;
  rules_mode: string;
  rules: unknown[];
  applies_to: string;
  effective_from: string | null;
  effective_to: string | null;
  is_taxable: boolean;
  is_pensionable: boolean;
  is_active: boolean;
  is_system: boolean;
  targets: { count: number }[];
  people: { count: number }[];
};

/** Everything added to or taken off pay besides basic salary, each worked out automatically. Owner and payroll only by default. */
export default async function AllowancesPage(props: PageProps<"/app/payroll/allowances">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "payroll", "view", "all")) {
    return (
      <Alert tone="warning" title="No access">
        Allowances and deductions are only shown to the owner and payroll, or people the owner has given payroll access to.
      </Alert>
    );
  }
  const canEdit = can(ctx, "payroll", "edit", "all");
  const supabase = await createClient();
  const { data } = await supabase
    .from("pay_components")
    .select(
      "id, name, kind, description, method, default_amount, default_percent, prorate_basis, occurrence_var, occurrence_after, formula, rules_mode, rules, applies_to, effective_from, effective_to, is_taxable, is_pensionable, is_active, is_system, targets:pay_component_targets(count), people:employee_pay_components(count)",
    )
    .eq("business_id", active.business_id)
    .order("sort")
    .order("name");
  const all = (data ?? []) as unknown as Item[];
  const archived = all.filter((i) => !i.is_active);
  const shown = sp.archived ? archived : all.filter((i) => i.is_active);
  const money = (n: number) => formatMoney(n, active.currency);
  const used = new Set(all.map((i) => i.name.toLowerCase()));

  const group = (kind: "earning" | "deduction") => {
    const items = shown.filter((i) => i.kind === kind);
    if (!items.length) return null;
    return (
      <section className="mb-8" aria-labelledby={`h-${kind}`}>
        <h2 id={`h-${kind}`} className="section-label mb-3">
          {kind === "earning" ? "allowances" : "deductions"}
        </h2>
        <ul className="divide-y divide-border rounded-xl border border-border">
          {items.map((i) => {
            const targets = i.targets?.[0]?.count ?? 0;
            const people = i.people?.[0]?.count ?? 0;
            const who =
              i.applies_to === "all"
                ? "All staff"
                : [targets ? `${targets} chosen ${targets === 1 ? "group or person" : "groups or people"}` : null, people ? `${people} with their own amount` : null]
                    .filter(Boolean)
                    .join(", ") || "No one yet";
            const rules = i.rules_mode === "builder" ? i.rules.length : i.rules_mode === "formula" ? 1 : 0;
            return (
              <li key={i.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5", !i.is_active && "opacity-70")}>
                <Link href={`/app/payroll/allowances/${i.id}`} className="min-w-0 flex-1 hover:underline-offset-4 [&:hover_.name]:underline">
                  <span className="name block text-foreground">{i.name}</span>
                  <span className="block text-[13px] text-muted-foreground">
                    {methodSummary(i, money)}
                    {rules > 0 && ` · ${i.rules_mode === "formula" ? "rule formula" : `${rules} ${rules === 1 ? "rule" : "rules"}`}`}
                  </span>
                  <span className="block text-[12px] text-subtle-foreground">
                    {[
                      who,
                      i.kind === "earning" ? (i.is_taxable ? "taxable" : "not taxed") : null,
                      i.kind === "earning" && i.is_pensionable ? "counts for pension" : null,
                      i.effective_from ? `from ${formatDate(i.effective_from, active.date_format)}` : null,
                      i.effective_to ? `until ${formatDate(i.effective_to, active.date_format)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </Link>
                {canEdit && !i.is_system && <ItemActions id={i.id} isActive={i.is_active} />}
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  return (
    <div>
      <PageHeader
        label="pay"
        title="Allowances & deductions"
        description="Everything added to or taken off pay besides basic salary, worked out automatically from each person's month. Claims people send in are separate, in Claims."
        actions={
          <>
            <Link href="/app/payroll/allowances/test" className={buttonClasses({ variant: "secondary" })}>
              <FlaskConical className="size-4" aria-hidden /> Test panel
            </Link>
            {canEdit && (
              <Link href="/app/payroll/allowances/new" className={buttonClasses()}>
                <Plus className="size-4" aria-hidden /> New item
              </Link>
            )}
          </>
        }
      />
      <div className="mb-5 flex flex-wrap gap-2 text-[13px]">
        <Link href="/app/payroll/allowances" className={cn("rounded-full border px-3 py-1", !sp.archived ? "border-foreground" : "border-border text-muted-foreground")}>
          In use
        </Link>
        <Link href="/app/payroll/allowances?archived=1" className={cn("rounded-full border px-3 py-1", sp.archived ? "border-foreground" : "border-border text-muted-foreground")}>
          Archived ({archived.length})
        </Link>
      </div>
      {shown.length ? (
        <>
          {group("earning")}
          {group("deduction")}
        </>
      ) : (
        <EmptyState
          title={sp.archived ? "Nothing archived" : "No allowances or deductions yet"}
          description={sp.archived ? "Items you archive show here and can be brought back." : "Start from a template below, or make a new one."}
        />
      )}
      {canEdit && !sp.archived && (
        <section aria-labelledby="templates" className="mt-10">
          <h2 id="templates" className="section-label mb-1">
            start from a template
          </h2>
          <p className="mb-3 text-[13px] text-muted-foreground">Ready-made items with example amounts. You can change everything before saving.</p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATES.map((t) => (
              <li key={t.key}>
                <Link href={`/app/payroll/allowances/new?template=${t.key}`} className="block h-full rounded-xl border border-border p-4 hover:border-border-strong hover:bg-accent-soft">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-foreground">{t.name}</span>
                    <span className="text-[11px] text-subtle-foreground">{t.kind === "earning" ? "allowance" : "deduction"}</span>
                  </span>
                  <span className="mt-1 block text-[13px] text-muted-foreground">{t.description}</span>
                  {used.has(t.name.toLowerCase()) && <span className="mt-2 block text-[12px] text-subtle-foreground">You already have one with this name</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
