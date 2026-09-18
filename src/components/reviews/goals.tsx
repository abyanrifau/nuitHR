"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { ActionForm, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { StatusDot } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { deleteGoal, saveGoal, updateGoalProgress } from "@/lib/reviews/actions";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };
export interface GoalRow {
  id: string;
  level: "company" | "department" | "individual";
  title: string;
  description: string | null;
  metric: string | null;
  target_value: number | null;
  current_value: number | null;
  progress_percent: number;
  status: string;
  due_date: string | null;
  due_label: string | null;
  department_id: string | null;
  employee_id: string | null;
  owner: string;
  canEdit: boolean;
  canDelete: boolean;
}

export const GOAL_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  not_started: { label: "Not started", tone: "neutral" },
  on_track: { label: "On track", tone: "success" },
  at_risk: { label: "At risk", tone: "warning" },
  behind: { label: "Behind", tone: "danger" },
  completed: { label: "Done", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
const STATUS_OPTS = Object.entries(GOAL_STATUS).map(([value, s]) => ({ value, label: s.label }));

export function AddGoalButton({
  levels,
  departments,
  people,
  fixedEmployee,
  label = "Add a goal",
}: {
  levels: Opt[];
  departments: Opt[];
  people: Opt[];
  fixedEmployee?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> {label}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a goal">
        <GoalForm levels={levels} departments={departments} people={people} fixedEmployee={fixedEmployee} onDone={() => (setOpen(false), router.refresh())} />
      </Modal>
    </>
  );
}

function GoalForm({
  levels,
  departments,
  people,
  fixedEmployee,
  goal,
  onDone,
}: {
  levels: Opt[];
  departments: Opt[];
  people: Opt[];
  fixedEmployee?: string;
  goal?: GoalRow;
  onDone: () => void;
}) {
  const [level, setLevel] = useState(goal?.level ?? levels[0]?.value ?? "individual");
  return (
    <ActionForm action={saveGoal.bind(null, goal?.id ?? null)} onSuccess={onDone}>
      {fixedEmployee ? (
        <>
          <input type="hidden" name="level" value="individual" />
          <input type="hidden" name="employee_id" value={fixedEmployee} />
        </>
      ) : (
        <>
          <SelectField name="level" label="Whose goal" options={levels} value={level} onChange={(e) => setLevel(e.target.value as GoalRow["level"])} />
          {level === "department" && <SelectField name="department_id" label="Department" options={departments} placeholder="Choose" defaultValue={goal?.department_id ?? ""} />}
          {level === "individual" && <SelectField name="employee_id" label="Person" options={people} placeholder="Choose" defaultValue={goal?.employee_id ?? ""} />}
        </>
      )}
      <TextField name="title" label="Goal" defaultValue={goal?.title} placeholder="For example Raise guest review score to 4.7" />
      <TextareaField name="description" label="Details" optional defaultValue={goal?.description ?? ""} />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField name="metric" label="Measured by" optional defaultValue={goal?.metric ?? ""} placeholder="For example Review score" />
        <TextField name="target_value" label="Target" type="number" step="any" optional defaultValue={goal?.target_value ?? ""} />
        <TextField name="due_date" label="Due by" type="date" optional defaultValue={goal?.due_date ?? ""} />
      </div>
    </ActionForm>
  );
}

export function GoalList({
  goals,
  levels,
  departments,
  people,
  fixedEmployee,
  empty,
}: {
  goals: GoalRow[];
  levels: Opt[];
  departments: Opt[];
  people: Opt[];
  fixedEmployee?: string;
  empty: string;
}) {
  const [updating, setUpdating] = useState<GoalRow | null>(null);
  const [editing, setEditing] = useState<GoalRow | null>(null);
  const [removing, setRemoving] = useState<GoalRow | null>(null);
  const router = useRouter();

  if (!goals.length) return <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {goals.map((g) => {
          const s = GOAL_STATUS[g.status] ?? GOAL_STATUS.not_started;
          return (
            <li key={g.id} className="space-y-2 px-4 py-3.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className={cn("text-foreground", g.status === "cancelled" && "text-muted-foreground line-through")}>{g.title}</p>
                  <p className="text-[12px] text-subtle-foreground">
                    {g.owner}
                    {g.metric && ` · ${g.metric}`}
                    {g.target_value !== null && `: ${g.current_value ?? 0} of ${g.target_value}`}
                    {g.due_label && ` · due ${g.due_label}`}
                  </p>
                </div>
                <StatusDot tone={s.tone}>{s.label}</StatusDot>
              </div>
              <div className="flex items-center gap-3">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuenow={g.progress_percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.title} progress`}>
                  <span className={cn("block h-full", g.status === "completed" ? "bg-success" : "bg-foreground")} style={{ width: `${g.progress_percent}%` }} />
                </span>
                <span className="w-10 text-right text-[12px] tabular text-muted-foreground">{g.progress_percent}%</span>
              </div>
              {(g.canEdit || g.canDelete) && (
                <div className="flex flex-wrap gap-1">
                  {g.canEdit && (
                    <Button variant="secondary" size="sm" onClick={() => setUpdating(g)}>
                      Update progress
                    </Button>
                  )}
                  {g.canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(g)}>
                      Edit
                    </Button>
                  )}
                  {g.canDelete && (
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(g)}>
                      Delete
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Modal open={Boolean(updating)} onClose={() => setUpdating(null)} title="Update progress" description={updating?.title}>
        {updating && <ProgressForm goal={updating} onDone={() => (setUpdating(null), router.refresh())} />}
      </Modal>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Edit goal">
        {editing && (
          <GoalForm
            goal={editing}
            levels={levels}
            departments={departments}
            people={people}
            fixedEmployee={fixedEmployee}
            onDone={() => (setEditing(null), router.refresh())}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={Boolean(removing)}
        title="Delete this goal?"
        confirmLabel="Delete"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await deleteGoal(removing!.id);
          setRemoving(null);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Deleted.");
          router.refresh();
        }}
      >
        Its progress updates are deleted too. To keep a record, mark it as cancelled instead.
      </ConfirmDialog>
    </>
  );
}

function ProgressForm({ goal, onDone }: { goal: GoalRow; onDone: () => void }) {
  const [progress, setProgress] = useState(goal.progress_percent);
  const [status, setStatus] = useState(goal.status === "not_started" ? "on_track" : goal.status);
  const [value, setValue] = useState(goal.current_value?.toString() ?? "");
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="space-y-4">
      <Field label={`How far along (${progress}%)`} htmlFor="gp-range">
        <input id="gp-range" type="range" min={0} max={100} step={5} value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="w-full accent-[var(--color-accent)]" />
      </Field>
      {goal.target_value !== null && (
        <Field label={`${goal.metric ?? "Value"} now`} htmlFor="gp-value" hint={`Target: ${goal.target_value}`}>
          <Input id="gp-value" type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} className="w-40" />
        </Field>
      )}
      <Field label="Status" htmlFor="gp-status">
        <Select id="gp-status" options={STATUS_OPTS} value={status} onChange={(e) => setStatus(e.target.value)} />
      </Field>
      <Field label="What changed" htmlFor="gp-comment" optional>
        <Textarea id="gp-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <Button
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await updateGoalProgress(goal.id, { progress, status, value: value === "" ? null : Number(value), comment });
            if (r.error) return void toast.error(r.error);
            toast.success(r.message ?? "Saved.");
            onDone();
          })
        }
      >
        Save progress
      </Button>
    </div>
  );
}
