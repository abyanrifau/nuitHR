import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot } from "@/components/ui/table";
import { CancelButton } from "@/app/app/requests/stand-in";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate, localDay } from "@/lib/format";
import { LeaveRequestForm } from "./leave-form";

export const metadata: Metadata = { title: "Time off" };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const n = (v: number | string) => {
  const x = Number(v);
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
};

export default async function StaffTimeOff() {
  const { active, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  const year = Number(localDay(new Date(), active.timezone).slice(0, 4));
  const [{ data: balances }, { data: requests }, { data: holidays }, { data: pendingReqs }] = await Promise.all([
    supabase.rpc("my_leave_balances", { p_business: active.business_id, p_year: year }),
    supabase
      .from("leave_requests")
      .select("id, start_date, end_date, days, status, decision_comment, type:leave_types(name)")
      .eq("employee_id", me.id)
      .order("start_date", { ascending: false })
      .limit(30),
    supabase.from("public_holidays").select("name, holiday_date").eq("business_id", active.business_id).gte("holiday_date", localDay(new Date(), active.timezone)).order("holiday_date").limit(4),
    supabase.from("approval_requests").select("id, source_id").eq("source_table", "leave_requests").eq("status", "pending"),
  ]);
  const types = (balances ?? []) as {
    leave_type_id: string;
    name: string;
    color: string;
    accrual_method: string;
    balance: number;
    pending: number;
    taken: number;
    allow_half_day: boolean;
    requires_document: boolean;
  }[];
  const reqFor = new Map((pendingReqs ?? []).map((r) => [r.source_id, r.id]));

  return (
    <div className="space-y-8">
      <PageHeader back={{ href: "/staff/requests", label: "Requests" }} title="Time off" />

      {types.length > 0 ? (
        <section aria-labelledby="bal">
          <h2 id="bal" className="section-label mb-3">
            what you have left in {year}
          </h2>
          <ul className="grid grid-cols-2 gap-3">
            {types
              .filter((t) => t.accrual_method !== "none")
              .map((t) => (
                <li key={t.leave_type_id} className="rounded-xl border border-border p-4">
                  <p className="font-display text-3xl tabular">{n(Number(t.balance) - Number(t.pending))}</p>
                  <p className="text-sm text-foreground">{t.name}</p>
                  <p className="text-[12px] text-subtle-foreground">
                    {n(t.taken)} used{Number(t.pending) > 0 && ` · ${n(t.pending)} waiting`}
                  </p>
                </li>
              ))}
          </ul>
        </section>
      ) : (
        <Alert tone="info">Your company hasn&apos;t set up time off types yet.</Alert>
      )}

      {types.length > 0 && (
        <section aria-labelledby="ask">
          <h2 id="ask" className="section-label mb-3">
            ask for time off
          </h2>
          <LeaveRequestForm
            businessId={active.business_id}
            employeeId={me.id}
            today={localDay(new Date(), active.timezone)}
            types={types.map((t) => ({ id: t.leave_type_id, name: t.name, halfDays: t.allow_half_day, needsDocument: t.requires_document }))}
          />
        </section>
      )}

      {requests && requests.length > 0 && (
        <section aria-labelledby="mine">
          <h2 id="mine" className="section-label mb-3">
            your time off
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {requests.map((r) => {
              const s = STATUS[r.status] ?? STATUS.pending;
              const approvalId = reqFor.get(r.id);
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">{(r.type as unknown as { name: string } | null)?.name}</p>
                    <p className="text-[13px] text-subtle-foreground tabular">
                      {formatDate(r.start_date, active.date_format)}
                      {r.end_date !== r.start_date && ` to ${formatDate(r.end_date, active.date_format)}`} · {n(r.days)} {Number(r.days) === 1 ? "day" : "days"}
                    </p>
                    <p className="mt-1.5">
                      <StatusDot tone={s.tone}>{s.label}</StatusDot>
                    </p>
                    {r.decision_comment && r.status !== "approved" && <p className="mt-1 text-[13px] text-danger">Note: {r.decision_comment}</p>}
                  </div>
                  {r.status === "pending" && approvalId && <CancelButton id={approvalId} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {holidays && holidays.length > 0 && (
        <section aria-labelledby="hol">
          <h2 id="hol" className="section-label mb-3">
            coming public holidays
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border text-sm">
            {holidays.map((h) => (
              <li key={h.holiday_date + h.name} className="flex justify-between gap-3 px-4 py-3">
                <span className="text-foreground">{h.name}</span>
                <span className="text-muted-foreground tabular">{formatDate(h.holiday_date, active.date_format)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
