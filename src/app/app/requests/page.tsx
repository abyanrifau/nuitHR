import type { Metadata } from "next";
import Link from "next/link";
import { Settings2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatDateTime, formatMoney, today } from "@/lib/format";
import { membersWithNames } from "@/lib/people/members";
import { REQUEST_STATUS, REQUEST_TYPES, requestTypeLabel } from "@/lib/requests/labels";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { Inbox, type InboxItem } from "./inbox";
import { CancelButton, StandInPanel } from "./stand-in";

export const metadata: Metadata = { title: "Requests" };

export default async function RequestsPage(props: PageProps<"/app/requests">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const user = (await getSessionUser())!;
  const ctx = toAccessContext(active);
  const canSeeAll = can(ctx, "approvals", "view", "team");
  const tabs = [
    { key: "inbox", label: "Waiting for you" },
    { key: "mine", label: "You asked for" },
    ...(canSeeAll ? [{ key: "all", label: canSeeAll && can(ctx, "approvals", "view", "all") ? "All requests" : "Your team" }] : []),
    { key: "stand-in", label: "Stand-in" },
  ];
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "inbox";
  const supabase = await createClient();
  const df = active.date_format;

  let body: React.ReactNode;
  if (tab === "inbox") {
    const { data, error } = await supabase.rpc("my_request_inbox", { p_business: active.business_id });
    const items = ((data ?? []) as InboxItem[]).map((i) => ({
      ...i,
      when: formatDateTime(i.submitted_at, df, active.timezone),
      amountText: i.amount != null ? formatMoney(i.amount, active.currency) : null,
      typeLabel: requestTypeLabel(i.request_type),
    }));
    body = error ? <p className="text-danger">{error.message}</p> : <Inbox items={items} />;
  } else if (tab === "mine" || tab === "all") {
    let q = supabase
      .from("approval_requests")
      .select("id, request_type, title, summary, amount, status, submitted_at, decided_at, current_step, requested_by, employee:employees(first_name, last_name), steps:approval_request_steps(step_order, status, comment)")
      .eq("business_id", active.business_id)
      .order("submitted_at", { ascending: false })
      .limit(100);
    if (tab === "mine") q = q.eq("requested_by", user.id);
    if (sp.status && REQUEST_STATUS[sp.status]) q = q.eq("status", sp.status);
    if (sp.type) q = q.eq("request_type", sp.type);
    const { data } = await q;
    const rows = data ?? [];
    body = (
      <>
        <div className="mb-4 flex flex-wrap gap-2 text-[13px]">
          {[{ key: "", label: "Any status" }, ...Object.entries(REQUEST_STATUS).map(([key, v]) => ({ key, label: v.label }))].map((s) => (
            <Link
              key={s.key}
              href={`/app/requests?tab=${tab}${s.key ? `&status=${s.key}` : ""}${sp.type ? `&type=${sp.type}` : ""}`}
              className={cn("rounded-full border px-3 py-1", (sp.status ?? "") === s.key ? "border-foreground text-foreground" : "border-border text-muted-foreground hover:text-foreground")}
            >
              {s.label}
            </Link>
          ))}
        </div>
        {rows.length === 0 ? (
          <EmptyState
            title={tab === "mine" ? "You haven't asked for anything yet" : "No requests yet"}
            description={tab === "mine" ? "Time off, claims and letters you ask for from the staff app appear here with their progress." : "Requests from your team will appear here."}
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Request</Th>
                {tab === "all" && <Th className="hidden md:table-cell">Person</Th>}
                <Th className="hidden sm:table-cell">Sent</Th>
                <Th>Status</Th>
                {tab === "mine" && (
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = REQUEST_STATUS[r.status] ?? REQUEST_STATUS.pending;
                const steps = (r.steps ?? []) as { step_order: number; status: string; comment: string | null }[];
                const note = steps.find((x) => x.status === "rejected")?.comment;
                const emp = r.employee as unknown as { first_name: string; last_name: string } | null;
                return (
                  <Tr key={r.id}>
                    <Td>
                      <span className="block text-foreground">{r.title}</span>
                      <span className="block text-[13px] text-subtle-foreground">
                        {requestTypeLabel(r.request_type)}
                        {r.amount != null && ` · ${formatMoney(r.amount, active.currency)}`}
                        {r.summary && ` · ${r.summary}`}
                      </span>
                      {note && <span className="mt-1 block text-[13px] text-danger">Note: {note}</span>}
                    </Td>
                    {tab === "all" && <Td className="hidden text-muted-foreground md:table-cell">{emp ? `${emp.first_name} ${emp.last_name}`.trim() : ""}</Td>}
                    <Td className="hidden text-muted-foreground tabular sm:table-cell">{formatDate(r.submitted_at, df, active.timezone)}</Td>
                    <Td>
                      <StatusDot tone={s.tone}>
                        {s.label}
                        {r.status === "pending" && steps.length > 1 && ` (step ${r.current_step} of ${steps.length})`}
                      </StatusDot>
                    </Td>
                    {tab === "mine" && <Td className="text-right">{r.status === "pending" && <CancelButton id={r.id} />}</Td>}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </>
    );
  } else {
    const [{ data: delegations }, { data: memberRows }] = await Promise.all([
      supabase
        .from("approval_delegations")
        .select("id, delegator_user_id, delegate_user_id, starts_at, ends_at, reason, revoked_at")
        .eq("business_id", active.business_id)
        .is("revoked_at", null)
        .gt("ends_at", new Date().toISOString())
        .or(`delegator_user_id.eq.${user.id},delegate_user_id.eq.${user.id}`)
        .order("starts_at"),
      supabase.from("business_members").select("user_id").eq("business_id", active.business_id).eq("status", "active"),
    ]);
    const members = await membersWithNames(supabase, memberRows);
    const nameOf = new Map(members.map((m) => [m.user_id, m.name]));
    body = (
      <StandInPanel
        today={today(active.timezone)}
        people={members.filter((m) => m.user_id !== user.id).map((m) => ({ value: m.user_id, label: nameOf.get(m.user_id)! }))}
        mine={(delegations ?? [])
          .filter((d) => d.delegator_user_id === user.id)
          .map((d) => ({ id: d.id, who: nameOf.get(d.delegate_user_id) ?? "Someone", from: formatDate(d.starts_at, df, active.timezone), to: formatDate(d.ends_at, df, active.timezone), reason: d.reason }))}
        forOthers={(delegations ?? [])
          .filter((d) => d.delegate_user_id === user.id)
          .map((d) => ({ id: d.id, who: nameOf.get(d.delegator_user_id) ?? "Someone", from: formatDate(d.starts_at, df, active.timezone), to: formatDate(d.ends_at, df, active.timezone), reason: d.reason }))}
      />
    );
  }

  return (
    <div>
      <PageHeader
        label="foundation"
        title="Requests"
        description="Time off, claims, letters and fixes that need a decision. Everything waiting for you is in one list."
        actions={
          can(ctx, "approvals", "edit") ? (
            <Link href="/app/workspace/requests" className={buttonClasses({ variant: "secondary" })}>
              <Settings2 className="size-4" aria-hidden /> Who approves what
            </Link>
          ) : undefined
        }
      />
      <nav aria-label="Request lists" className="-mx-4 mb-8 overflow-x-auto border-b border-border px-4 [scrollbar-width:none]">
        <ul className="flex gap-6">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link
                href={t.key === "inbox" ? "/app/requests" : `/app/requests?tab=${t.key}`}
                aria-current={t.key === tab ? "page" : undefined}
                className={cn("-mb-px block border-b py-3 text-sm whitespace-nowrap", t.key === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {body}
      {tab === "all" && (
        <p className="mt-4 text-[13px] text-subtle-foreground">
          Showing the latest 100. Filter by kind:{" "}
          {REQUEST_TYPES.filter((t) => t.module === "documents" || active.modules.includes(t.module)).map((t, i) => (
            <span key={t.key}>
              {i > 0 && ", "}
              <Link href={`/app/requests?tab=all&type=${t.key}`} className="underline underline-offset-4">
                {t.label.toLowerCase()}
              </Link>
            </span>
          ))}
          .
        </p>
      )}
    </div>
  );
}
