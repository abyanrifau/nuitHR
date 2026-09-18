import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { can, enabledModules } from "@/modules/access";
import { ModuleIcon } from "@/modules/icons";
import { GettingStarted, type ChecklistGroup } from "./getting-started";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: PageProps<"/app">) {
  const [params, active, user] = await Promise.all([searchParams, getActiveBusiness(), getSessionUser()]);
  const b = active!;
  const ctx = toAccessContext(b);
  const supabase = await createClient();
  const [{ data: profile }, { data: status }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", user!.id).maybeSingle(),
    supabase.rpc("get_setup_checklist", { p_business: b.business_id }),
  ]);
  const done = (status ?? {}) as Record<string, boolean>;
  const mods = enabledModules(ctx);

  const groups: ChecklistGroup[] = mods
    .filter((m) => m.checklist.length)
    .map((m) => ({
      module: m.name,
      icon: m.icon,
      items: m.checklist.map((c) => ({ ...c, done: !!done[c.key] })),
    }));
  const showChecklist = can(ctx, "settings", "edit");
  const firstName = profile?.full_name?.split(" ")[0];

  return (
    <div className="space-y-6">
      {params.welcome && (
        <Alert tone="success" title="You're all set up">
          Your workspace is ready. Work through the checklist whenever you like.
        </Alert>
      )}
      {params.notice === "password-updated" && <Alert tone="success">Your password has been updated.</Alert>}

      <div>
        <h1 className="text-3xl sm:text-4xl">{firstName ? `Hello, ${firstName}` : "Dashboard"}</h1>
        <p className="text-sm text-muted-foreground">
          {b.business_name} · {b.role_name}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {showChecklist ? (
          <GettingStarted groups={groups} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Welcome</CardTitle>
              <CardDescription>Your staff tools will appear here as your business turns them on.</CardDescription>
            </CardHeader>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Your modules</CardTitle>
            <CardDescription>What your business has switched on.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <ul className="space-y-2 text-sm">
              {mods
                .filter((m) => !m.core)
                .map((m) => (
                  <li key={m.key} className="flex items-center gap-2">
                    <ModuleIcon name={m.icon} className="size-4 text-muted-foreground" />
                    {m.name}
                  </li>
                ))}
              <li className="flex items-center gap-2 text-muted-foreground">
                <ModuleIcon name="shield" className="size-4" />
                Core modules (always included)
              </li>
            </ul>
            {can(ctx, "modules", "view") && (
              <Link
                href="/app/settings/modules"
                className="inline-block pt-2 text-sm text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-foreground"
              >
                Change modules →
              </Link>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
