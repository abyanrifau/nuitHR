"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Lock, Plus, Trash2, UserPlus } from "lucide-react";
import { ActionForm, SelectField, TextField } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { createRole, deleteRole, inviteMember, revokeInvitation, saveRolePermissions, updateMember } from "@/lib/access/actions";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  status: string;
  roleId: string;
  employeeId: string | null;
}

export function MembersPanel({
  me,
  isOwner,
  canInvite,
  canEdit,
  roles,
  employees,
  members,
  invites,
}: {
  me: string;
  isOwner: boolean;
  canInvite: boolean;
  canEdit: boolean;
  roles: (Opt & { isOwner: boolean; isStaff: boolean })[];
  employees: Opt[];
  members: Member[];
  invites: { id: string; email: string; role: string; expires: string }[];
}) {
  const [inviting, setInviting] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const roleOpts = roles.filter((r) => isOwner || !r.isOwner);

  const update = (id: string, patch: Record<string, unknown>) =>
    start(async () => {
      const r = await updateMember(id, patch);
      if (r.error) toast.error(r.error);
      else {
        toast.success("Saved.");
        router.refresh();
      }
    });

  const inviteAction = async (s: ActionResult, f: FormData) => {
    const r = await inviteMember(s, f);
    if (r.link) setLink(r.link);
    return r;
  };

  return (
    <div className="space-y-10">
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg">Logins</h2>
          {canInvite && (
            <Button size="sm" onClick={() => (setInviting(true), setLink(null))}>
              <UserPlus className="size-3.5" aria-hidden /> Invite
            </Button>
          )}
        </div>
        <Table>
          <thead>
            <tr>
              <Th>Person</Th>
              <Th>Role</Th>
              <Th className="hidden md:table-cell">Profile</Th>
              <Th>Can sign in</Th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const role = roles.find((r) => r.value === m.roleId);
              const locked = !canEdit || (role?.isOwner && !isOwner) || m.userId === me;
              return (
                <Tr key={m.id}>
                  <Td>
                    <span className="block text-foreground">
                      {m.name} {m.userId === me && <Badge className="ml-1">You</Badge>}
                    </span>
                    <span className="block text-[13px] text-subtle-foreground">{m.email}</span>
                  </Td>
                  <Td className="min-w-[10rem]">
                    {locked ? (
                      <span className="text-muted-foreground">{role?.label}</span>
                    ) : (
                      <Select aria-label={`Role for ${m.name}`} options={roleOpts} value={m.roleId} disabled={pending} onChange={(e) => update(m.id, { role_id: e.target.value })} />
                    )}
                  </Td>
                  <Td className="hidden min-w-[12rem] md:table-cell">
                    {canEdit ? (
                      <Select
                        aria-label={`Profile for ${m.name}`}
                        options={employees}
                        placeholder="Not linked"
                        value={m.employeeId ?? ""}
                        disabled={pending}
                        onChange={(e) => update(m.id, { employee_id: e.target.value || null })}
                      />
                    ) : m.employeeId ? (
                      <Link href={`/app/people/${m.employeeId}`} className="underline underline-offset-4">
                        View profile
                      </Link>
                    ) : (
                      <span className="text-subtle-foreground">Not linked</span>
                    )}
                  </Td>
                  <Td>
                    {locked ? (
                      <span className="text-muted-foreground">{m.status === "active" ? "Yes" : "No"}</span>
                    ) : (
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => update(m.id, { status: m.status === "active" ? "disabled" : "active" })}>
                        {m.status === "active" ? "Yes · turn off" : "No · turn on"}
                      </Button>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
        <p className="mt-3 text-[13px] text-subtle-foreground">Linking a login to a profile lets that person see their own time off, payslips and files in the staff app.</p>
      </section>

      {invites.length > 0 && (
        <section>
          <h2 className="mb-4 text-lg">Waiting to accept</h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">{i.email}</p>
                  <p className="text-[13px] text-subtle-foreground">
                    {i.role} · link works until {i.expires}
                  </p>
                </div>
                {canInvite && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await revokeInvitation(i.id);
                        if (r.error) toast.error(r.error);
                        else {
                          toast.success("Invitation cancelled.");
                          router.refresh();
                        }
                      })
                    }
                  >
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal open={inviting} onClose={() => setInviting(false)} title="Invite someone" description="They'll get an email with a link to set a password and join.">
        {link ? (
          <div className="space-y-4">
            <Alert tone="success">Invitation ready. If the email doesn&apos;t arrive, send them this link.</Alert>
            <div className="flex items-center gap-2 rounded-lg border border-border p-3 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{link}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(link);
                  toast.success("Link copied.");
                }}
              >
                <Copy className="size-3.5" aria-hidden /> Copy
              </Button>
            </div>
            <Button variant="ghost" onClick={() => setInviting(false)}>
              Done
            </Button>
          </div>
        ) : (
          <ActionForm action={inviteAction} submitLabel="Send invitation" pendingLabel="Sending…" onSuccess={() => router.refresh()}>
            <TextField name="email" label="Email" type="email" autoFocus />
            <SelectField name="role_id" label="Role" options={roleOpts} defaultValue={roleOpts.find((r) => r.isStaff)?.value} />
            <SelectField name="employee_id" label="Link to profile" options={employees} placeholder="Not linked (for example an outside accountant)" optional />
          </ActionForm>
        )}
      </Modal>
    </div>
  );
}

