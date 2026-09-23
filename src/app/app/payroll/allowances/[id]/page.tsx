import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fullName, localDay } from "@/lib/format";
import { TEMPLATES, type PayRule } from "@/lib/payroll/pay-items";
import { can } from "@/modules/access";
import { PayItemEditor, type ItemValues, type Override } from "./item-editor";

export const metadata: Metadata = { title: "Allowance or deduction" };

const BLANK: ItemValues = {
  name: "",
  description: "",
  kind: "earning",
  is_taxable: true,
  is_pensionable: false,
  effective_from: "",
  effective_to: "",
  method: "fixed",
  default_amount: 0,
  default_percent: null,
  prorate_basis: "working",
  occurrence_var: "late_count",
  occurrence_after: 0,
  formula: "",
  rules_mode: "none",
  rules: [],
  rules_formula: "",
  applies_to: "all",
  targets: [],
  template_key: null,
};

export default async function PayItemPage(props: PageProps<"/app/payroll/allowances/[id]">) {
  const { id } = await props.params;
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "payroll", "view", "all")) {
    return <Alert tone="warning" title="No access">Allowances and deductions are only shown to the owner and payroll.</Alert>;
  }
  const canEdit = can(ctx, "payroll", "edit", "all");
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const b = active.business_id;
  const supabase = await createClient();
  const [item, { data: departments }, { data: positions }, { data: branches }, { data: people }] = await Promise.all([
    isNew
      ? null
      : supabase
          .from("pay_components")
          .select("*, targets:pay_component_targets(target_type, target_id), overrides:employee_pay_components(id, employee_id, amount, percent, start_date, end_date)")
          .eq("id", id)
          .eq("business_id", b)
          .maybeSingle(),
    supabase.from("departments").select("id, name").eq("business_id", b).eq("is_active", true).order("name"),
    supabase.from("positions").select("id, title").eq("business_id", b).order("title"),
    supabase.from("branches").select("id, name").eq("business_id", b).order("name"),
    supabase.from("employees").select("id, first_name, last_name, preferred_name, employee_code").eq("business_id", b).in("status", ["active", "probation", "on_leave", "suspended"]).order("first_name").limit(3000),
  ]);
  const row = item?.data;
  if (!isNew && !row) notFound();
  if (row?.is_system) {
    return <Alert tone="info" title="Built-in item">This item is part of Harbor and can&apos;t be changed here.</Alert>;
  }
  const names = new Map((people ?? []).map((p) => [p.id, fullName(p)]));

  let initial: ItemValues = BLANK;
  let heading = "New allowance or deduction";
  if (row) {
    heading = row.name;
    initial = {
      name: row.name,
      description: row.description ?? "",
      kind: row.kind,
      is_taxable: row.is_taxable,
      is_pensionable: row.is_pensionable,
      effective_from: row.effective_from ?? "",
      effective_to: row.effective_to ?? "",
      method: row.method,
      default_amount: Number(row.default_amount),
      default_percent: row.default_percent === null ? null : Number(row.default_percent),
      prorate_basis: row.prorate_basis,
      occurrence_var: row.occurrence_var ?? "late_count",
      occurrence_after: row.occurrence_after,
      formula: row.formula ?? "",
      rules_mode: row.rules_mode,
      rules: (row.rules ?? []) as PayRule[],
      rules_formula: row.rules_formula ?? "",
      applies_to: row.applies_to,
      targets: row.targets ?? [],
      template_key: row.template_key,
    };
  } else if (sp.template) {
    const t = TEMPLATES.find((x) => x.key === sp.template);
    if (t) {
      heading = `New: ${t.name}`;
      initial = {
        ...BLANK,
        name: t.name,
        description: t.description,
        kind: t.kind,
        is_taxable: t.is_taxable,
        is_pensionable: t.is_pensionable,
        method: t.method,
        default_amount: t.amount,
        default_percent: t.percent ?? null,
        prorate_basis: t.prorate_basis ?? "working",
        occurrence_var: t.occurrence_var ?? "late_count",
        occurrence_after: t.occurrence_after ?? 0,
        formula: t.formula ?? "",
        rules_mode: t.rules?.length ? "builder" : "none",
        rules: t.rules ?? [],
        applies_to: t.key === "island_allowance" ? "selected" : "all",
        template_key: t.key,
      };
    }
  }
  const overrides: Override[] = ((row?.overrides ?? []) as Omit<Override, "name">[])
    .map((o) => ({ ...o, amount: o.amount === null ? null : Number(o.amount), percent: o.percent === null ? null : Number(o.percent), name: names.get(o.employee_id) ?? "Someone who left" }))
    .sort((a, c) => a.name.localeCompare(c.name));

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: "/app/payroll/allowances", label: "Allowances & deductions" }}
        title={heading}
        description={row && !row.is_active ? "Archived: left out of pay runs until you bring it back from the list." : undefined}
      />
      {sp.template && initial.applies_to === "selected" && !row && (
        <Alert tone="info" className="mb-6">
          Choose the locations (or people) it&apos;s for under Who gets it.
        </Alert>
      )}
      <PayItemEditor
        key={row?.updated_at ?? sp.template ?? "new"}
        id={row?.id ?? null}
        initial={initial}
        targets={{
          department: (departments ?? []).map((d) => ({ value: d.id, label: d.name })),
          position: (positions ?? []).map((p) => ({ value: p.id, label: p.title })),
          branch: (branches ?? []).map((x) => ({ value: x.id, label: x.name })),
          employee: (people ?? []).map((p) => ({ value: p.id, label: `${fullName(p)}${p.employee_code ? ` (${p.employee_code})` : ""}` })),
        }}
        overrides={overrides}
        people={(people ?? []).map((p) => ({ value: p.id, label: fullName(p) }))}
        currency={active.currency}
        month={localDay(new Date(), active.timezone).slice(0, 7)}
        dateFormat={active.date_format}
        canEdit={canEdit}
      />
    </div>
  );
}
