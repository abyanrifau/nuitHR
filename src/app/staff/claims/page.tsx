import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot } from "@/components/ui/table";
import { CancelButton } from "@/app/app/requests/stand-in";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate, formatMoney, localDay } from "@/lib/format";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = { title: "Claims" };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  pending: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved, to be paid", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default async function StaffClaims() {
  const { active, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  const [{ data: types }, { data: claims }, { data: pending }] = await Promise.all([
    supabase.from("claim_types").select("id, name, key, max_amount, requires_receipt, cutoff_day").eq("business_id", active.business_id).eq("is_active", true).order("sort").order("name"),
    supabase
      .from("claims")
      .select("id, claim_date, amount, status, description, route, is_late, payout_method, decision_comment, paid_reference, type:claim_types(name)")
      .eq("employee_id", me.id)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("approval_requests").select("id, source_id").eq("source_table", "claims").eq("status", "pending"),
  ]);
  const reqFor = new Map((pending ?? []).map((r) => [r.source_id, r.id]));
  const today = localDay(new Date(), active.timezone);

  return (
    <div className="space-y-8">
      <PageHeader back={{ href: "/staff/requests", label: "Requests" }} title="Claims" description="Get paid back for work costs like taxis, meals and travel." />
      {types?.length ? (
        <ClaimForm
          businessId={active.business_id}
          employeeId={me.id}
          currency={active.currency}
          today={today}
          types={types.map((t) => ({ id: t.id, name: t.name, isTransport: t.key === "transport", max: t.max_amount ? Number(t.max_amount) : null, receipt: t.requires_receipt, cutoff: t.cutoff_day }))}
        />
      ) : (
        <Alert tone="info">Your company hasn&apos;t set up claim types yet.</Alert>
      )}
      {claims && claims.length > 0 && (
        <section aria-labelledby="mine">
          <h2 id="mine" className="section-label mb-3">
            your claims
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {claims.map((c) => {
              const s = STATUS[c.status] ?? STATUS.pending;
              const approvalId = reqFor.get(c.id);
              return (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">
                      {(c.type as unknown as { name: string } | null)?.name} · <span className="tabular">{formatMoney(c.amount, active.currency)}</span>
                    </p>
                    <p className="text-[13px] text-subtle-foreground">
                      {formatDate(c.claim_date, active.date_format)}
                      {c.route && ` · ${c.route}`}
                      {c.description && ` · ${c.description}`}
                    </p>
                    <p className="mt-1.5">
                      <StatusDot tone={s.tone}>
                        {s.label}
                        {c.status === "approved" && (c.payout_method === "payroll" ? " with your pay" : " separately")}
                      </StatusDot>
                    </p>
                    {c.is_late && c.status !== "paid" && <p className="mt-1 text-[12px] text-subtle-foreground">Sent after the cut-off, so it&apos;s paid with next month&apos;s pay.</p>}
                    {c.decision_comment && c.status === "rejected" && <p className="mt-1 text-[13px] text-danger">Note: {c.decision_comment}</p>}
                  </div>
                  {c.status === "pending" && approvalId && <CancelButton id={approvalId} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
