import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { membersWithNames } from "@/lib/people/members";
import { REQUEST_TYPES } from "@/lib/requests/labels";
import { can } from "@/modules/access";
import { ChainEditor, type Step } from "./chain-editor";

export const metadata: Metadata = { title: "Who approves what" };

export default async function WorkspaceRequestsPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "approvals", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to change who approves requests.
      </Alert>
    );
  }
  const supabase = await createClient();
  const [{ data: workflows }, { data: roles }, { data: memberRows }] = await Promise.all([
    supabase
      .from("approval_workflows")
      .select("id, request_type, steps:approval_workflow_steps(step_order, approver_type, approver_role_id, approver_user_id, min_amount)")
      .eq("business_id", active.business_id)
      .eq("is_default", true),
    supabase.from("roles").select("id, name").eq("business_id", active.business_id).order("name"),
    supabase.from("business_members").select("user_id").eq("business_id", active.business_id).eq("status", "active"),
  ]);
  const members = await membersWithNames(supabase, memberRows);
  const types = REQUEST_TYPES.filter((t) => t.module === "documents" || active.modules.includes(t.module));
  const chains = Object.fromEntries(
    types.map((t) => {
      const wf = workflows?.find((w) => w.request_type === t.key);
      const steps = ((wf?.steps ?? []) as (Step & { step_order: number })[]).sort((a, b) => a.step_order - b.step_order);
      return [t.key, steps.map(({ approver_type, approver_role_id, approver_user_id, min_amount }) => ({ approver_type, approver_role_id, approver_user_id, min_amount }))];
    }),
  );

  return (
    <div className="max-w-3xl">
      <PageHeader
        label="workspace"
        title="Who approves what"
        description="Choose who decides each kind of request, in order. If you don't set a chain, requests go to the person's manager, then to HR, then to the owner."
      />
      <ChainEditor
        canEdit={can(ctx, "approvals", "edit")}
        currency={active.currency}
        types={types.map((t) => ({ key: t.key, label: t.label, usesAmount: Boolean(t.usesAmount) }))}
        chains={chains}
        roles={(roles ?? []).map((r) => ({ value: r.id, label: r.name }))}
        people={members.map((m) => ({ value: m.user_id, label: m.name }))}
      />
    </div>
  );
}
