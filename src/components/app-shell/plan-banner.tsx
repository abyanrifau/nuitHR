import Link from "next/link";
import { appConfig } from "@/config/app.config";
import type { BusinessAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { leaveSupport } from "@/lib/platform/actions";
import { cn } from "@/lib/utils";

/** Whole days from now until a date (negative once it has passed). */
function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

interface Plan {
  status: "trial" | "active" | "grace" | "suspended" | "cancelled";
  plan_status: string;
  ends_at: string | null;
}

/**
 * The strip at the top of the app about the company's plan:
 *  - Harbor support viewing the workspace (always, with a way out)
 *  - paused (everyone): view and export only
 *  - grace period, or trial / paid period ending within 7 days (owners)
 */
export async function PlanBanner({ active, billingHref = "/app/workspace/billing" }: { active: BusinessAccess; billingHref?: string }) {
  const tone = "border-b px-4 py-2.5 text-[13px] sm:px-6";
  if (active.support) {
    return (
      <div role="status" className={cn(tone, "flex flex-wrap items-center justify-between gap-2 border-foreground bg-foreground text-background")}>
        <span>
          You are viewing {active.business_name} as support. View only, no pay data.
          {active.support_expires_at && ` Access ends ${formatDate(active.support_expires_at, active.date_format, active.timezone)}.`}
        </span>
        <form action={leaveSupport}>
          <button type="submit" className="underline underline-offset-4">
            Leave support view
          </button>
        </form>
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("my_plan", { p_business: active.business_id });
  const plan = data as Plan | null;
  if (!plan) return null;
  const ends = plan.ends_at ? formatDate(plan.ends_at, active.date_format, active.timezone) : null;
  const contact = appConfig.brand.supportEmail;

  if (plan.status === "suspended" || plan.status === "cancelled") {
    return (
      <div role="alert" className={cn(tone, "border-danger/30 bg-danger-soft text-foreground")}>
        {active.business_name}&apos;s {appConfig.brand.name} plan is paused, so it&apos;s read-only: you can view and export your data, but changes can&apos;t be saved.{" "}
        {active.is_owner ? (
          <Link href={billingHref} className="underline underline-offset-4">
            See billing and how to pay
          </Link>
        ) : (
          <>Ask your company owner to contact us.</>
        )}{" "}
        Questions: <a href={`mailto:${contact}`} className="underline underline-offset-4">{contact}</a>
      </div>
    );
  }
  if (!active.is_owner || !plan.ends_at) return null;

  const days = daysUntil(plan.ends_at);
  if (plan.status === "grace") {
    const graceEnd = formatDate(new Date(new Date(plan.ends_at).getTime() + appConfig.billing.graceDays * 86_400_000).toISOString(), active.date_format, active.timezone);
    return (
      <div role="alert" className={cn(tone, "border-warning/30 bg-warning-soft text-foreground")}>
        Your {plan.plan_status === "trial" ? "free trial" : "plan"} ended on {ends}. Pay by {graceEnd} to keep full access; after that the account becomes read-only.{" "}
        <Link href={billingHref} className="underline underline-offset-4">
          How to pay
        </Link>
      </div>
    );
  }
  if (days <= 7) {
    return (
      <div role="status" className={cn(tone, "border-border bg-surface text-foreground")}>
        {plan.status === "trial" ? `Your free trial ends on ${ends}.` : `Your plan is paid until ${ends}.`}{" "}
        <Link href={billingHref} className="underline underline-offset-4">
          {plan.status === "trial" ? "Choose how to pay" : "Renew"}
        </Link>
      </div>
    );
  }
  return null;
}
