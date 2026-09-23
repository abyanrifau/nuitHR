import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, localDay } from "@/lib/format";
import { num } from "@/lib/leave/rules";
import { can } from "@/modules/access";
import { TimeOffTabs } from "../sections";
import { DeleteGrantButton, GrantButton } from "./grants-client";

export const metadata: Metadata = { title: "Granted leave" };

export default async function GrantsPage() {
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "leave", "edit", "all")) {
    return <Alert tone="warning" title="No access">Ask the owner or an admin if you need to give people extra time off.</Alert>;
  }
  const today = localDay(new Date(), active.timezone);
  const supabase = await createClient();
  const b = active.business_id;
  const [{ data: grants }, { data: types }, { data: people }] = await Promise.all([
    supabase
      .from("leave_allocations")
      .select("id, days, reason, starts_on, expires_on, created_at, employee:employees(id, first_name, last_name), type:leave_types(name, color)")
      .eq("business_id", b)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("leave_types").select("id, name, entitlement_mode").eq("business_id", b).eq("is_active", true).neq("entitlement_mode", "unlimited").order("sort").order("name"),
    supabase.from("employees").select("id, first_name, last_name").eq("business_id", b).in("status", ["active", "probation", "on_leave", "suspended"]).order("first_name").limit(3000),
  ]);

  return (
    <div>
      <PageHeader
        label="run"
        title="Time off"
        description="Extra days given to one person, for example compassionate leave or days for working a holiday. They're added to what that person can ask for until they expire."
        actions={
          <GrantButton
            today={today}
            people={(people ?? []).map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name ?? ""}`.trim() }))}
            types={(types ?? []).map((t) => ({ value: t.id, label: t.entitlement_mode === "granted" ? `${t.name} (only when given)` : t.name }))}
          />
        }
      />
      <TimeOffTabs current="grants" canEdit />
      {grants?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Type</Th>
              <Th className="text-right">Days</Th>
              <Th className="hidden md:table-cell">Usable</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => {
              const e = g.employee as unknown as { id: string; first_name: string; last_name: string };
              const t = g.type as unknown as { name: string; color: string };
              const expired = g.expires_on && g.expires_on < today;
              return (
                <Tr key={g.id}>
                  <Td>
                    <Link href={`/app/people/${e.id}?tab=leave`} className="text-foreground hover:underline">
                      {`${e.first_name} ${e.last_name ?? ""}`.trim()}
                    </Link>
                    <span className="block text-[12px] text-muted-foreground">{g.reason}</span>
                  </Td>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: t.color }} aria-hidden /> {t.name}
                    </span>
                  </Td>
                  <Td className="text-right tabular">{num(g.days)}</Td>
                  <Td className="hidden tabular md:table-cell">
                    {expired ? (
                      <StatusDot tone="neutral">Expired {formatDate(g.expires_on, active.date_format)}</StatusDot>
                    ) : (
                      <>
                        From {formatDate(g.starts_on, active.date_format)}
                        <span className="block text-[12px] text-subtle-foreground">{g.expires_on ? `until ${formatDate(g.expires_on, active.date_format)}` : "No expiry"}</span>
                      </>
                    )}
                  </Td>
                  <Td className="text-right">
                    <DeleteGrantButton id={g.id} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <EmptyState title="No days given yet" description="Use Give days to add time off for one person, with a reason and an expiry." />
      )}
    </div>
  );
}
