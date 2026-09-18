import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { AddGoalButton, GoalList } from "@/components/reviews/goals";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadGoals } from "@/lib/reviews/goals";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Goals" };

const TABS = [
  { key: "all", label: "All" },
  { key: "company", label: "Company" },
  { key: "department", label: "Departments" },
  { key: "individual", label: "People" },
];

export default async function GoalsPage(props: PageProps<"/app/reviews/goals">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "goals", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see goals. Your own goals are in the staff app.
      </Alert>
    );
  }
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "all";
  const supabase = await createClient();
  const [goals, { data: departments }, { data: people }] = await Promise.all([
    loadGoals(supabase, active, { level: tab === "all" ? undefined : tab }),
    supabase.from("departments").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name"),
    supabase.from("employees").select("id, first_name, last_name, employee_code").eq("business_id", active.business_id).in("status", ["active", "probation", "on_leave"]).order("first_name").limit(3000),
  ]);
  const companyWide = can(ctx, "goals", "create", "all");
  const levels = [
    ...(companyWide
      ? [
          { value: "company", label: "The whole company" },
          { value: "department", label: "A department" },
        ]
      : []),
    { value: "individual", label: "One person" },
  ];
  const deptOpts = (departments ?? []).map((d) => ({ value: d.id, label: d.name }));
  const peopleOpts = (people ?? []).map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}`.trim() + ` · ${p.employee_code}` }));

  return (
    <div className="max-w-4xl">
      <PageHeader
        label="grow"
        title="Goals"
        description="A few clear goals for the company, each department and each person. Everyone can see company goals; people update their own progress."
        actions={can(ctx, "goals", "create", "team") ? <AddGoalButton levels={levels} departments={deptOpts} people={peopleOpts} /> : undefined}
      />
      <nav className="mb-6 flex flex-wrap gap-2 text-[13px]">
        {TABS.map((t) => (
          <Link key={t.key} href={`/app/reviews/goals?tab=${t.key}`} className={cn("rounded-full border px-3 py-1", tab === t.key ? "border-foreground" : "border-border text-muted-foreground")}>
            {t.label}
          </Link>
        ))}
      </nav>
      <GoalList goals={goals} levels={levels} departments={deptOpts} people={peopleOpts} empty="No goals here yet. Three per person is plenty." />
    </div>
  );
}
