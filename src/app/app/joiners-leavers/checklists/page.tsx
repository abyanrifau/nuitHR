import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/access";
import { TemplatesEditor } from "./templates-editor";

export const metadata: Metadata = { title: "Checklists" };

export default async function ChecklistTemplatesPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "onboarding", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to change checklists.
      </Alert>
    );
  }
  const supabase = await createClient();
  const [{ data: templates }, { data: departments }] = await Promise.all([
    supabase
      .from("checklist_templates")
      .select("id, name, kind, department_id, is_default, tasks:checklist_template_tasks(title, assignee_type, due_offset_days, sort)")
      .eq("business_id", active.business_id)
      .order("kind")
      .order("name"),
    supabase.from("departments").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name"),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: "/app/joiners-leavers", label: "Joiners & leavers" }}
        title="Checklists"
        description="The steps for someone joining or leaving. You can have one for everyone, or different ones for a department, such as kitchen staff."
      />
      <TemplatesEditor
        canEdit={can(ctx, "onboarding", "edit")}
        departments={(departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
        templates={(templates ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          kind: t.kind as "onboarding" | "offboarding",
          department_id: t.department_id,
          is_default: t.is_default,
          tasks: ((t.tasks ?? []) as { title: string; assignee_type: string; due_offset_days: number; sort: number }[])
            .sort((a, b) => a.sort - b.sort)
            .map(({ title, assignee_type, due_offset_days }) => ({ title, assignee_type: assignee_type as "hr" | "manager" | "employee", due_offset_days })),
        }))}
      />
    </div>
  );
}
