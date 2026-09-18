import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { can, dashboardWidgets, enabledModules } from "@/modules/access";
import { cn } from "@/lib/utils";
import { GettingStarted, type ChecklistGroup } from "./getting-started";
import { loadWidgetValues, type WidgetValue } from "./home-data";

export const metadata: Metadata = { title: "Home" };

const SECTIONS = [
  { key: "attention", label: "Needs your attention" },
  { key: "today", label: "Today" },
  { key: "month", label: "This month" },
] as const;

function Stat({ label, v }: { label: string; v?: WidgetValue }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className={cn("font-display mt-3 text-4xl tabular", v?.attention ? "text-foreground" : "text-foreground/80")}>{v?.value ?? "–"}</p>
      <p className="mt-1 text-[13px] text-subtle-foreground">{v?.caption ?? ""}</p>
    </div>
  );
}

export default async function Home({ searchParams }: PageProps<"/app">) {
  const [params, active, user] = await Promise.all([searchParams, getActiveBusiness(), getSessionUser()]);
  const b = active!;
  const ctx = toAccessContext(b);
  const supabase = await createClient();

  const widgets = dashboardWidgets(ctx).filter((w) => w.key !== "setup_checklist");
  const [{ data: profile }, { data: status }, values] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user!.id).maybeSingle(),
    supabase.rpc("get_setup_checklist", { p_business: b.business_id }),
    loadWidgetValues(
      b,
      user!.id,
      widgets.map((w) => w.key),
    ),
  ]);

  const done = (status ?? {}) as Record<string, boolean>;
  const groups: ChecklistGroup[] = enabledModules(ctx)
    .filter((m) => m.checklist.length)
    .map((m) => ({ module: m.name, icon: m.icon, items: m.checklist.map((c) => ({ ...c, done: !!done[c.key] })) }));
  const showChecklist = can(ctx, "settings", "edit") && groups.some((g) => g.items.some((i) => !i.done));
  const firstName = profile?.full_name?.split(" ")[0];

  return (
    <div className="space-y-10">
      {params.welcome && (
        <Alert tone="success" title="Your company space is ready">
          The checklist below covers anything left to set up. Work through it whenever suits you.
        </Alert>
      )}
      {params.notice === "password-updated" && <Alert tone="success">Your password has been changed.</Alert>}

      <div>
        <p className="section-label">home</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">{firstName ? `Hello, ${firstName}` : "Home"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {b.business_name} · {b.role_name}
        </p>
      </div>

      {SECTIONS.map((s) => {
        const list = widgets.filter((w) => w.section === s.key);
        const withChecklist = s.key === "attention" && showChecklist;
        if (!list.length && !withChecklist) return null;
        return (
          <section key={s.key} aria-labelledby={`home-${s.key}`} className="space-y-4">
            <h2 id={`home-${s.key}`} className="border-b border-border pb-3 text-xl">
              {s.label}
            </h2>
            {list.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {list.map((w) => (
                  <Stat key={w.key} label={w.label} v={values[w.key]} />
                ))}
              </div>
            )}
            {withChecklist && <GettingStarted groups={groups} />}
          </section>
        );
      })}
    </div>
  );
}
