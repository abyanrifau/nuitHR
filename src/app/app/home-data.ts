import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { BusinessAccess } from "@/lib/auth/session";
import { formatMoney } from "@/lib/geo";

export interface WidgetValue {
  value: string;
  caption: string;
  /** true when there's something to act on (shown brighter). */
  attention?: boolean;
}

/** Today's date (YYYY-MM-DD) in the company's own time zone. */
export function todayIn(timezone: string, offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Works out the numbers for the Home widgets the person can see. Each query respects their access. */
export async function loadWidgetValues(b: BusinessAccess, userId: string, keys: string[]): Promise<Record<string, WidgetValue>> {
  const supabase = await createClient();
  const bid = b.business_id;
  const today = todayIn(b.timezone);
  const in30 = todayIn(b.timezone, 30);
  const in90 = todayIn(b.timezone, 90);
  const monthStart = `${today.slice(0, 7)}-01`;
  const monthEnd = todayIn(b.timezone, 0).slice(0, 7) + "-31";
  const count = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0;
  const out: Record<string, WidgetValue> = {};

  const loaders: Record<string, () => Promise<WidgetValue>> = {
    pending_requests: async () => {
      const n = await count(
        supabase
          .from("approval_request_steps")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .eq("approver_user_id", userId)
          .eq("status", "pending"),
      );
      return { value: String(n), caption: n ? plural(n, "request") + " to decide" : "Nothing waiting", attention: n > 0 };
    },
    probation_ending: async () => {
      const n = await count(
        supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .gte("probation_end_date", today)
          .lte("probation_end_date", in30),
      );
      return { value: String(n), caption: n ? "End in the next 30 days" : "None in the next 30 days", attention: n > 0 };
    },
    expiring_documents: async () => {
      const n = await count(
        supabase
          .from("employee_documents")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .gte("expiry_date", today)
          .lte("expiry_date", in30),
      );
      return { value: String(n), caption: n ? "Expire in the next 30 days" : "Nothing expiring soon", attention: n > 0 };
    },
    expiring_permits: async () => {
      const n = await count(
        supabase
          .from("compliance_items")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .eq("is_archived", false)
          .lte("expires_on", in90),
      );
      return { value: String(n), caption: n ? "Expired or expiring within 90 days" : "Nothing due in 90 days", attention: n > 0 };
    },
    payroll_due: async () => {
      const { data } = await supabase.from("pay_schedules").select("pay_day").eq("business_id", bid).eq("is_default", true).maybeSingle();
      if (!data) return { value: "–", caption: "Set your pay day in Workspace → Tools" };
      const [y, m, d] = today.split("-").map(Number);
      const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
      let py = y,
        pm = m;
      if (d > Math.min(data.pay_day, lastDay(y, m))) {
        pm = m === 12 ? 1 : m + 1;
        py = m === 12 ? y + 1 : y;
      }
      const pd = Math.min(data.pay_day, lastDay(py, pm));
      const days = Math.round((Date.UTC(py, pm - 1, pd) - Date.UTC(y, m - 1, d)) / 86_400_000);
      const label = new Date(Date.UTC(py, pm - 1, pd)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
      return { value: label, caption: days === 0 ? "Pay day is today" : `In ${plural(days, "day")}`, attention: days <= 5 };
    },
    claims_to_pay: async () => {
      const n = await count(
        supabase.from("claims").select("id", { count: "exact", head: true }).eq("business_id", bid).eq("status", "approved").is("paid_at", null),
      );
      return { value: String(n), caption: n ? "Approved, not paid yet" : "All approved claims are paid", attention: n > 0 };
    },
    whos_in: async () => {
      const n = await count(
        supabase
          .from("attendance_records")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .eq("work_date", today)
          .not("clock_in_at", "is", null),
      );
      return { value: String(n), caption: n ? "Clocked in today" : "Nobody has clocked in yet" };
    },
    shifts_today: async () => {
      const n = await count(
        supabase
          .from("roster_entries")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .eq("work_date", today)
          .eq("is_rest_day", false),
      );
      return { value: String(n), caption: n ? "On the roster today" : "No shifts on the roster" };
    },
    off_today: async () => {
      const n = await count(
        supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .eq("status", "approved")
          .lte("start_date", today)
          .gte("end_date", today),
      );
      return { value: String(n), caption: n ? "On time off today" : "Everyone's in" };
    },
    headcount: async () => {
      const n = await count(
        supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .in("status", ["active", "probation", "on_leave"]),
      );
      return { value: String(n), caption: n === 1 ? "Person on staff" : "People on staff" };
    },
    payroll_cost: async () => {
      const { data } = await supabase
        .from("payroll_runs")
        .select("total_gross, total_employer_contributions, period_end")
        .eq("business_id", bid)
        .in("status", ["finalized", "paid"])
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return { value: "–", caption: "No payroll locked yet" };
      return {
        value: formatMoney(Number(data.total_gross) + Number(data.total_employer_contributions), b.currency),
        caption: "Last locked pay run, with employer costs",
      };
    },
    open_roles: async () => {
      const n = await count(supabase.from("vacancies").select("id", { count: "exact", head: true }).eq("business_id", bid).eq("status", "open"));
      return { value: String(n), caption: n ? "Open roles" : "No open roles" };
    },
    joiners_in_progress: async () => {
      const n = await count(
        supabase
          .from("employee_checklists")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .eq("kind", "onboarding")
          .eq("status", "in_progress"),
      );
      return { value: String(n), caption: n ? "Joiner checklists open" : "No joiners in progress" };
    },
    training_due: async () => {
      const n = await count(
        supabase
          .from("course_enrollments")
          .select("id", { count: "exact", head: true })
          .eq("business_id", bid)
          .neq("status", "completed")
          .gte("due_date", monthStart)
          .lte("due_date", monthEnd),
      );
      return { value: String(n), caption: n ? "Courses due this month" : "No courses due this month" };
    },
    review_progress: async () => {
      const { data } = await supabase
        .from("reviews")
        .select("status, review_cycles!inner(status)")
        .eq("business_id", bid)
        .eq("review_cycles.status", "open");
      const total = data?.length ?? 0;
      if (!total) return { value: "–", caption: "No review round open" };
      const done = data!.filter((r) => ["finalized", "shared", "acknowledged"].includes(r.status)).length;
      return { value: `${Math.round((done / total) * 100)}%`, caption: `${done} of ${total} reviews finished` };
    },
  };

  await Promise.all(
    keys
      .filter((k) => loaders[k])
      .map(async (k) => {
        try {
          out[k] = await loaders[k]();
        } catch {
          out[k] = { value: "–", caption: "Couldn't load this right now" };
        }
      }),
  );
  return out;
}
