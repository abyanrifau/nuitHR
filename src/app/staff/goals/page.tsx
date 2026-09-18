import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { AddGoalButton, GoalList } from "@/components/reviews/goals";
import { getStaffContext } from "@/lib/staff/context";
import { loadGoals } from "@/lib/reviews/goals";
import { can } from "@/modules/access";

export const metadata: Metadata = { title: "My goals" };

export default async function StaffGoals() {
  const { active, ctx, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  const goals = await loadGoals(supabase, active, { employeeId: me.id });
  const mine = goals.filter((g) => g.level === "individual");
  const shared = goals.filter((g) => g.level !== "individual");
  const levels = [{ value: "individual", label: "Me" }];

  return (
    <div className="space-y-8">
      <PageHeader
        back={{ href: "/staff", label: "Home" }}
        title="My goals"
        description="What you're working towards. Update your progress as you go; your manager sees it too."
        actions={can(ctx, "goals", "create", "own") ? <AddGoalButton levels={levels} departments={[]} people={[]} fixedEmployee={me.id} label="Add" /> : undefined}
      />
      <GoalList goals={mine} levels={levels} departments={[]} people={[]} fixedEmployee={me.id} empty="No goals yet. Add one, or agree them with your manager." />
      {shared.length > 0 && (
        <section aria-labelledby="team-goals" className="space-y-3">
          <h2 id="team-goals" className="section-label">
            company and team goals
          </h2>
          <GoalList goals={shared} levels={levels} departments={[]} people={[]} empty="" />
        </section>
      )}
    </div>
  );
}
