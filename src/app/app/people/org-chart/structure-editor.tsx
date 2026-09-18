"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPin, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { ActionForm, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { removeOrgItem, restoreOrgItem, saveOrgItem, type OrgKind } from "@/lib/people/org-actions";
import type { ActionResult } from "@/lib/errors";

type Row = Record<string, unknown> & { id: string; is_active: boolean; people: number };
type Opt = { value: string; label: string };

const GEOFENCE = [
  { value: "off", label: "Don't check" },
  { value: "flag", label: "Allow, but flag it for a manager" },
  { value: "block", label: "Don't allow clocking in from elsewhere" },
];

export function StructureEditor({
  canEdit,
  branches,
  departments,
  positions,
  people,
}: {
  canEdit: boolean;
  branches: Row[];
  departments: Row[];
  positions: Row[];
  people: Opt[];
}) {
  const [editing, setEditing] = useState<{ kind: OrgKind; row: Row | null } | null>(null);
  const [removing, setRemoving] = useState<{ kind: OrgKind; row: Row } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const router = useRouter();
  const close = useCallback(() => setEditing(null), []);
  const action = useCallback(
    (s: ActionResult, f: FormData) => (editing ? saveOrgItem(editing.kind, editing.row?.id ?? null, s, f) : Promise.resolve({})),
    [editing],
  );
  const deptOpts = departments.filter((d) => d.is_active).map((d) => ({ value: d.id, label: String(d.name) }));
  const branchOpts = branches.filter((b) => b.is_active).map((b) => ({ value: b.id, label: String(b.name) }));
  const deptName = new Map(departments.map((d) => [d.id, String(d.name)]));
  const peopleName = new Map(people.map((p) => [p.value, p.label]));
  const archivedCount = [...branches, ...departments, ...positions].filter((r) => !r.is_active).length;
  const v = (k: string) => (editing?.row?.[k] as string | number | null | undefined)?.toString() ?? "";

  const section = ({ kind, title, hint, rows, render }: { kind: OrgKind; title: string; hint: string; rows: Row[]; render: (r: Row) => React.ReactNode }) => {
    const shown = rows.filter((r) => r.is_active || showArchived);
    return (
      <section>
        <div className="mb-4 flex items-end justify-between gap-4 border-b border-border pb-3">
          <div>
            <h2 className="text-lg">{title}</h2>
            <p className="text-[13px] text-subtle-foreground">{hint}</p>
          </div>
          {canEdit && (
            <Button variant="secondary" size="sm" onClick={() => setEditing({ kind, row: null })}>
              <Plus className="size-3.5" aria-hidden /> Add
            </Button>
          )}
        </div>
        {shown.length === 0 ? (
          <EmptyState title={`No ${title.toLowerCase()} yet`} />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {shown.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">{render(r)}</div>
                <span className="text-[13px] whitespace-nowrap text-subtle-foreground tabular">
                  {r.people} {r.people === 1 ? "person" : "people"}
                </span>
                {canEdit &&
                  (r.is_active ? (
                    <span className="flex">
                      <Button variant="ghost" size="sm" aria-label="Edit" onClick={() => setEditing({ kind, row: r })}>
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => setRemoving({ kind, row: r })}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        const res = await restoreOrgItem(kind, r.id);
                        if (res.error) toast.error(res.error);
                        else {
                          toast.success("Restored.");
                          router.refresh();
                        }
                      }}
                    >
                      <RotateCcw className="size-3.5" aria-hidden /> Restore
                    </Button>
                  ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <div className="space-y-12">
      {archivedCount > 0 && (
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived ({archivedCount})
        </label>
      )}
      {section({
        kind: "branches",
        title: "Locations",
        hint: "Offices, resorts, shops or sites. A map position lets the staff app check where people clock in.",
        rows: branches,
        render: (r) => (
          <>
            <p className="text-foreground">
              {String(r.name)} {!r.is_active && <Badge>Archived</Badge>}
            </p>
            <p className="flex items-center gap-1 text-[13px] text-subtle-foreground">
              {r.atoll_island ? String(r.atoll_island) : null}
              {r.geofence_mode !== "off" && (
                <span className="inline-flex items-center gap-1">
                  {r.atoll_island ? " · " : ""}
                  <MapPin className="size-3" aria-hidden /> Clock-in area {String(r.geofence_radius_m)} m
                </span>
              )}
            </p>
          </>
        ),
      })}
      {section({
        kind: "departments",
        title: "Departments",
        hint: "Teams such as Front office, Kitchen or Housekeeping.",
        rows: departments,
        render: (r) => (
          <>
            <p className="text-foreground">
              {String(r.name)} {!r.is_active && <Badge>Archived</Badge>}
            </p>
            <p className="text-[13px] text-subtle-foreground">
              {[r.parent_id ? `Part of ${deptName.get(String(r.parent_id))}` : null, r.head_employee_id ? `Led by ${peopleName.get(String(r.head_employee_id)) ?? "someone who left"}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </>
        ),
      })}
      {section({
        kind: "positions",
        title: "Job titles",
        hint: "The roles people hold, such as Chef de partie or Receptionist.",
        rows: positions,
        render: (r) => (
          <>
            <p className="text-foreground">
              {String(r.title)} {!r.is_active && <Badge>Archived</Badge>}
            </p>
            <p className="text-[13px] text-subtle-foreground">{[r.department_id ? deptName.get(String(r.department_id)) : null, r.grade ? `Grade ${r.grade}` : null].filter(Boolean).join(" · ")}</p>
          </>
        ),
      })}

      <Modal
        open={Boolean(editing)}
        onClose={close}
        wide={editing?.kind === "branches"}
        title={`${editing?.row ? "Edit" : "Add"} ${editing?.kind === "branches" ? "location" : editing?.kind === "departments" ? "department" : "job title"}`}
      >
        {editing && (
          <ActionForm key={editing.row?.id ?? "new"} action={action} onSuccess={close}>
            {editing.kind === "branches" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="name" label="Name" defaultValue={v("name")} />
                <TextField name="code" label="Short code" defaultValue={v("code")} optional />
                <TextField name="atoll_island" label="Atoll and island" hint="For example K. Malé." defaultValue={v("atoll_island")} optional />
                <TextField name="phone" label="Phone" defaultValue={v("phone")} optional />
                <TextareaField name="address" label="Address" className="sm:col-span-2" defaultValue={v("address")} optional />
                <div className="rounded-lg border border-border p-4 sm:col-span-2">
                  <p className="text-sm text-foreground">Clock-in area</p>
                  <p className="mb-4 text-[13px] text-subtle-foreground">
                    Open Google Maps, press and hold on the location, and copy the two numbers it shows (for example 4.1755, 73.5093).
                  </p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <TextField name="latitude" label="Latitude" inputMode="decimal" defaultValue={v("latitude")} optional />
                    <TextField name="longitude" label="Longitude" inputMode="decimal" defaultValue={v("longitude")} optional />
                    <TextField name="geofence_radius_m" label="Radius (metres)" type="number" min={20} defaultValue={v("geofence_radius_m") || "150"} optional />
                    <SelectField name="geofence_mode" label="When someone clocks in outside it" options={GEOFENCE} defaultValue={v("geofence_mode") || "off"} className="sm:col-span-3" />
                  </div>
                </div>
              </div>
            )}
            {editing.kind === "departments" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="name" label="Name" defaultValue={v("name")} />
                <TextField name="code" label="Short code" defaultValue={v("code")} optional />
                <SelectField name="parent_id" label="Part of" options={deptOpts.filter((d) => d.value !== editing.row?.id)} placeholder="Nothing (top level)" defaultValue={v("parent_id")} optional />
                <SelectField name="branch_id" label="Location" options={branchOpts} placeholder="Any location" defaultValue={v("branch_id")} optional />
                <SelectField name="head_employee_id" label="Led by" options={people} placeholder="Nobody yet" defaultValue={v("head_employee_id")} optional />
                <TextField name="cost_center" label="Cost centre" defaultValue={v("cost_center")} optional />
              </div>
            )}
            {editing.kind === "positions" && (
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="title" label="Job title" defaultValue={v("title")} />
                <SelectField name="department_id" label="Department" options={deptOpts} placeholder="Any department" defaultValue={v("department_id")} optional />
                <TextField name="grade" label="Grade" defaultValue={v("grade")} optional />
                <TextareaField name="description" label="What the job involves" className="sm:col-span-2" defaultValue={v("description")} optional />
              </div>
            )}
          </ActionForm>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${String(removing?.row.name ?? removing?.row.title ?? "")}?`}
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await removeOrgItem(removing!.kind, removing!.row.id);
          setRemoving(null);
          if (r.error) toast.error(r.error);
          else {
            toast.success(r.message ?? "Removed.");
            router.refresh();
          }
        }}
      >
        {removing?.row.people ? "People are still linked to it, so it will be archived instead. You can restore it later." : "Nobody is linked to it."}
      </ConfirmDialog>
    </div>
  );
}
