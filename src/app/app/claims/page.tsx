import type { Metadata } from "next";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { ClaimsTable } from "./claims-client";

export const metadata: Metadata = { title: "Claims" };

const TABS = [
  { key: "pending", label: "Waiting" },
  { key: "to_pay", label: "To be paid" },
  { key: "paid", label: "Paid" },
  { key: "all", label: "All" },
];

export default async function ClaimsPage(props: PageProps<"/app/claims">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "claims", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see claims. To send a claim, use the staff app.
      </Alert>
    );
  }
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "pending";
  const supabase = await createClient();
  let q = supabase
    .from("claims")
    .select("id, claim_date, amount, currency, status, description, route, receipt_path, payout_method, is_late, payroll_run_id, paid_reference, decision_comment, employee:employees(id, first_name, last_name), type:claim_types(name)")
    .eq("business_id", active.business_id)
    .order("claim_date", { ascending: false })
    .limit(200);
  if (tab === "pending") q = q.eq("status", "pending");
  else if (tab === "to_pay") q = q.eq("status", "approved");
  else if (tab === "paid") q = q.eq("status", "paid");
  const [{ data: rows }, { data: waiting }, { count: pendingCount }] = await Promise.all([
    q,
    supabase.rpc("my_request_inbox", { p_business: active.business_id }),
    supabase.from("claims").select("id", { count: "exact", head: true }).eq("business_id", active.business_id).eq("status", "pending"),
  ]);
  const mine = ((waiting ?? []) as { id: string; request_type: string }[]).filter((w) => w.request_type === "claim").map((w) => w.id);
  const { data: reqs } = mine.length ? await supabase.from("approval_requests").select("source_id").in("id", mine) : { data: [] };
  const decidable = new Set((reqs ?? []).map((r) => r.source_id));
  const total = (rows ?? []).reduce((a, r) => a + Number(r.amount), 0);

  return (
    <div>
      <PageHeader
        label="pay"
        title="Claims"
        description="Staff send claims with a receipt photo from the staff app. Approved claims are paid with the next payroll, or separately if you prefer."
        actions={
          can(ctx, "claims", "edit") ? (
            <Link href="/app/workspace/tools/claims" className={buttonClasses({ variant: "secondary" })}>
              <Settings2 className="size-4" aria-hidden /> Claim types
            </Link>
          ) : undefined
        }
      />
      <nav aria-label="Claim lists" className="mb-6 flex flex-wrap gap-6 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/app/claims?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn("-mb-px border-b py-3 text-sm", t.key === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
            {t.key === "pending" && pendingCount ? ` (${pendingCount})` : ""}
          </Link>
        ))}
      </nav>
      {rows?.length ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground tabular">
            {rows.length} {rows.length === 1 ? "claim" : "claims"} · {formatMoney(total, active.currency)}
          </p>
          <ClaimsTable
            tab={tab}
            canPay={can(ctx, "claims", "edit")}
            rows={rows.map((r) => {
              const e = r.employee as unknown as { id: string; first_name: string; last_name: string };
              return {
                id: r.id,
                employeeId: e.id,
                person: `${e.first_name} ${e.last_name}`.trim(),
                type: (r.type as unknown as { name: string } | null)?.name ?? "",
                date: formatDate(r.claim_date, active.date_format),
                amount: formatMoney(r.amount, r.currency),
                status: r.status,
                detail: [r.route, r.description].filter(Boolean).join(" · "),
                receipt: r.receipt_path,
                payout: r.payout_method,
                inRun: Boolean(r.payroll_run_id),
                late: r.is_late,
                note: r.decision_comment ?? r.paid_reference,
                decidable: decidable.has(r.id),
              };
            })}
          />
        </>
      ) : (
        <EmptyState title={tab === "pending" ? "Nothing waiting" : "No claims here"} description="Claims staff send from the staff app show here." />
      )}
    </div>
  );
}
