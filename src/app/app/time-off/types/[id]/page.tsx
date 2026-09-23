import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/access";
import { LeaveTypeForm, type LeaveTypeValues } from "../type-form";
import { TypeActiveButton } from "./type-active";

export const metadata: Metadata = { title: "Leave type" };

const BLANK: LeaveTypeValues = {
  id: null,
  name: "",
  code: "",
  color: "#0ea5e9",
  is_paid: true,
  entitlement_mode: "annual",
  entitlement_days: 0,
  year_basis: "calendar",
  notice_value: 0,
  notice_unit: "days",
  allow_after_the_fact: false,
  eligible_after_value: 0,
  eligible_after_unit: "months",
  allow_during_probation: true,
  applies_to: "all",
  gender_eligibility: "any",
  min_days_per_request: null,
  max_days_per_request: null,
  max_consecutive_days: null,
  max_off_per_department: null,
  allow_half_day: true,
  document_rule: "none",
  document_over_days: null,
  document_later_allowed: false,
  document_deadline_days: 3,
  birthday_window: "month",
  birthday_window_days: 30,
  targets: [],
};

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export default async function LeaveTypePage(props: PageProps<"/app/time-off/types/[id]">) {
  const { id } = await props.params;
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "leave", "edit", "all")) {
    return <Alert tone="warning" title="No access">Ask the owner or an admin if you need to change time off rules.</Alert>;
  }
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const b = active.business_id;
  const [type, { data: positions }, { data: departments }, { data: branches }, { data: roles }, { data: people }] = await Promise.all([
    isNew ? null : supabase.from("leave_types").select("*, targets:leave_type_targets(target_type, target_id)").eq("id", id).eq("business_id", b).maybeSingle(),
    supabase.from("positions").select("id, title").eq("business_id", b).order("title"),
    supabase.from("departments").select("id, name").eq("business_id", b).eq("is_active", true).order("name"),
    supabase.from("branches").select("id, name").eq("business_id", b).order("name"),
    supabase.from("roles").select("id, name").eq("business_id", b).order("name"),
    supabase.from("employees").select("id, first_name, last_name").eq("business_id", b).in("status", ["active", "probation", "on_leave", "suspended"]).order("first_name").limit(3000),
  ]);
  const t = type?.data;
  if (!isNew && !t) notFound();
  const initial: LeaveTypeValues = t
    ? {
        ...BLANK,
        ...t,
        entitlement_days: Number(t.entitlement_days),
        min_days_per_request: n(t.min_days_per_request),
        max_days_per_request: n(t.max_days_per_request),
        document_over_days: n(t.document_over_days),
        targets: t.targets ?? [],
      }
    : BLANK;

  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: "/app/time-off/types", label: "Leave types" }}
        title={t ? t.name : "New leave type"}
        description={t ? "Changes apply to new requests. Time off already asked for keeps the rules it was asked under." : "Set the days and rules. You can change them any time."}
        actions={t ? <TypeActiveButton id={t.id} isActive={t.is_active} /> : undefined}
      />
      {sp.saved && <Alert tone="success" className="mb-6">Type added. Staff who can use it see it straight away.</Alert>}
      {t && !t.is_active && (
        <Alert tone="warning" className="mb-6">
          This type is switched off, so nobody can ask for it. Past time off stays.
        </Alert>
      )}
      <LeaveTypeForm
        key={t?.updated_at ?? "new"}
        initial={initial}
        targets={{
          position: (positions ?? []).map((p) => ({ value: p.id, label: p.title })),
          department: (departments ?? []).map((d) => ({ value: d.id, label: d.name })),
          branch: (branches ?? []).map((x) => ({ value: x.id, label: x.name })),
          role: (roles ?? []).map((r) => ({ value: r.id, label: r.name })),
          employee: (people ?? []).map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name ?? ""}`.trim() })),
        }}
      />
    </div>
  );
}
