import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/access";
import { MODULES } from "@/modules/registry";
import { membersWithNames } from "@/lib/people/members";
import { cn } from "@/lib/utils";
import { MembersPanel, RolesPanel } from "./access-panels";

export const metadata: Metadata = { title: "People & access" };

export default async function WorkspacePeoplePage(props: PageProps<"/app/workspace/people">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const user = (await getSessionUser())!;
  const ctx = toAccessContext(active);
  const canSeeUsers = can(ctx, "users", "view");
  const canSeeRoles = can(ctx, "roles", "view");
  if (!canSeeUsers && !canSeeRoles) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to manage logins and roles.
      </Alert>
    );
  }
  const tabs = [...(canSeeUsers ? [{ key: "logins", label: "Logins" }] : []), ...(canSeeRoles ? [{ key: "roles", label: "Roles" }] : [])];
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0].key;
  const supabase = await createClient();

  let body: React.ReactNode = null;
  if (tab === "logins") {
    const [{ data: memberRows }, { data: invites }, { data: roles }, { data: employees }] = await Promise.all([
      supabase
        .from("business_members")
        .select("id, user_id, status, role_id, employee_id, created_at")
        .eq("business_id", active.business_id)
        .order("created_at"),
      supabase
        .from("invitations")
        .select("id, email, role:roles(name), expires_at, created_at")
        .eq("business_id", active.business_id)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false }),
      supabase.from("roles").select("id, name, is_owner, key").eq("business_id", active.business_id).order("name"),
      supabase.from("employees").select("id, first_name, last_name, employee_code").eq("business_id", active.business_id).in("status", ["active", "probation", "on_leave", "suspended"]).order("first_name").limit(2000),
    ]);
    const members = await membersWithNames(supabase, memberRows);
    body = (
      <MembersPanel
        me={user.id}
        isOwner={active.is_owner}
        canInvite={can(ctx, "users", "create")}
        canEdit={can(ctx, "users", "edit")}
        roles={(roles ?? []).map((r) => ({ value: r.id, label: r.name, isOwner: r.is_owner, isStaff: r.key === "employee" }))}
        employees={(employees ?? []).map((e) => ({ value: e.id, label: `${e.first_name} ${e.last_name}`.trim() + ` · ${e.employee_code}` }))}
        members={members.map((m) => ({ id: m.id, userId: m.user_id, name: m.name, email: m.email, status: m.status, roleId: m.role_id, employeeId: m.employee_id }))}
        invites={(invites ?? []).map((i) => ({ id: i.id, email: i.email, role: (i.role as unknown as { name: string } | null)?.name ?? "", expires: formatDate(i.expires_at, active.date_format, active.timezone) }))}
      />
    );
  } else {
    const [{ data: roles }, { data: members }] = await Promise.all([
      supabase.from("roles").select("id, name, description, is_owner, is_system, permissions:role_permissions(resource, action, scope)").eq("business_id", active.business_id).order("is_owner", { ascending: false }).order("name"),
      supabase.from("business_members").select("role_id").eq("business_id", active.business_id),
    ]);
    const counts = new Map<string, number>();
    for (const m of members ?? []) counts.set(m.role_id, (counts.get(m.role_id) ?? 0) + 1);
    const tools = MODULES.filter((m) => m.resources.length && (m.core || active.modules.includes(m.key))).map((m) => ({
      key: m.key,
      name: m.name,
      resources: m.resources.map((r) => ({ key: r.key, label: r.label, description: r.description, actions: r.actions, employeeScoped: r.employeeScoped, ownerOnly: Boolean(r.ownerGrantOnly) })),
    }));
    body = (
      <RolesPanel
        isOwner={active.is_owner}
        canEdit={can(ctx, "roles", "edit")}
        canCreate={can(ctx, "roles", "create")}
        selected={sp.role}
        tools={tools}
        roles={(roles ?? []).map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          isOwner: r.is_owner,
          isSystem: r.is_system,
          people: counts.get(r.id) ?? 0,
          permissions: (r.permissions ?? []) as { resource: string; action: string; scope: "all" | "team" | "own" }[],
        }))}
      />
    );
  }

  return (
    <div>
      <PageHeader label="workspace" title="People & access" description="Who can sign in, and what each role can see and do. Managers see their team; staff see themselves." />
      {tabs.length > 1 && (
        <nav aria-label="Sections" className="mb-8 flex gap-6 border-b border-border">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/app/workspace/people?tab=${t.key}`}
              aria-current={t.key === tab ? "page" : undefined}
              className={cn("-mb-px border-b py-3 text-sm", t.key === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      {body}
    </div>
  );
}
