import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Pagination } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { AddPermitButton, PermitsTable, type PermitRow, type PermitType } from "./permits-client";

const PAGE = 50;

export const metadata: Metadata = { title: "Permits & renewals" };

const TABS = [
  { key: "soon", label: "Next 90 days" },
  { key: "overdue", label: "Expired" },
  { key: "all", label: "All" },
  { key: "history", label: "History" },
];

function addDays(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export default async function PermitsPage(props: PageProps<"/app/permits">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "compliance", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see permits and renewals.
      </Alert>
    );
  }
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "soon";
  const page = Math.max(1, Number(sp.page) || 1);
  const today = localDay(new Date(), active.timezone);
  const supabase = await createClient();
  let q = supabase
    .from("compliance_items")
    .select("id, employee_id, type_id, reference_no, issued_on, expires_on, issuing_authority, details, renewal_status, notes, is_archived, employee:employees(first_name, last_name, employee_code), type:compliance_types(name)", { count: "exact" })
    .eq("business_id", active.business_id)
    .eq("is_archived", tab === "history")
    .order("expires_on", { ascending: true, nullsFirst: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (tab === "soon") q = q.gte("expires_on", today).lte("expires_on", addDays(today, 90));
  if (tab === "overdue") q = q.lt("expires_on", today);
  const [{ data: items, count }, { data: types }, { data: people }, { count: expired }] = await Promise.all([
    q,
    supabase.from("compliance_types").select("id, name, field_schema").eq("business_id", active.business_id).eq("is_active", true).order("name"),
    supabase.from("employees").select("id, first_name, last_name, employee_code").eq("business_id", active.business_id).in("status", ["active", "probation", "on_leave", "notice"]).order("first_name").limit(3000),
    supabase.from("compliance_items").select("id", { count: "exact", head: true }).eq("business_id", active.business_id).eq("is_archived", false).lt("expires_on", today),
  ]);
  const permitTypes: PermitType[] = (types ?? []).map((t) => ({ id: t.id, name: t.name, fields: Array.isArray(t.field_schema) ? (t.field_schema as PermitType["fields"]) : [] }));
  const peopleOpts = (people ?? []).map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}`.trim() + ` · ${p.employee_code}` }));
  const rows: PermitRow[] = (items ?? []).map((i) => {
    const e = i.employee as unknown as { first_name: string; last_name: string };
    return {
      id: i.id,
      employee_id: i.employee_id,
      type_id: i.type_id,
      person: `${e.first_name} ${e.last_name}`.trim(),
      type: (i.type as unknown as { name: string }).name,
      reference_no: i.reference_no,
      issued_on: i.issued_on,
      expires_on: i.expires_on,
      issuing_authority: i.issuing_authority,
      details: (i.details ?? {}) as Record<string, string>,
      renewal_status: i.renewal_status,
      notes: i.notes,
      is_archived: i.is_archived,
    };
  });
  const canEdit = can(ctx, "compliance", "edit", "team");

  return (
    <div>
      <PageHeader
        label="hire"
        title="Permits & renewals"
        description="Work permits, passports, visas and anything else that runs out. You and the person get reminders before each expiry."
        actions={can(ctx, "compliance", "create", "team") && permitTypes.length > 0 ? <AddPermitButton types={permitTypes} people={peopleOpts} /> : undefined}
      />
      {tab !== "overdue" && (expired ?? 0) > 0 && (
        <Alert tone="danger" className="mb-6">
          {expired === 1 ? "1 document has" : `${expired} documents have`} already expired.{" "}
          <Link href="/app/permits?tab=overdue" className="underline underline-offset-4">
            See them
          </Link>
        </Alert>
      )}
      <nav className="mb-6 flex flex-wrap gap-2 text-[13px]">
        {TABS.map((t) => (
          <Link key={t.key} href={`/app/permits?tab=${t.key}`} className={cn("rounded-full border px-3 py-1", tab === t.key ? "border-foreground" : "border-border text-muted-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      {rows.length ? (
        <>
          <PermitsTable rows={rows} types={permitTypes} people={peopleOpts} today={today} dateFormat={active.date_format} canEdit={canEdit && tab !== "history"} />
          <Pagination page={page} pageSize={PAGE} total={count ?? rows.length} params={sp} basePath="/app/permits" />
        </>
      ) : (
        <EmptyState
          title={tab === "soon" ? "Nothing runs out in the next 90 days" : tab === "overdue" ? "Nothing has expired" : "Nothing here yet"}
          description={tab === "all" ? "Add each person's work permit, passport or visa with its expiry date." : undefined}
        />
      )}
    </div>
  );
}
