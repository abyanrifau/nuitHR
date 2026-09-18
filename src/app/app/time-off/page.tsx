import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDay } from "@/lib/format";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { AdjustButton, CancelLeaveButton, DecideLeaveButtons, RecordLeaveButton, StartYearButton } from "./time-off-client";

export const metadata: Metadata = { title: "Time off" };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "Waiting", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const n = (v: number | string) => {
  const x = Number(v);
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
};

export default async function TimeOffPage(props: PageProps<"/app/time-off">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "leave", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see time off. To ask for time off, use the staff app.
      </Alert>
    );
  }
  const today = localDay(new Date(), active.timezone);
  const thisYear = Number(today.slice(0, 4));
  const year = Number(sp.year) || thisYear;
  const tab = sp.tab === "balances" ? "balances" : "requests";
  const supabase = await createClient();
  const [{ data: types }, { data: people }] = await Promise.all([
    supabase.from("leave_types").select("id, name, accrual_method").eq("business_id", active.business_id).eq("is_active", true).order("sort").order("name"),
    supabase.from("employees").select("id, first_name, last_name, employee_code").eq("business_id", active.business_id).in("status", ["active", "probation", "on_leave", "suspended"]).order("first_name").limit(3000),
  ]);
  const canApprove = can(ctx, "leave", "approve", "team");
  const canEdit = can(ctx, "leave", "edit");
  const peopleOpts = (people ?? []).map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}`.trim() }));
  const typeOpts = (types ?? []).map((t) => ({ value: t.id, label: t.name }));

  let body: React.ReactNode;
  if (!types?.length) {
    body = (
      <EmptyState
        title="No time off types yet"
        description="Set up the kinds of time off you give, such as annual and sick leave."
        action={
          <Link href="/app/workspace/tools/leave" className={buttonClasses()}>
            Set up time off types
          </Link>
        }
      />
    );
  } else if (tab === "requests") {
    let q = supabase
      .from("leave_requests")
      .select("id, start_date, end_date, days, status, reason, decision_comment, attachment_path, created_at, employee:employees(id, first_name, last_name), type:leave_types(name, color)")
      .eq("business_id", active.business_id)
      .order("start_date", { ascending: sp.status === "pending" })
      .limit(100);
    if (sp.status) q = q.eq("status", sp.status);
    else q = q.gte("end_date", `${year}-01-01`).lte("start_date", `${year}-12-31`);
    const { data: rows } = await q;
    const { data: waiting } = await supabase.rpc("my_request_inbox", { p_business: active.business_id });
    const mine = new Set(((waiting ?? []) as { request_type: string; id: string }[]).filter((w) => w.request_type === "leave").map((w) => w.id));
    const { data: reqs } = mine.size ? await supabase.from("approval_requests").select("id, source_id").in("id", [...mine]) : { data: [] };
    const decidable = new Set((reqs ?? []).map((r) => r.source_id));
    body = (
      <>
        <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
          {[
            ["", `All of ${year}`],
            ["pending", "Waiting"],
            ["approved", "Approved"],
            ["rejected", "Declined"],
          ].map(([k, label]) => (
            <Link
              key={k}
              href={`/app/time-off?year=${year}${k ? `&status=${k}` : ""}`}
              className={cn("rounded-full border px-3 py-1", (sp.status ?? "") === k ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {label}
            </Link>
          ))}
        </div>
        {rows?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>When</Th>
                <Th className="hidden text-right sm:table-cell">Days</Th>
                <Th>Status</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const e = r.employee as unknown as { id: string; first_name: string; last_name: string };
                const t = r.type as unknown as { name: string; color: string };
                const s = STATUS[r.status] ?? STATUS.pending;
                return (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/app/people/${e.id}`} className="block text-foreground hover:underline">
                        {`${e.first_name} ${e.last_name}`.trim()}
                      </Link>
                      <span className="flex items-center gap-1.5 text-[12px] text-subtle-foreground">
                        <span className="size-2 rounded-full" style={{ background: t.color }} aria-hidden /> {t.name}
                        {r.attachment_path && " · document attached"}
                      </span>
                      {r.reason && <span className="block text-[12px] text-muted-foreground">{r.reason}</span>}
                    </Td>
                    <Td className="tabular">
                      {formatDate(r.start_date, active.date_format)}
                      {r.end_date !== r.start_date && <span className="block text-[12px] text-subtle-foreground">to {formatDate(r.end_date, active.date_format)}</span>}
                    </Td>
                    <Td className="hidden text-right tabular sm:table-cell">{n(r.days)}</Td>
                    <Td>
                      <StatusDot tone={s.tone}>{s.label}</StatusDot>
                      {r.decision_comment && <span className="block text-[12px] text-subtle-foreground">{r.decision_comment}</span>}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {r.status === "pending" && decidable.has(r.id) && <DecideLeaveButtons id={r.id} />}
                      {r.status === "approved" && canApprove && r.end_date >= today && <CancelLeaveButton id={r.id} />}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="Nothing here" description="Time off that people ask for in the staff app shows here." />
        )}
      </>
    );
  } else {
    await supabase.rpc("refresh_leave_balances", { p_business: active.business_id, p_year: year });
    const { data: balances } = await supabase
      .from("leave_balances")
      .select("employee_id, leave_type_id, balance, pending, taken, carried_forward, adjusted, accrued")
      .eq("business_id", active.business_id)
      .eq("period_year", year);
    const by = new Map((balances ?? []).map((b) => [`${b.employee_id}|${b.leave_type_id}`, b]));
    const shown = (types ?? []).filter((t) => t.accrual_method !== "none");
    body = (
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr>
              <th className="border-b border-border px-4 py-3 text-left text-[11px] font-normal tracking-[0.12em] text-subtle-foreground uppercase">Person</th>
              {shown.map((t) => (
                <th key={t.id} className="border-b border-border px-3 py-3 text-right text-[11px] font-normal tracking-[0.12em] text-subtle-foreground uppercase">
                  {t.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(people ?? []).map((p) => (
              <tr key={p.id} className="hover:bg-accent-soft">
                <td className="border-b border-border px-4 py-2.5 text-foreground">{`${p.first_name} ${p.last_name}`.trim()}</td>
                {shown.map((t) => {
                  const b = by.get(`${p.id}|${t.id}`);
                  const left = b ? Number(b.balance) - Number(b.pending) : null;
                  return (
                    <td key={t.id} className="border-b border-border px-3 py-2.5 text-right tabular">
                      {b ? (
                        <span title={`Given ${n(b.accrued)} · carried over ${n(b.carried_forward)} · changed ${n(b.adjusted)} · used ${n(b.taken)} · waiting ${n(b.pending)}`}>
                          <span className={cn(left! < 0 ? "text-danger" : "text-foreground")}>{n(left!)}</span>
                          <span className="block text-[11px] text-subtle-foreground">{n(b.taken)} used</span>
                        </span>
                      ) : (
                        <span className="text-subtle-foreground">·</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        label="run"
        title="Time off"
        description="Requests from the staff app, everyone's balances, and time off you enter yourself."
        actions={
          <>
            <Link href="/app/time-off/calendar" className={buttonClasses({ variant: "secondary" })}>
              Calendar
            </Link>
            {canApprove && types?.length ? <RecordLeaveButton people={peopleOpts} types={typeOpts} /> : null}
          </>
        }
      />
      <nav aria-label="Sections" className="mb-6 flex flex-wrap items-center gap-6 border-b border-border">
        {[
          { key: "requests", label: "Requests" },
          { key: "balances", label: "Balances" },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/app/time-off?tab=${t.key}&year=${year}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn("-mb-px border-b py-3 text-sm", t.key === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-2 pb-2 text-[13px]">
          {[year - 1, year, year + 1].map((y) => (
            <Link key={y} href={`/app/time-off?tab=${tab}&year=${y}`} className={cn("rounded-full border px-3 py-1", y === year ? "border-foreground" : "border-border text-muted-foreground")}>
              {y}
            </Link>
          ))}
        </span>
      </nav>
      {tab === "balances" && canEdit && types?.length ? (
        <div className="mb-4 flex flex-wrap gap-2">
          <AdjustButton people={peopleOpts} types={typeOpts} year={year} />
          <StartYearButton year={year} />
        </div>
      ) : null}
      {body}
    </div>
  );
}
