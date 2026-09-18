"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { deleteTemplate, saveTemplate } from "@/lib/joiners/actions";

type Opt = { value: string; label: string };
type Task = { title: string; assignee_type: "hr" | "manager" | "employee"; due_offset_days: number };
interface Template {
  id: string | null;
  name: string;
  kind: "onboarding" | "offboarding";
  department_id: string | null;
  is_default: boolean;
  tasks: Task[];
}

const WHO: Opt[] = [
  { value: "hr", label: "HR" },
  { value: "manager", label: "Their manager" },
  { value: "employee", label: "The person" },
];

export function TemplatesEditor({ canEdit, departments, templates }: { canEdit: boolean; departments: Opt[]; templates: Template[] }) {
  const [editing, setEditing] = useState<Template | null>(null);
  const [removing, setRemoving] = useState<Template | null>(null);
  const router = useRouter();

  if (editing) return <Editor initial={editing} departments={departments} onDone={() => (setEditing(null), router.refresh())} />;

  return (
    <div className="space-y-8">
      {(["onboarding", "offboarding"] as const).map((kind) => (
        <section key={kind}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg">{kind === "onboarding" ? "Joining" : "Leaving"}</h2>
            {canEdit && (
              <Button variant="secondary" size="sm" onClick={() => setEditing({ id: null, name: "", kind, department_id: null, is_default: !templates.some((t) => t.kind === kind), tasks: [{ title: "", assignee_type: "hr", due_offset_days: 0 }] })}>
                <Plus className="size-3.5" aria-hidden /> New checklist
              </Button>
            )}
          </div>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {templates
              .filter((t) => t.kind === kind)
              .map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">
                      {t.name} {t.is_default && <Badge className="ml-1">Usual one</Badge>}
                    </p>
                    <p className="text-[12px] text-subtle-foreground">
                      {t.tasks.length} steps{t.department_id && ` · for ${departments.find((d) => d.value === t.department_id)?.label ?? "a department"}`}
                    </p>
                  </div>
                  {canEdit && (
                    <>
                      <Button variant="secondary" size="sm" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" aria-label={`Remove ${t.name}`} onClick={() => setRemoving(t)}>
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name}?`}
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await deleteTemplate(removing!.id!);
          setRemoving(null);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Removed.");
          router.refresh();
        }}
      >
        Checklists already started with it carry on.
      </ConfirmDialog>
    </div>
  );
}

function Editor({ initial, departments, onDone }: { initial: Template; departments: Opt[]; onDone: () => void }) {
  const [t, setT] = useState(initial);
  const [pending, start] = useTransition();
  const setTask = (i: number, patch: Partial<Task>) => setT((x) => ({ ...x, tasks: x.tasks.map((k, j) => (j === i ? { ...k, ...patch } : k)) }));
  const move = (i: number, d: -1 | 1) =>
    setT((x) => {
      const tasks = [...x.tasks];
      [tasks[i], tasks[i + d]] = [tasks[i + d], tasks[i]];
      return { ...x, tasks };
    });
  const joining = t.kind === "onboarding";

  return (
    <div className="space-y-5">
      <h2 className="text-xl">{initial.id ? `Edit ${initial.name}` : joining ? "New joiner checklist" : "New leaver checklist"}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="ct-name">
          <Input id="ct-name" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder={joining ? "For example Kitchen joiners" : "For example Standard leavers"} />
        </Field>
        <Field label="For" htmlFor="ct-dept">
          <Select id="ct-dept" options={departments} placeholder="Everyone" value={t.department_id ?? ""} onChange={(e) => setT({ ...t, department_id: e.target.value || null })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={t.is_default} onChange={(e) => setT({ ...t, is_default: e.target.checked })} /> Use this one when nothing more specific fits
      </label>
      <ol className="space-y-2">
        {t.tasks.map((k, i) => (
          <li key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_10rem_9rem_auto]">
            <Input aria-label={`Step ${i + 1}`} value={k.title} onChange={(e) => setTask(i, { title: e.target.value })} placeholder="For example Collect passport copy" />
            <Select aria-label="Who does it" options={WHO} value={k.assignee_type} onChange={(e) => setTask(i, { assignee_type: e.target.value as Task["assignee_type"] })} />
            <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Input
                aria-label="Days"
                type="number"
                className="w-16"
                value={Math.abs(k.due_offset_days)}
                min={0}
                onChange={(e) => setTask(i, { due_offset_days: (k.due_offset_days < 0 ? -1 : 1) * Math.abs(Number(e.target.value) || 0) })}
              />
              <select
                aria-label="Before or after"
                className="h-10 rounded-lg border border-border-strong bg-surface px-1 text-[13px]"
                value={k.due_offset_days < 0 ? "before" : "after"}
                onChange={(e) => setTask(i, { due_offset_days: (e.target.value === "before" ? -1 : 1) * Math.abs(k.due_offset_days) })}
              >
                <option value="after">days after</option>
                <option value="before">days before</option>
              </select>
            </label>
            <span className="flex">
              <Button variant="ghost" size="sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp className="size-3.5" aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" aria-label="Move down" disabled={i === t.tasks.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown className="size-3.5" aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" aria-label="Remove step" onClick={() => setT((x) => ({ ...x, tasks: x.tasks.filter((_, j) => j !== i) }))}>
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[13px] text-subtle-foreground">Days are counted from their {joining ? "first day" : "last day"}.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => setT((x) => ({ ...x, tasks: [...x.tasks, { title: "", assignee_type: "hr", due_offset_days: 0 }] }))}>
          <Plus className="size-3.5" aria-hidden /> Add a step
        </Button>
        <Button
          size="sm"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await saveTemplate(t.id, { name: t.name, kind: t.kind, department_id: t.department_id, is_default: t.is_default, tasks: t.tasks.filter((k) => k.title.trim()) });
              if (r.error) return void toast.error(r.error);
              toast.success(r.message ?? "Saved.");
              onDone();
            })
          }
        >
          Save checklist
        </Button>
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
