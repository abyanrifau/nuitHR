"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus } from "lucide-react";
import { ActionForm, SelectField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { clearFlag, saveAttendanceRecord } from "@/lib/time/actions";

type Opt = { value: string; label: string };

export function FlagButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      title="Mark as checked"
      aria-label="Mark as checked"
      onClick={() =>
        start(async () => {
          const r = await clearFlag(id);
          if (r.error) toast.error(r.error);
          else router.refresh();
        })
      }
    >
      <Check className="size-3.5" aria-hidden />
    </Button>
  );
}

const STATUSES = [
  { value: "auto", label: "Worked (use the times)" },
  { value: "absent", label: "Absent" },
  { value: "on_leave", label: "On leave" },
  { value: "holiday", label: "Public holiday" },
  { value: "rest_day", label: "Rest day" },
];

/** Add or fix one person's day. Late, overtime and hours are worked out from the times. */
export function DayRecordButton({
  employee,
  day,
  shifts,
  record,
}: {
  employee: { id: string; name: string };
  day: string;
  shifts: Opt[];
  record: { id: string; clock_in: string; clock_out: string; shift_id: string | null; status: string; notes: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(record?.status ?? "auto");
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" size="sm" aria-label={record ? `Fix ${employee.name}'s day` : `Add a day for ${employee.name}`} onClick={() => setOpen(true)}>
        {record ? <Pencil className="size-3.5" aria-hidden /> : <Plus className="size-3.5" aria-hidden />}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${employee.name}`} description="Times are in your company's time zone. A finish time before the start means after midnight.">
        <ActionForm
          action={saveAttendanceRecord}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        >
          {record && <input type="hidden" name="id" value={record.id} />}
          <input type="hidden" name="employee_id" value={employee.id} />
          <input type="hidden" name="work_date" value={day} />
          <SelectField name="status" label="What happened" options={STATUSES} value={status} onChange={(e) => setStatus(e.target.value)} />
          {status === "auto" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <TextField name="clock_in" label="Started" type="time" defaultValue={record?.clock_in ?? ""} />
                <TextField name="clock_out" label="Finished" type="time" defaultValue={record?.clock_out ?? ""} optional />
              </div>
              <SelectField name="shift_id" label="Shift" options={shifts} placeholder="No shift" defaultValue={record?.shift_id ?? ""} optional hint="Used to work out lateness and overtime." />
            </>
          )}
          <TextField name="notes" label="Note" defaultValue={record?.notes ?? ""} optional />
        </ActionForm>
      </Modal>
    </>
  );
}
