"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { createInvitation } from "@/lib/invitations";
import { friendly, type ActionResult } from "@/lib/errors";
import { allResources } from "@/modules/registry";

function denied(code: string | undefined, message: string) {
  return code === "42501" ? message : undefined;
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  role_id: z.string().uuid("Choose a role."),
  employee_id: z
    .union([z.literal(""), z.string().uuid()])
    .transform((v) => v || null)
    .optional(),
});

export async function inviteMember(_: ActionResult, form: FormData): Promise<ActionResult & { link?: string }> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = inviteSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const [{ data: role }, { data: profile }] = await Promise.all([
    supabase.from("roles").select("id, name, is_owner").eq("id", parsed.data.role_id).eq("business_id", active.business_id).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
  ]);
  if (!role) return { error: "That role doesn't exist." };
  if (role.is_owner && !active.is_owner) return { error: "Only an owner can invite another owner." };
  const inv = await createInvitation({
    businessId: active.business_id,
    businessName: active.business_name,
    email: parsed.data.email,
    roleId: role.id,
    roleName: role.name,
    employeeId: parsed.data.employee_id ?? null,
    inviterName: profile?.full_name || "Your manager",
  });
  if (!inv.link) return { error: inv.error ?? "Could not create the invitation." };
  revalidatePath("/app/workspace/people");
  return inv.emailed
    ? { ok: true, message: `Invitation sent to ${parsed.data.email}.`, link: inv.link }
    : { ok: true, message: "Invitation created, but the email couldn't be sent. Copy the link and send it yourself.", link: inv.link };
}

export async function revokeInvitation(id: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { error, count } = await supabase.from("invitations").update({ revoked_at: new Date().toISOString() }, { count: "exact" }).eq("id", id);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to cancel invitations." };
  revalidatePath("/app/workspace/people");
  return { ok: true, message: "Invitation cancelled." };
}

const memberSchema = z.object({
  role_id: z.string().uuid().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  employee_id: z.string().uuid().nullable().optional(),
});

/** Change someone's role, link them to a profile, or turn their login off/on. */
export async function updateMember(memberId: string, patch: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = memberSchema.safeParse(patch);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const supabase = await createClient();
  const { data: m } = await supabase.from("business_members").select("user_id").eq("id", memberId).maybeSingle();
  if (m?.user_id === user.id && parsed.data.status === "disabled") return { error: "You can't turn off your own login." };
  const { error, count } = await supabase.from("business_members").update(parsed.data, { count: "exact" }).eq("id", memberId);
  if (error) {
    if (error.code === "23505") return { error: "That profile is already linked to another login." };
    return { error: denied(error.code, friendly(error.message)) ?? friendly(error.message) };
  }
  if (!count) return { error: "You don't have permission to change logins." };
  revalidatePath("/app/workspace/people");
  return { ok: true, message: "Saved." };
}

const roleSchema = z.object({
  name: z.string().trim().min(2, "Give the role a name.").max(60),
  description: z.string().trim().max(200).optional(),
  copy_from: z
    .union([z.literal(""), z.string().uuid()])
    .transform((v) => v || null)
    .optional(),
});

export async function createRole(_: ActionResult, form: FormData): Promise<ActionResult & { id?: string }> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = roleSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { error: parsed.error.issues[0].message, fieldErrors: parsed.error.flatten().fieldErrors };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .insert({ business_id: active.business_id, name: parsed.data.name, description: parsed.data.description || null })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { error: "There's already a role with that name." };
    if (error.code === "42501") return { error: "Only the owner can create roles." };
    return { error: friendly(error.message) };
  }
  if (parsed.data.copy_from) {
    const { data: perms } = await supabase.from("role_permissions").select("resource, action, scope").eq("role_id", parsed.data.copy_from);
    if (perms?.length) {
      const { error: copyErr } = await supabase.from("role_permissions").insert(perms.map((p) => ({ ...p, business_id: active.business_id, role_id: data.id })));
      if (copyErr) return { ok: true, id: data.id, message: `Role created, but some permissions couldn't be copied: ${friendly(copyErr.message)}` };
    }
  }
  revalidatePath("/app/workspace/people");
  return { ok: true, id: data.id, message: "Role created." };
}

