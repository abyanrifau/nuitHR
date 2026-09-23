"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { ActionForm, SelectField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { deleteGrant, grantLeave } from "@/lib/leave/setup-actions";

type Opt = { value: string; label: string };

export function GrantButton({ people, types, today }: { people: Opt[]; types: Opt[]; today: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!types.length}>
        <Plus className="size-4" aria-hidden /> Give days
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Give days to someone" description="They can ask for these days from the start date until they expire. The reason is kept in the history.">
        <ActionForm
          action={grantLeave}
          submitLabel="Give days"
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        >
          <SelectField name="employee_id" label="Person" options={people} placeholder="Choose a person" />
          <SelectField name="leave_type_id" label="Type" options={types} />
          <TextField name="days" label="Days" type="number" min={0.5} step="0.5" />
          <TextField name="reason" label="Reason" placeholder="For example family bereavement" />
          <div className="grid grid-cols-2 gap-3">
            <TextField name="starts_on" label="Usable from" type="date" defaultValue={today} />
            <TextField name="expires_on" label="Expires" type="date" optional />
          </div>
        </ActionForm>
      </Modal>
    </>
  );
}

export function DeleteGrantButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <ConfirmDialog
        open={open}
        title="Remove these days?"
        confirmLabel="Remove"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const r = await deleteGrant(id);
          setOpen(false);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Removed.");
          router.refresh();
        }}
      >
        They won&apos;t be able to ask for them any more. Time off already asked for stays.
      </ConfirmDialog>
    </>
  );
}
