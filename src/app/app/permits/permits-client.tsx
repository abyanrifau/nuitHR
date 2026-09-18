"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { ActionForm, SelectField, TextField, TextareaField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { archiveItem, renewItem, saveItem } from "@/lib/permits/actions";

type Opt = { value: string; label: string };
export interface PermitType {
  id: string;
  name: string;
  fields: { key: string; label: string; type?: string }[];
}
export interface PermitRow {
  id: string;
  employee_id: string;
  type_id: string;
  person: string;
  type: string;
  reference_no: string | null;
  issued_on: string | null;
  expires_on: string | null;
  issuing_authority: string | null;
  details: Record<string, string>;
  renewal_status: string;
  notes: string | null;
  is_archived: boolean;
}

const RENEWAL: Opt[] = [
  { value: "none", label: "Not started" },
  { value: "in_progress", label: "Renewal in progress" },
  { value: "not_renewing", label: "Not renewing" },
];

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function PermitForm({ types, people, row, onDone }: { types: PermitType[]; people: Opt[]; row?: PermitRow; onDone: () => void }) {
  const [typeId, setTypeId] = useState(row?.type_id ?? types[0]?.id ?? "");
  const type = types.find((t) => t.id === typeId);
  return (
    <ActionForm action={saveItem.bind(null, row?.id ?? null)} onSuccess={onDone}>
      <SelectField name="employee_id" label="Person" options={people} placeholder="Choose a person" defaultValue={row?.employee_id ?? ""} />
      <SelectField name="type_id" label="What it is" options={types.map((t) => ({ value: t.id, label: t.name }))} value={typeId} onChange={(e) => setTypeId(e.target.value)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="reference_no" label="Number" optional defaultValue={row?.reference_no ?? ""} />
        <TextField name="issuing_authority" label="Issued by" optional defaultValue={row?.issuing_authority ?? ""} />
        <TextField name="issued_on" label="Issued on" type="date" optional defaultValue={row?.issued_on ?? ""} />
        <TextField name="expires_on" label="Expires on" type="date" defaultValue={row?.expires_on ?? ""} />
        {type?.fields.map((f) => (
          <TextField key={`${typeId}-${f.key}`} name={`details.${f.key}`} label={f.label} optional type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} defaultValue={row?.details[f.key] ?? ""} />
        ))}
      </div>
      {row && <SelectField name="renewal_status" label="Renewal" options={RENEWAL} defaultValue={row.renewal_status === "renewed" ? "none" : row.renewal_status} />}
      <TextareaField name="notes" label="Notes" optional defaultValue={row?.notes ?? ""} />
    </ActionForm>
  );
}

export function AddPermitButton({ types, people }: { types: PermitType[]; people: Opt[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> Add
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a permit or document">
        <PermitForm types={types} people={people} onDone={() => (setOpen(false), router.refresh())} />
      </Modal>
    </>
  );
}

export function PermitsTable({ rows, types, people, today, dateFormat, canEdit }: { rows: PermitRow[]; types: PermitType[]; people: Opt[]; today: string; dateFormat: string; canEdit: boolean }) {
  const [editing, setEditing] = useState<PermitRow | null>(null);
  const [renewing, setRenewing] = useState<PermitRow | null>(null);
  const [archiving, setArchiving] = useState<PermitRow | null>(null);
  const [expiry, setExpiry] = useState("");
  const [ref, setRef] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <>
      <Table>
        <thead>
          <tr>
            <Th>Person</Th>
            <Th>What</Th>
            <Th>Number</Th>
            <Th>Expires</Th>
            <Th>Status</Th>
            {canEdit && <Th className="text-right">Actions</Th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const left = r.expires_on ? daysBetween(today, r.expires_on) : null;
            const tone = left === null ? "neutral" : left < 0 ? "danger" : left <= 30 ? "warning" : left <= 90 ? "info" : "success";
            const label = r.is_archived ? (r.renewal_status === "renewed" ? "Renewed" : "Archived") : left === null ? "No expiry" : left < 0 ? `Expired ${-left} days ago` : left === 0 ? "Expires today" : `${left} days left`;
            return (
              <Tr key={r.id}>
                <Td className="text-foreground">{r.person}</Td>
                <Td>{r.type}</Td>
                <Td className="tabular">{r.reference_no ?? r.details.permit_no ?? "—"}</Td>
                <Td className="tabular">{formatDate(r.expires_on, dateFormat)}</Td>
                <Td>
                  <StatusDot tone={r.is_archived ? "neutral" : tone}>{label}</StatusDot>
                  {r.renewal_status === "in_progress" && !r.is_archived && <span className="block text-[12px] text-subtle-foreground">Renewal in progress</span>}
                  {r.renewal_status === "not_renewing" && !r.is_archived && <span className="block text-[12px] text-subtle-foreground">Not renewing</span>}
                </Td>
                {canEdit && (
                  <Td className="text-right whitespace-nowrap">
                    <Button variant="secondary" size="sm" onClick={() => (setRenewing(r), setExpiry(""), setRef(""))}>
                      Renewed
                    </Button>{" "}
                    <Button variant="ghost" size="sm" onClick={() => setEditing(r)}>
                      Edit
                    </Button>{" "}
                    <Button variant="ghost" size="sm" onClick={() => setArchiving(r)}>
                      Archive
                    </Button>
                  </Td>
                )}
              </Tr>
            );
          })}
        </tbody>
      </Table>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `${editing.type} for ${editing.person}` : ""}>
        {editing && <PermitForm types={types} people={people} row={editing} onDone={() => (setEditing(null), router.refresh())} />}
      </Modal>

      <Modal open={Boolean(renewing)} onClose={() => setRenewing(null)} title="Record the renewal" description="The old one moves to history and reminders start again for the new date.">
        <div className="space-y-4">
          <Field label="New expiry date" htmlFor="rn-exp">
            <Input id="rn-exp" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Field>
          <Field label="New number" htmlFor="rn-ref" optional hint="Leave empty if it stayed the same.">
            <Input id="rn-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
          <Button
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await renewItem(renewing!.id, expiry, ref);
                if (r.error) return void toast.error(r.error);
                toast.success(r.message ?? "Renewed.");
                setRenewing(null);
                router.refresh();
              })
            }
          >
            Save renewal
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(archiving)}
        title="Move to history?"
        confirmLabel="Archive"
        onCancel={() => setArchiving(null)}
        onConfirm={async () => {
          const r = await archiveItem(archiving!.id);
          setArchiving(null);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Archived.");
          router.refresh();
        }}
      >
        For example when the person has left. No more reminders will be sent for it.
      </ConfirmDialog>
    </>
  );
}
