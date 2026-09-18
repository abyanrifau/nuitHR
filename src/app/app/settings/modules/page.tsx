import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { ModulePicker } from "@/components/modules/module-picker";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { saveModules } from "@/lib/onboarding/actions";
import { can } from "@/modules/access";
import { employeeCountFromRange } from "@/modules/pricing";
import type { Industry } from "@/modules/selection";
import type { ModuleKey } from "@/modules/types";

export const metadata: Metadata = { title: "Modules" };

export default async function ModulesSettingsPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "modules", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask your business owner or an admin to change modules.
      </Alert>
    );
  }
  const supabase = await createClient();
  const [{ data: business }, { count }] = await Promise.all([
    supabase.from("businesses").select("industry, employee_count_range").eq("id", active.business_id).maybeSingle(),
    supabase
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("business_id", active.business_id)
      .in("status", ["active", "probation", "on_leave"]),
  ]);
  const employees = Math.max(count ?? 0, 0) || employeeCountFromRange(business?.employee_count_range);
  const canEdit = can(ctx, "modules", "edit");
  const businessId = active.business_id;

  async function save(selected: ModuleKey[]) {
    "use server";
    return saveModules(businessId, selected);
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl sm:text-4xl">Modules</h1>
        <p className="text-sm text-muted-foreground">
          Turn modules on or off at any time. Turning one off hides it from menus but keeps all its data. Switch it back on and everything is
          restored.
        </p>
      </div>
      {!canEdit && <Alert tone="info">You can see the modules, but only the owner or an admin can change them.</Alert>}
      <ModulePicker
        industry={business?.industry as Industry}
        initialSelected={active.modules}
        employeeCount={employees}
        mode="settings"
        onSave={save}
      />
    </div>
  );
}
