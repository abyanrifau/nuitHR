import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, ChevronRight, Clock, FileSignature } from "lucide-react";
import { StatusDot } from "@/components/ui/table";
import { Inbox, type InboxItem } from "@/app/app/requests/inbox";
import { CancelButton } from "@/app/app/requests/stand-in";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { REQUEST_STATUS, requestTypeLabel } from "@/lib/requests/labels";
import { can } from "@/modules/access";

export const metadata: Metadata = { title: "Requests" };

export default async function StaffRequests() {
  const { active, ctx, supabase, user, me } = await getStaffContext();
  const [{ data: inboxRows }, { data: mine }] = await Promise.all([
    supabase.rpc("my_request_inbox", { p_business: active.business_id }),
    supabase
      .from("approval_requests")
      .select("id, request_type, title, summary, amount, status, submitted_at, current_step, steps:approval_request_steps(step_order, status, comment)")
      .eq("business_id", active.business_id)
      .eq("requested_by", user.id)
      .order("submitted_at", { ascending: false })
      .limit(50),
  ]);
  const inbox = ((inboxRows ?? []) as InboxItem[]).map((i) => ({
    ...i,
    when: formatDateTime(i.submitted_at, active.date_format, active.timezone),
    amountText: i.amount != null ? formatMoney(i.amount, active.currency) : null,
    typeLabel: requestTypeLabel(i.request_type),
  }));
  // Things staff can ask for. Claims join this list with Phase 6.
  const askFor = me
    ? [
        ...(active.modules.includes("leave") && can(ctx, "leave", "create", "own")
          ? [{ href: "/staff/time-off", label: "Time off", hint: "Annual leave, sick days and more", icon: CalendarDays }]
          : []),
        ...(active.modules.includes("attendance") && can(ctx, "attendance", "create", "own")
          ? [{ href: "/staff/time#fix", label: "Fix a clock time", hint: "Forgot to clock in or out", icon: Clock }]
          : []),
        ...(can(ctx, "letters", "create", "own") ? [{ href: "/staff/letters", label: "A letter", hint: "Salary or employment certificate, NOC and more", icon: FileSignature }] : []),
      ]
    : [];

  return (
    <div className="space-y-8">
      <h1 className="text-3xl">Requests</h1>

      {inbox.length > 0 && (
        <section aria-labelledby="waiting">
          <h2 id="waiting" className="section-label mb-3">
            waiting for your decision
          </h2>
          <Inbox items={inbox} />
        </section>
      )}

      {askFor.length > 0 && (
        <section aria-labelledby="ask">
          <h2 id="ask" className="section-label mb-3">
            ask for
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {askFor.map((a) => (
              <li key={a.href}>
                <Link href={a.href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-accent-soft">
                  <a.icon className="size-5 text-muted-foreground" aria-hidden />
                  <span className="flex-1">
                    <span className="block text-foreground">{a.label}</span>
                    <span className="block text-[13px] text-subtle-foreground">{a.hint}</span>
                  </span>
                  <ChevronRight className="size-4 text-subtle-foreground" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="mine">
        <h2 id="mine" className="section-label mb-3">
          your requests
        </h2>
        {mine?.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {mine.map((r) => {
              const s = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.pending;
              const steps = (r.steps ?? []) as { status: string; comment: string | null }[];
              const note = steps.find((x) => x.status === "rejected")?.comment;
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">{r.title}</p>
                    <p className="text-[13px] text-subtle-foreground">
                      {requestTypeLabel(r.request_type)} · <span className="tabular">{formatDate(r.submitted_at, active.date_format, active.timezone)}</span>
                    </p>
                    <p className="mt-1.5">
                      <StatusDot tone={s.tone}>
                        {s.label}
                        {r.status === "pending" && steps.length > 1 && ` (step ${r.current_step} of ${steps.length})`}
                      </StatusDot>
                    </p>
                    {note && <p className="mt-1 text-[13px] text-danger">Note: {note}</p>}
                  </div>
                  {r.status === "pending" && <CancelButton id={r.id} />}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">Nothing yet. Things you ask for show here with their progress.</p>
        )}
      </section>
    </div>
  );
}
