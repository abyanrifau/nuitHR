import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { documentText, noticeText, num } from "@/lib/leave/rules";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { TimeOffTabs } from "../sections";

export const metadata: Metadata = { title: "Leave types" };

const MODE: Record<string, string> = {
  unlimited: "No limit",
  granted: "Only days HR gives",
};

export default async function LeaveTypesPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "leave", "edit", "all")) {
    return <Alert tone="warning" title="No access">Ask the owner or an admin if you need to change time off rules.</Alert>;
  }
  const supabase = await createClient();
  const { data: types } = await supabase
    .from("leave_types")
    .select(
      "id, name, code, color, is_paid, is_active, entitlement_mode, entitlement_days, year_basis, notice_value, notice_unit, allow_after_the_fact, eligible_after_value, eligible_after_unit, allow_during_probation, applies_to, gender_eligibility, document_rule, document_over_days, document_later_allowed, document_deadline_days, birthday_window, birthday_window_days, targets:leave_type_targets(id)",
    )
    .eq("business_id", active.business_id)
    .order("is_active", { ascending: false })
    .order("sort")
    .order("name");

  return (
    <div>
      <PageHeader
        label="run"
        title="Time off"
        description="Each kind of time off and its rules. Changes apply to new requests; time off already asked for stays as it is."
        actions={
          <Link href="/app/time-off/types/new" className={buttonClasses()}>
            <Plus className="size-4" aria-hidden /> Add a type
          </Link>
        }
      />
      <TimeOffTabs current="types" canEdit />
      {types?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {types.map((t) => {
            const who = [
              t.applies_to === "selected" ? `Only ${t.targets.length} chosen ${t.targets.length === 1 ? "group or person" : "groups or people"}` : "All staff",
              t.gender_eligibility !== "any" ? (t.gender_eligibility === "female" ? "women" : "men") : null,
              t.eligible_after_value > 0 ? `after ${t.eligible_after_value} ${t.eligible_after_value === 1 ? t.eligible_after_unit.slice(0, -1) : t.eligible_after_unit} of service` : null,
              !t.allow_during_probation ? "not during probation" : null,
            ]
              .filter(Boolean)
              .join(", ");
            const days =
              MODE[t.entitlement_mode] ??
              (t.entitlement_mode === "birthday"
                ? `${num(t.entitlement_days)} ${Number(t.entitlement_days) === 1 ? "day" : "days"} ${t.birthday_window === "month" ? "in the birthday month" : `within ${t.birthday_window_days} days of the birthday`}`
                : `${num(t.entitlement_days)} days a ${t.year_basis === "anniversary" ? "year from each join date" : "calendar year"}`);
            const doc = documentText({
              document_rule: t.document_rule,
              document_over_days: t.document_over_days,
              document_later: t.document_later_allowed,
              document_deadline_days: t.document_deadline_days,
            });
            return (
              <li key={t.id}>
                <Link href={`/app/time-off/types/${t.id}`} className={cn("flex gap-3 px-4 py-4 hover:bg-accent-soft", !t.is_active && "opacity-60")}>
                  <span className="mt-1.5 size-3 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-foreground">{t.name}</span>
                      <span className="text-[12px] text-subtle-foreground">
                        {t.code}
                        {!t.is_paid && " · unpaid"}
                        {!t.is_active && " · switched off"}
                      </span>
                    </span>
                    <span className="block text-[13px] text-muted-foreground">{days}</span>
                    <span className="block text-[13px] text-subtle-foreground">
                      {who}. {noticeText({ notice_value: t.notice_value, notice_unit: t.notice_unit, after_the_fact: t.allow_after_the_fact })}
                      {doc && ` ${doc.split(".")[0]}.`}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          title="No leave types yet"
          description="Add the kinds of time off you give, such as annual and sick leave."
          action={
            <Link href="/app/time-off/types/new" className={buttonClasses()}>
              Add a type
            </Link>
          }
        />
      )}
    </div>
  );
}