export async function deleteRole(roleId: string): Promise<ActionResult> {
  await requireUser();
  const supabase = await createClient();
  const { count: inUse } = await supabase.from("business_members").select("id", { count: "exact", head: true }).eq("role_id", roleId);
  if (inUse) return { error: `${inUse} ${inUse === 1 ? "person has" : "people have"} this role. Give them another role first.` };
  const { error, count } = await supabase.from("roles").delete({ count: "exact" }).eq("id", roleId);
  if (error) return { error: friendly(error.message) };
  if (!count) return { error: "You don't have permission to remove roles." };
  revalidatePath("/app/workspace/people");
  return { ok: true, message: "Role removed." };
}

const grantSchema = z.array(
  z.object({
    resource: z.string().min(2).max(60),
    action: z.enum(["view", "create", "edit", "approve", "delete", "export"]),
    scope: z.enum(["all", "team", "own"]),
  }),
);

/**
 * Saves the permission grid for one role. Only the rows that changed are
 * written, so an admin can edit a role without touching the salary rows
 * that only the owner may change.
 */
export async function saveRolePermissions(roleId: string, grants: unknown): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "No company selected." };
  const parsed = grantSchema.safeParse(grants);
  if (!parsed.success) return { error: "Those permissions aren't valid." };
  const known = new Map(allResources().map((r) => [r.key, r]));
  for (const g of parsed.data) {
    const r = known.get(g.resource);
    if (!r || !r.actions.includes(g.action)) return { error: `Unknown permission: ${g.resource} ${g.action}.` };
    if (!r.employeeScoped && g.scope !== "all") return { error: `${r.label} can only be given for the whole company.` };
  }
  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("id, is_owner").eq("id", roleId).eq("business_id", active.business_id).maybeSingle();
  if (!role) return { error: "Role not found." };
  if (role.is_owner) return { error: "The owner can always do everything." };
  const { data: current, error: readErr } = await supabase.from("role_permissions").select("id, resource, action, scope").eq("role_id", roleId);
  if (readErr) return { error: friendly(readErr.message) };

  const key = (g: { resource: string; action: string }) => `${g.resource}:${g.action}`;
  const want = new Map(parsed.data.map((g) => [key(g), g]));
  const have = new Map((current ?? []).map((g) => [key(g), g]));
  const toDelete = (current ?? []).filter((g) => !want.has(key(g))).map((g) => g.id);
  const toInsert = parsed.data.filter((g) => !have.has(key(g)));
  const toUpdate = (current ?? []).filter((g) => want.has(key(g)) && want.get(key(g))!.scope !== g.scope);

  const ownerMsg = "Only the owner can change access to salaries, payroll or roles.";
  if (toDelete.length) {
    const { error } = await supabase.from("role_permissions").delete().in("id", toDelete);
    if (error) return { error: error.code === "42501" ? ownerMsg : friendly(error.message) };
  }
  for (const g of toUpdate) {
    const { error } = await supabase.from("role_permissions").update({ scope: want.get(key(g))!.scope }).eq("id", g.id);
    if (error) return { error: error.code === "42501" ? ownerMsg : friendly(error.message) };
  }
  if (toInsert.length) {
    const { error } = await supabase.from("role_permissions").insert(toInsert.map((g) => ({ ...g, business_id: active.business_id, role_id: roleId })));
    if (error) return { error: error.code === "42501" ? ownerMsg : friendly(error.message) };
  }
  revalidatePath("/app/workspace/people");
  revalidatePath("/app", "layout");
  const n = toDelete.length + toInsert.length + toUpdate.length;
  return { ok: true, message: n ? "Permissions saved. People with this role see the change next time a page loads." : "Nothing changed." };
}
