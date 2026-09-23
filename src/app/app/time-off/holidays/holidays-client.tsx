"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { ActionForm, CheckboxField, SelectField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { deleteHoliday, loadMaldivesHolidays, saveHoliday } from "@/lib/leave/setup-actions";

type Opt = { value: string; label: string };
type Holiday = { id: string; name: string; holiday_date: string; branch_id: string | null; is_optional: boolean };

/** Adds a holiday, or edits one when given. */
export function HolidayButton({ branches, holiday, defaultDate }: { branches: Opt[]; holiday?: Holiday; defaultDate?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      {holiday ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
          Edit
        </Button>
      ) : (
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> Add a holiday
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title={holiday ? "Edit holiday" : "Add a holiday"}>
        <ActionForm
          action={saveHoliday.bind(null, holiday?.id ?? null)}
          submitLabel={holiday ? "Save" : "Add holiday"}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        >
          <TextField name="name" label="Name" defaultValue={holiday?.name} placeholder="For example Independence Day" />
          <TextField name="holiday_date" label="Date" type="date" defaultValue={holiday?.holiday_date ?? defaultDate} />
          {branches.length > 0 ? (
            <SelectField name="branch_id" label="Where" options={[{ value: "", label: "Every location" }, ...branches]} defaultValue={holiday?.branch_id ?? ""} />
          ) : (
            <input type="hidden" name="branch_id" value="" />
          )}
          <CheckboxField name="is_optional" label="Optional holiday" hint="People still work unless they take it off." defaultChecked={holiday?.is_optional} />
        </ActionForm>
      </Modal>
    </>
  );
}

export function DeleteHolidayButton({ id, name }: { id: string; name: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        title={`Delete ${name}?`}
        confirmLabel="Delete"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const r = await deleteHoliday(id);
          setOpen(false);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Deleted.");
          router.refresh();
        }}
      >
        It becomes a normal working day again. Months with finalized payroll don&apos;t change.
      </ConfirmDialog>
    </>
  );
}

export function LoadHolidaysButton({ year }: { year: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await loadMaldivesHolidays(year);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Done.");
          router.refresh();
        })
      }
    >
      Load Maldives holidays for {year}
    </Button>
  );
}
