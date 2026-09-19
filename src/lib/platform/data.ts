import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { estimateMonthlyPrice } from "@/modules/pricing";
import type { ModuleKey } from "@/modules/types";
import type { PlatformAdmin } from "./guard";

/**
 * Data for the platform admin panel. Everything here reads across all
 * companies with the server's secret key, so it must only ever run on the
 * server, after requirePlatformAdmin(). It never includes people's HR data.
 */

export type PlanState = "trial" | "active" | "grace" | "suspended" | "cancelled";

export const PLAN_LABEL: Record<PlanState, string> = {
  trial: "Trial",
  active: "Active",
  grace: "Grace period",
  suspended: "Suspended",
  cancelled: "Cancelled",
};
export const PLAN_TONE: Record<PlanState, "success" | "warning" | "danger" | "info" | "neutral"> = {
  trial: "info",
  active: "success",
  grace: "warning",
  suspended: "danger",
  cancelled: "neutral",
};

export interface AdminBusiness {
  id: string;
  name: string;
  slug: string;
  industry: string;
  country: string;
  currency: string;
  employee_count_range: string | null;
  created_at: string;
  onboarding_completed_at: string | null;
  plan_status: string;
  status: PlanState;
  trial_ends_at: string | null;
  paid_until: string | null;
  custom_monthly_price: number | null;
  discount_percent: number | null;
  price_override_until: string | null;
  staff_count: number;
  modules: string[];
  owner: { name: string | null; email: string | null; phone: string | null } | null;
  last_active: string | null;
  last_payment: string | null;
  support_until: string | null;
  /** Worked out here: what they pay each month. */
  monthly_price: number;
  /** The date their trial or paid period ends. */
  ends_at: string | null;
}

/** Monthly price: a custom price if one is set (and not ended), otherwise the normal price less any discount. */
export function monthlyPrice(b: Pick<AdminBusiness, "modules" | "staff_count" | "custom_monthly_price" | "discount_percent" | "price_override_until">, today = new Date().toISOString().slice(0, 10)) {
  const overrideActive = !b.price_override_until || b.price_override_until >= today;
  if (b.custom_monthly_price != null && overrideActive) return Number(b.custom_monthly_price);
  const list = estimateMonthlyPrice(b.modules as ModuleKey[], Math.max(1, b.staff_count)).monthlyTotal;
  const discount = b.discount_percent != null && overrideActive ? Number(b.discount_percent) : 0;
  return Math.round(list * (1 - discount / 100) * 100) / 100;
}

export async function listBusinesses(): Promise<AdminBusiness[]> {
  const { data, error } = await createAdminClient().rpc("admin_businesses");
  if (error) throw new Error(`Couldn't load companies: ${error.message}`);
  return ((data ?? []) as Omit<AdminBusiness, "monthly_price" | "ends_at">[]).map((b) => ({
    ...b,
    staff_count: Number(b.staff_count),
    custom_monthly_price: b.custom_monthly_price == null ? null : Number(b.custom_monthly_price),
    discount_percent: b.discount_percent == null ? null : Number(b.discount_percent),
    monthly_price: monthlyPrice({ ...b, staff_count: Number(b.staff_count) }),
    ends_at: b.plan_status === "trial" ? b.trial_ends_at : b.paid_until,
  }));
}

export async function logAdminAction(
  admin: PlatformAdmin,
  entry: { action: string; businessId?: string | null; businessName?: string | null; reason?: string | null; before?: unknown; after?: unknown },
) {
  const { error } = await createAdminClient()
    .from("platform_audit_log")
    .insert({
      admin_user_id: admin.id,
      admin_email: admin.email,
      action: entry.action,
      business_id: entry.businessId ?? null,
      business_name: entry.businessName ?? null,
      reason: entry.reason ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
  if (error) throw new Error(`Couldn't write the admin log: ${error.message}`);
}

/** Human names for admin log actions. */
export const ADMIN_ACTION_LABEL: Record<string, string> = {
  "trial.extend": "Extended trial",
  "subscription.extend": "Extended subscription",
  "status.change": "Changed plan status",
  "tools.change": "Changed tools",
  "price.change": "Changed price",
  "payment.record": "Recorded payment",
  "email.reminder": "Sent reminder email",
  "note.add": "Added note",
  "support.enter": "Opened workspace as support",
  "export.businesses": "Exported companies list",
};
