import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { ToolPicker } from "@/components/tools/tool-picker";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { saveModules } from "@/lib/onboarding/actions";
import { can } from "@/modules/access";
import { employeeCountFromRange } from "@/modules/pricing";
import { MODULES } from "@/modules/registry";
import type { ModuleKey } from "@/modules/types";

export const metadata: Metadata = { title: "Tools" };

export default async function WorkspaceToolsPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "modules", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to change your company&apos;s tools.
      </Alert>
    );
  }
  const supabase = await createClient();
  const [{ data: business }, { count }] = await Promise.all([
    supabase.from("businesses").select("employee_count_range").eq("id", active.business_id).maybeSingle(),
    supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("business_id", active.business_id)
      .in("status", ["active", "probation", "on_leave"]),
  ]);
  const people = (count ?? 0) || employeeCountFromRange(business?.employee_count_range);
  const canEdit = can(ctx, "modules", "edit");
  const businessId = active.business_id;
  const withSettings = MODULES.filter((m) => m.setup && (m.core || active.modules.includes(m.key)));

  async function save(selected: ModuleKey[]) {
    "use server";
    return saveModules(businessId, selected);
  }

  return (
    <div className="space-y-10">
      <div>
        <p className="section-label">workspace</p>
        <h1 className="mt-2 text-3xl sm:text-4xl">Tools</h1>
        <p className="measure mt-2 text-sm text-muted-foreground">
          Switch tools on or off whenever you like. Switching one off hides it from menus and keeps everything in it, so switching back on picks up
          where you left off.
        </p>
      </div>

      {canEdit && withSettings.length > 0 && (
        <section aria-labelledby="tool-settings" className="space-y-3">
          <h2 id="tool-settings" className="text-xl">
            Tool settings
          </h2>
          <ul className="divide-y divide-border border-y border-border">
            {withSettings.map((m) => (
              <li key={m.key}>
                <Link href={`/app/workspace/tools/${m.key}`} className="group flex items-center justify-between gap-4 py-3.5">
                  <span>
                    <span className="font-display block">{m.name}</span>
                    <span className="block text-[13px] text-muted-foreground">{m.setup!.description}</span>
                  </span>
                  <ArrowRight
                    className="size-4 text-subtle-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                    aria-hidden
                  />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!canEdit && <Alert tone="info">You can see which tools are on, but only the owner or an admin can change them.</Alert>}
      <ToolPicker initialSelected={active.modules} people={people} mode="workspace" readOnly={!canEdit} onSave={save} />
    </div>
  );
}
