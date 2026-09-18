import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { AddPaidButton, PaidTable, type PaidRow } from "./paid-client";

export const metadata: Metadata = { title: "Paid training" };

export default async function PaidTrainingPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "sponsorships", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see paid training.
      </Alert>
    );
  }
  const supabase = await createClient();
  const [{ data: rows }, { data: people }] = await Promise.all([
    supabase
      .from("training_sponsorships")
      .select("id, employee_id, provider, course_name, location, start_date, end_date, cost, currency, bond_months, bond_end_date, status, notes, employee:employees(first_name, last_name)")
      .eq("business_id", active.business_id)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("employees").select("id, first_name, last_name, employee_code").eq("business_id", active.business_id).in("status", ["active", "probation", "on_leave"]).order("first_name").limit(3000),
  ]);
  const list: PaidRow[] = (rows ?? []).map((r) => {
    const e = r.employee as unknown as { first_name: string; last_name: string };
    return { ...r, cost: Number(r.cost), person: `${e.first_name} ${e.last_name}`.trim() };
  });
  const peopleOpts = (people ?? []).map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}`.trim() + ` · ${p.employee_code}` }));
  const canEdit = can(ctx, "sponsorships", "edit", "team");

  return (
    <div>
      <PageHeader
        back={{ href: "/app/training", label: "Training" }}
        title="Paid training"
        description="Outside courses the company pays for, and any bond period that comes with them. Staff can ask for one in the staff app; it goes through approvals."
        actions={can(ctx, "sponsorships", "create", "team") ? <AddPaidButton people={peopleOpts} /> : undefined}
      />
      {list.length ? (
        <PaidTable rows={list} people={peopleOpts} canEdit={canEdit} dateFormat={active.date_format} today={localDay(new Date(), active.timezone)} />
      ) : (
        <EmptyState title="No paid training yet" description="Record courses you pay for, so you know the cost and when any bond ends." />
      )}
    </div>
  );
}
