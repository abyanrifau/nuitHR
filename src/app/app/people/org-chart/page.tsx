import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { buttonClasses } from "@/components/ui/button";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { fullName, initials } from "@/lib/format";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { StructureEditor } from "./structure-editor";

export const metadata: Metadata = { title: "Org chart" };

interface Person {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  manager_id: string | null;
  department_id: string | null;
  position: { title: string } | null;
}

interface Node extends Person {
  reports: Node[];
}

function buildTree(people: Person[]): Node[] {
  const byId = new Map<string, Node>(people.map((p) => [p.id, { ...p, reports: [] }]));
  const roots: Node[] = [];
  for (const n of byId.values()) {
    const boss = n.manager_id ? byId.get(n.manager_id) : undefined;
    if (boss) boss.reports.push(n);
    else roots.push(n);
  }
  const sort = (list: Node[]) => {
    list.sort((a, b) => b.reports.length - a.reports.length || a.first_name.localeCompare(b.first_name));
    list.forEach((n) => sort(n.reports));
  };
  sort(roots);
  return roots;
}

function countAll(n: Node): number {
  return n.reports.reduce((s, r) => s + 1 + countAll(r), 0);
}

export default async function OrgChartPage(props: PageProps<"/app/people/org-chart">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "org", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see the company structure.
      </Alert>
    );
  }
  const tab = sp.tab === "structure" ? "structure" : "chart";
  const supabase = await createClient();

  return (
    <div>
      <PageHeader
        back={{ href: "/app/people", label: "People" }}
        title="Org chart"
        description="Who reports to whom, drawn from each person's manager. Change someone's manager on their profile's Job tab."
      />
      <nav aria-label="Views" className="mb-8 flex gap-6 border-b border-border">
        {[
          { key: "chart", label: "Chart" },
          { key: "structure", label: "Company structure" },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/app/people/org-chart${t.key === "chart" ? "" : "?tab=structure"}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn("-mb-px border-b py-3 text-sm", tab === t.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "chart" ? <Chart businessId={active.business_id} canSeePeople={can(ctx, "employees", "view")} /> : <Structure businessId={active.business_id} canEdit={can(ctx, "org", "edit") || can(ctx, "org", "create")} />}
    </div>
  );

  async function Chart({ businessId, canSeePeople }: { businessId: string; canSeePeople: boolean }) {
    const [{ data: people }, { data: departments }] = await Promise.all([
      supabase
        .from("employees")
        .select("id, first_name, last_name, preferred_name, manager_id, department_id, position:positions(title)")
        .eq("business_id", businessId)
        .in("status", ["active", "probation", "on_leave", "suspended"])
        .limit(3000),
      supabase.from("departments").select("id, name").eq("business_id", businessId),
    ]);
    const list = (people ?? []) as unknown as Person[];
    if (list.length === 0) {
      return (
        <EmptyState
          title="Nobody to show yet"
          description="Add people and set who they report to. The chart draws itself."
          action={
            <Link href="/app/people/new" className={buttonClasses()}>
              Add person
            </Link>
          }
        />
      );
    }
    const deptName = new Map((departments ?? []).map((d) => [d.id, d.name]));
    const roots = buildTree(list);
    const withTeams = roots.filter((r) => r.reports.length > 0);
    const loose = roots.filter((r) => r.reports.length === 0);

    const Card = ({ n }: { n: Node }) => {
      const inner = (
        <>
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-[11px] text-muted-foreground">{initials(n)}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm text-foreground">{fullName(n)}</span>
            <span className="block truncate text-[12px] text-subtle-foreground">
              {[n.position?.title, n.department_id ? deptName.get(n.department_id) : null].filter(Boolean).join(" · ") || "No job title"}
            </span>
          </span>
          {n.reports.length > 0 && <span className="ml-auto pl-2 text-[12px] text-subtle-foreground tabular">{countAll(n)}</span>}
        </>
      );
      const cls = "flex w-72 max-w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5";
      return canSeePeople ? (
        <Link href={`/app/people/${n.id}`} className={cn(cls, "hover:border-border-strong")}>
          {inner}
        </Link>
      ) : (
        <div className={cls}>{inner}</div>
      );
    };

    const Branch = ({ n, depth }: { n: Node; depth: number }) => (
      <li className={cn(depth > 0 && "relative pl-6 before:absolute before:top-0 before:left-0 before:h-[1.4rem] before:w-5 before:rounded-bl-md before:border-b before:border-l before:border-border-strong")}>
        {n.reports.length > 0 && depth < 8 ? (
          <details open={depth < 2} className="group">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <Card n={n} />
            </summary>
            <ul className="mt-2 ml-4 space-y-2 border-l border-border-strong pl-0">
              {n.reports.map((r) => (
                <Branch key={r.id} n={r} depth={depth + 1} />
              ))}
            </ul>
          </details>
        ) : (
          <Card n={n} />
        )}
      </li>
    );

    return (
      <div className="space-y-10">
        <p className="text-[13px] text-subtle-foreground">Click a person with a team to fold or unfold it. The number is everyone below them.</p>
        <ul className="space-y-6 overflow-x-auto pb-4">
          {withTeams.map((r) => (
            <Branch key={r.id} n={r} depth={0} />
          ))}
        </ul>
        {loose.length > 0 && (
          <section>
            <h2 className="mb-1 text-lg">No manager set</h2>
            <p className="mb-4 text-[13px] text-subtle-foreground">These people don&apos;t report to anyone yet and have no team.</p>
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {loose.map((n) => (
                <li key={n.id}>
                  <Card n={n} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  async function Structure({ businessId, canEdit }: { businessId: string; canEdit: boolean }) {
    const [{ data: branches }, { data: departments }, { data: positions }, { data: people }] = await Promise.all([
      supabase.from("branches").select("*").eq("business_id", businessId).order("name"),
      supabase.from("departments").select("*").eq("business_id", businessId).order("name"),
      supabase.from("positions").select("*").eq("business_id", businessId).order("title"),
      supabase.from("employees").select("id, first_name, last_name, branch_id, department_id, position_id").eq("business_id", businessId).in("status", ["active", "probation", "on_leave", "suspended"]).limit(3000),
    ]);
    const count = (col: "branch_id" | "department_id" | "position_id", id: string) => (people ?? []).filter((p) => p[col] === id).length;
    return (
      <StructureEditor
        canEdit={canEdit}
        branches={(branches ?? []).map((b) => ({ ...b, people: count("branch_id", b.id) }))}
        departments={(departments ?? []).map((d) => ({ ...d, people: count("department_id", d.id) }))}
        positions={(positions ?? []).map((p) => ({ ...p, people: count("position_id", p.id) }))}
        people={(people ?? []).map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}`.trim() }))}
      />
    );
  }
}