interface Tool {
  key: string;
  name: string;
  resources: { key: string; label: string; description: string; actions: string[]; employeeScoped: boolean; ownerOnly: boolean }[];
}

interface Role {
  id: string;
  name: string;
  description: string | null;
  isOwner: boolean;
  isSystem: boolean;
  people: number;
  permissions: { resource: string; action: string; scope: "all" | "team" | "own" }[];
}

const ACTIONS = ["view", "create", "edit", "approve", "delete", "export"] as const;
const ACTION_LABEL: Record<string, string> = { view: "See", create: "Add", edit: "Change", approve: "Approve", delete: "Remove", export: "Export" };
const SCOPES = [
  { value: "", label: "No" },
  { value: "own", label: "Own" },
  { value: "team", label: "Team" },
  { value: "all", label: "All" },
];

export function RolesPanel({
  isOwner,
  canEdit,
  canCreate,
  selected,
  tools,
  roles,
}: {
  isOwner: boolean;
  canEdit: boolean;
  canCreate: boolean;
  selected?: string;
  tools: Tool[];
  roles: Role[];
}) {
  const role = roles.find((r) => r.id === selected) ?? roles.find((r) => !r.isOwner) ?? roles[0];
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState(false);
  const router = useRouter();

  return (
    <div className="grid gap-8 lg:grid-cols-[16rem_1fr]">
      <aside>
        <ul className="space-y-1">
          {roles.map((r) => (
            <li key={r.id}>
              <Link
                href={`/app/workspace/people?tab=roles&role=${r.id}`}
                aria-current={r.id === role?.id ? "true" : undefined}
                className={cn("flex items-center justify-between rounded-lg px-3 py-2 text-sm", r.id === role?.id ? "bg-accent-soft text-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                <span className="truncate">{r.name}</span>
                <span className="text-[12px] text-subtle-foreground tabular">{r.people}</span>
              </Link>
            </li>
          ))}
        </ul>
        {canCreate && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" aria-hidden /> New role
          </Button>
        )}
      </aside>

      {role && (
        <div className="min-w-0">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl">{role.name}</h2>
              {role.description && <p className="mt-1 text-sm text-muted-foreground">{role.description}</p>}
              <p className="mt-1 text-[13px] text-subtle-foreground">
                {role.people} {role.people === 1 ? "person" : "people"}
                {role.isSystem && " · built-in role"}
              </p>
            </div>
            {!role.isSystem && !role.isOwner && canEdit && (
              <Button variant="danger" size="sm" onClick={() => setRemoving(true)}>
                <Trash2 className="size-3.5" aria-hidden /> Remove role
              </Button>
            )}
          </div>
          {role.isOwner ? (
            <Alert tone="info" title="Owners can do everything">
              The owner role always has full access, including salaries and billing. It can&apos;t be limited.
            </Alert>
          ) : (
            <Matrix key={role.id} role={role} tools={tools} canEdit={canEdit} isOwner={isOwner} />
          )}
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New role" description="Start from an existing role and adjust it, or start empty.">
        <ActionForm
          action={createRole}
          submitLabel="Create role"
          onSuccess={(s) => {
            setCreating(false);
            const id = (s as { id?: string }).id;
            router.push(id ? `/app/workspace/people?tab=roles&role=${id}` : "/app/workspace/people?tab=roles");
          }}
        >
          <TextField name="name" label="Name" placeholder="For example Supervisor" autoFocus />
          <TextField name="description" label="What it's for" optional />
          <SelectField name="copy_from" label="Copy permissions from" options={roles.filter((r) => !r.isOwner).map((r) => ({ value: r.id, label: r.name }))} placeholder="Start empty" optional />
        </ActionForm>
      </Modal>
      <ConfirmDialog
        open={removing}
        title={`Remove ${role?.name}?`}
        confirmLabel="Remove role"
        onCancel={() => setRemoving(false)}
        onConfirm={async () => {
          const r = await deleteRole(role!.id);
          setRemoving(false);
          if (r.error) toast.error(r.error);
          else {
            toast.success("Role removed.");
            router.push("/app/workspace/people?tab=roles");
          }
        }}
      />
    </div>
  );
}

function Matrix({ role, tools, canEdit, isOwner }: { role: Role; tools: Tool[]; canEdit: boolean; isOwner: boolean }) {
  const initial = Object.fromEntries(role.permissions.map((p) => [`${p.resource}:${p.action}`, p.scope])) as Record<string, string>;
  const [grid, setGrid] = useState<Record<string, string>>(initial);
  const [pending, start] = useTransition();
  const norm = (g: Record<string, string>) => JSON.stringify(Object.entries(g).filter(([, v]) => v).sort());
  const dirty = norm(grid) !== norm(initial);
  // Keep rows for tools that are switched off, so saving never drops them.
  const hidden = role.permissions.filter((p) => !tools.some((t) => t.resources.some((r) => r.key === p.resource)));

  const save = () =>
    start(async () => {
      const grants = [
        ...Object.entries(grid)
          .filter(([, s]) => s)
          .map(([k, scope]) => {
            const [resource, action] = k.split(":");
            return { resource, action, scope };
          }),
        ...hidden,
      ];
      const r = await saveRolePermissions(role.id, grants);
      if (r.error) toast.error(r.error);
      else toast.success(r.message ?? "Saved.");
    });

  return (
    <div>
      <p className="mb-4 text-[13px] text-subtle-foreground">
        <strong className="font-normal text-muted-foreground">Own</strong> means only their own records. <strong className="font-normal text-muted-foreground">Team</strong> adds the people who report to them.{" "}
        <strong className="font-normal text-muted-foreground">All</strong> means everyone in the company.
      </p>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead>
            <tr>
              <th className="border-b border-border px-4 py-3 text-[11px] font-normal tracking-[0.12em] text-subtle-foreground uppercase">Area</th>
              {ACTIONS.map((a) => (
                <th key={a} className="border-b border-border px-2 py-3 text-center text-[11px] font-normal tracking-[0.12em] text-subtle-foreground uppercase">
                  {ACTION_LABEL[a]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tools.map((t) => (
              <Fragment key={t.key}>
                <tr>
                  <td colSpan={7} className="border-b border-border bg-surface-muted px-4 py-2 text-[12px] text-muted-foreground">
                    {t.name}
                  </td>
                </tr>
                {t.resources.map((r) => {
                  const locked = !canEdit || (r.ownerOnly && !isOwner);
                  return (
                    <tr key={r.key} className="hover:bg-accent-soft">
                      <td className="border-b border-border px-4 py-2.5">
                        <span className="flex items-center gap-1.5 text-foreground">
                          {r.label}
                          {r.ownerOnly && <Lock className="size-3 text-subtle-foreground" aria-label="Only the owner can change this" />}
                        </span>
                        <span className="block text-[12px] text-subtle-foreground">{r.description}</span>
                      </td>
                      {ACTIONS.map((a) => {
                        const k = `${r.key}:${a}`;
                        if (!r.actions.includes(a)) return <td key={a} className="border-b border-border" />;
                        const value = grid[k] ?? "";
                        const opts = r.employeeScoped ? SCOPES : SCOPES.filter((s) => s.value === "" || s.value === "all").map((s) => (s.value === "all" ? { ...s, label: "Yes" } : s));
                        return (
                          <td key={a} className="border-b border-border px-1.5 py-2 text-center">
                            <select
                              aria-label={`${r.label}: ${ACTION_LABEL[a]}`}
                              value={value}
                              disabled={locked}
                              onChange={(e) => setGrid((g) => ({ ...g, [k]: e.target.value }))}
                              className={cn(
                                "h-8 w-[4.5rem] rounded-md border bg-surface px-1.5 text-[13px] disabled:opacity-60",
                                value ? "border-border-strong text-foreground" : "border-border text-subtle-foreground",
                              )}
                            >
                              {opts.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {!isOwner && <p className="mt-3 text-[13px] text-subtle-foreground">Rows with a lock can only be changed by the owner.</p>}
      {canEdit && (
        <div className="sticky bottom-4 mt-4 flex gap-2">
          <Button onClick={save} loading={pending} disabled={!dirty}>
            Save permissions
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setGrid(initial)}>
              Undo changes
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
