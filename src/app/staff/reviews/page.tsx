import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot } from "@/components/ui/table";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "My reviews" };

/** What the person sees about their own review at each step. */
const MINE: Record<string, { label: string; tone: "success" | "warning" | "info" | "neutral" }> = {
  self_review: { label: "Your part to do", tone: "warning" },
  manager_review: { label: "With your manager", tone: "info" },
  meeting: { label: "With your manager", tone: "info" },
  finalized: { label: "With your manager", tone: "info" },
  shared: { label: "Ready to read", tone: "warning" },
  acknowledged: { label: "Done", tone: "success" },
};

export default async function StaffReviews() {
  const { active, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  const { data: reviews } = await supabase
    .from("reviews")
    .select("id, status, cycle:review_cycles(name, status, period_start, period_end, self_review_due)")
    .eq("employee_id", me.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader back={{ href: "/staff", label: "Home" }} title="My reviews" description="Rate how the period went, then read your manager's view once they share it." />
      {reviews?.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {reviews.map((r) => {
            const c = r.cycle as unknown as { name: string; status: string; period_start: string; period_end: string; self_review_due: string | null };
            const s = MINE[r.status] ?? MINE.self_review;
            return (
              <li key={r.id}>
                <Link href={`/staff/reviews/${r.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-accent-soft">
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground">{c.name}</span>
                    <span className="block text-[12px] text-subtle-foreground">
                      {formatDate(c.period_start, active.date_format)} to {formatDate(c.period_end, active.date_format)}
                      {r.status === "self_review" && c.self_review_due && ` · due ${formatDate(c.self_review_due, active.date_format)}`}
                    </span>
                    <span className="mt-1.5 block">
                      <StatusDot tone={c.status === "closed" && r.status === "self_review" ? "neutral" : s.tone}>
                        {c.status === "closed" && r.status === "self_review" ? "Round closed" : s.label}
                      </StatusDot>
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-subtle-foreground" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">No reviews yet. You&apos;ll get a notification when a review round starts.</p>
      )}
    </div>
  );
}
