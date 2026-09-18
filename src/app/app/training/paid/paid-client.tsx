"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { ActionForm, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { savePaidTraining } from "@/lib/training/actions";

type Opt = { value: string; label: string };
export interface PaidRow {
  id: string;
  employee_id: string;
  person: string;
  provider: string;
  course_name: string;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  cost: number;
  currency: string;
  bond_months: number | null;
  bond_end_date: string | null;
  status: string;
  notes: string | null;
}

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  requested: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  in_progress: { label: "Taking it now", tone: "info" },
  completed: { label: "Finished", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
const STATUS_OPTS = Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }));

function PaidForm({ people, row, onDone }: { people: Opt[]; row?: PaidRow; onDone: () => void }) {
  return (
    <ActionForm action={savePaidTraining.bind(null, row?.id ?? null)} onSuccess={onDone}>
      <SelectField name="employee_id" label="Person" options={people} placeholder="Choose a person" defaultValue={row?.employee_id ?? ""} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="course_name" label="Course" defaultValue={row?.course_name} />
        <TextField name="provider" label="Run by" defaultValue={row?.provider} placeholder="For example Maldives Hospitality School" />
        <TextField name="location" label="Where" optional defaultValue={row?.location ?? ""} />
        <TextField name="cost" label="Cost" type="number" min={0} step="0.01" defaultValue={row?.cost ?? ""} />
        <TextField name="start_date" label="Starts" type="date" optional defaultValue={row?.start_date ?? ""} />
        <TextField name="end_date" label="Ends" type="date" optional defaultValue={row?.end_date ?? ""} />
        <TextField name="bond_months" label="Bond (months)" type="number" min={0} optional defaultValue={row?.bond_months ?? ""} hint="How long they agree to stay after the course." />
        <SelectField name="status" label="Status" options={STATUS_OPTS} defaultValue={row?.status ?? "approved"} />
      </div>
      <TextareaField name="notes" label="Notes" optional defaultValue={row?.notes ?? ""} />
    </ActionForm>
  );
}

export function AddPaidButton({ people }: { people: Opt[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> Add
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record paid training">
        <PaidForm people={people} onDone={() => (setOpen(false), router.refresh())} />
      </Modal>
    </>
  );
}

export function PaidTable({ rows, people, canEdit, dateFormat, today }: { rows: PaidRow[]; people: Opt[]; canEdit: boolean; dateFormat: string; today: string }) {
  const [editing, setEditing] = useState<PaidRow | null>(null);
  const router = useRouter();
  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Person</Th>
            <Th>Course</Th>
            <Th>Dates</Th>
            <Th className="text-right">Cost</Th>
            <Th>Bond ends</Th>
            <Th>Status</Th>
            {canEdit && <Th className="text-right">Actions</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = STATUS[r.status] ?? STATUS.requested;
            return (
              <Tr key={r.id}>
                <Td className="text-foreground">{r.person}</Td>
                <Td>
                  {r.course_name}
                  <span className="block text-[12px] text-subtle-foreground">{[r.provider, r.location].filter(Boolean).join(" · ")}</span>
                </Td>
                <Td className="tabular">
                  {r.start_date ? `${formatDate(r.start_date, dateFormat)}${r.end_date && r.end_date !== r.start_date ? ` to ${formatDate(r.end_date, dateFormat)}` : ""}` : "—"}
                </Td>
                <Td className="text-right tabular">{formatMoney(r.cost, r.currency)}</Td>
                <Td className="tabular">
                  {r.bond_end_date ? (
                    <>
                      {formatDate(r.bond_end_date, dateFormat)}
                      {r.bond_end_date >= today && <span className="block text-[12px] text-subtle-foreground">Still in bond</span>}
                    </>
                  ) : (
                    "—"
                  )}
                </Td>
                <Td>
                  <StatusDot tone={s.tone}>{s.label}</StatusDot>
                </Td>
                {canEdit && (
                  <Td className="text-right">
                    {r.status === "requested" ? (
                      <span className="text-[12px] text-subtle-foreground">Decide in Requests</span>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                    )}
                  </Td>
                )}
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `${editing.course_name} for ${editing.person}` : ""}>
        {editing && <PaidForm people={people} row={editing} onDone={() => (setEditing(null), router.refresh())} />}
      </Modal>
    </>
  );
}
