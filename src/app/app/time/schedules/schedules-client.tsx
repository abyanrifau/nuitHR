"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Users } from "lucide-react";
import { ActionForm, CheckboxField, SelectField, TextField } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import type { ActionResult } from "@/lib/errors";
import { assignWorkSchedule, deleteWorkSchedule, saveWorkSchedule } from "@/lib/time/attendance-actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Weeks in the Maldives usually start on Sunday.
const ORDER = [0, 1, 2, 3, 4, 5, 6];

interface Schedule {
  id: string;
  name: string;
  working_days: number[];
  shift_id: string | null;
  is_default: boolean;
}
interface Person {
  id: string;
  name: string;
  department: string;
  schedule: string | null;
}

export const describeDays = (days: number[]) => {
  const off = ORDER.filter((d) => !days.includes(d));
  return `${days.length} ${days.length === 1 ? "day" : "days"} a week${off.length ? `, ${off.map((d) => DAYS[d]).join(" and ")} off` : ""}`;
};

function ScheduleForm({ schedule, shifts, onDone }: { schedule: Schedule | null; shifts: { id: string; label: string }[]; onDone: () => void }) {
  const action = useCallback((s: ActionResult, f: FormData) => saveWorkSchedule(schedule?.id ?? null, s, f), [schedule]);
  const days = schedule?.working_days ?? [0, 1, 2, 3, 4];
  return (
    <ActionForm action={action} onSuccess={onDone} submitLabel={schedule ? "Save" : "Add schedule"}>
      <TextField name="name" label="Name" defaultValue={schedule?.name ?? ""} placeholder="For example Six days, Friday off" />
      <fieldset>
        <legend className="mb-2 text-sm text-foreground">Working days</legend>
        <div className="flex flex-wrap gap-2">
          {ORDER.map((d) => (
            <label key={d} className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm has-checked:border-foreground has-checked:text-foreground">
              <input type="checkbox" name="working_days" value={d} defaultChecked={days.includes(d)} className="size-4" />
              {DAYS[d]}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-subtle-foreground">Days not ticked are rest days.</p>
      </fieldset>
      <SelectField name="shift_id" label="Usual shift" options={shifts.map((s) => ({ value: s.id, label: s.label }))} placeholder="No set times" defaultValue={schedule?.shift_id ?? ""} optional hint="Shift times and breaks are set in Workspace, Tools, Time & shifts." />
      <CheckboxField name="is_default" label="Use for everyone without a schedule of their own" defaultChecked={schedule?.is_default ?? false} />
    </ActionForm>
  );
}

function PeoplePicker({ schedule, schedules, people, onDone }: { schedule: Schedule; schedules: Schedule[]; people: Person[]; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(new Set(people.filter((p) => p.schedule === schedule.id).map((p) => p.id)));
  const [pending, start] = useTransition();
  const byDept = useMemo(() => {
    const m = new Map<string, Person[]>();
    for (const p of people) m.set(p.department, [...(m.get(p.department) ?? []), p]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [people]);
  const nameOf = (id: string | null) => schedules.find((s) => s.id === id)?.name;
  const toggle = (ids: string[], on: boolean) =>
    setPicked((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });
  const save = () =>
    start(async () => {
      const was = people.filter((p) => p.schedule === schedule.id).map((p) => p.id);
      const add = [...picked].filter((id) => !was.includes(id));
      const remove = was.filter((id) => !picked.has(id));
      for (const [target, ids] of [
        [schedule.id, add],
        [null, remove],
      ] as const) {
        if (!ids.length) continue;
        const r = await assignWorkSchedule(target, ids);
        if (r.error) return void toast.error(r.error);
      }
      toast.success("Saved.");
      onDone();
    });
  return (
    <div className="space-y-4">
      <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
        {byDept.map(([dept, list]) => (
          <fieldset key={dept}>
            <legend className="mb-1 flex w-full items-center justify-between text-[13px] text-muted-foreground">
              {dept}
              <button type="button" className="text-[12px] underline underline-offset-4" onClick={() => toggle(list.map((p) => p.id), !list.every((p) => picked.has(p.id)))}>
                {list.every((p) => picked.has(p.id)) ? "Clear all" : "Choose all"}
              </button>
            </legend>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {list.map((p) => (
                <li key={p.id}>
                  <label className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" className="size-4" checked={picked.has(p.id)} onChange={(e) => toggle([p.id], e.target.checked)} />
                    <span className="flex-1">{p.name}</span>
                    {p.schedule && p.schedule !== schedule.id && <span className="text-[12px] text-subtle-foreground">now on {nameOf(p.schedule)}</span>}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
      </div>
      <p className="text-[12px] text-subtle-foreground">People you untick go back to the default schedule.</p>
      <Button onClick={save} loading={pending}>
        Save
      </Button>
    </div>
  );
}

export function SchedulesClient({
  schedules,
  shifts,
  people,
  canEdit,
  canAssign,
  companyDays,
}: {
  schedules: Schedule[];
  shifts: { id: string; label: string }[];
  people: Person[];
  canEdit: boolean;
  canAssign: boolean;
  companyDays: number[];
}) {
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [assigning, setAssigning] = useState<Schedule | null>(null);
  const [deleting, setDeleting] = useState<Schedule | null>(null);
  const router = useRouter();
  const done = () => {
    setEditing(null);
    setAssigning(null);
    router.refresh();
  };
  const def = schedules.find((s) => s.is_default);
  const without = people.filter((p) => !p.schedule).length;

  return (
    <>
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden /> Add a schedule
          </Button>
        </div>
      )}
      {schedules.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          description={`Everyone works the company's working days (${describeDays(companyDays)}). Add a schedule for people who work different days, such as six days with Friday off.`}
        />
      ) : (
        <ul className="space-y-3">
          {schedules.map((s) => {
            const count = people.filter((p) => p.schedule === s.id).length + (s.is_default ? without : 0);
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-border p-4">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-foreground">
                    {s.name} {s.is_default && <Badge>Default</Badge>}
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {describeDays(s.working_days)} · {shifts.find((x) => x.id === s.shift_id)?.label ?? "no set times"}
                  </p>
                  <p className="text-[12px] text-subtle-foreground">
                    {count} {count === 1 ? "person" : "people"}
                    {s.is_default && without > 0 && ` (including ${without} without a schedule of their own)`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {canAssign && (
                    <Button variant="secondary" size="sm" onClick={() => setAssigning(s)}>
                      <Users className="size-3.5" aria-hidden /> People
                    </Button>
                  )}
                  {canEdit && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(s)}>
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {!def && schedules.length > 0 && (
        <p className="mt-4 text-[13px] text-muted-foreground">
          People without a schedule work the company&apos;s working days ({describeDays(companyDays)}). Mark a schedule as the default to change that.
        </p>
      )}

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing === "new" ? "Add a schedule" : `Edit ${editing?.name ?? ""}`}>
        {editing !== null && <ScheduleForm schedule={editing === "new" ? null : editing} shifts={shifts} onDone={done} />}
      </Modal>
      <Modal open={assigning !== null} onClose={() => setAssigning(null)} title={`Who works ${assigning?.name ?? ""}`}>
        {assigning && <PeoplePicker schedule={assigning} schedules={schedules} people={people} onDone={done} />}
      </Modal>
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        confirmLabel="Delete schedule"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const r = await deleteWorkSchedule(deleting!.id);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Deleted.");
          setDeleting(null);
          router.refresh();
        }}
      >
        <p>People on it go back to the default schedule. Past days that are already worked out don&apos;t change until they are next worked out.</p>
      </ConfirmDialog>
    </>
  );
}
