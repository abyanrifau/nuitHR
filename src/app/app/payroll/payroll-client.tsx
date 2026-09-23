"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { ActionForm, SelectField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { createRun } from "@/lib/payroll/actions";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

export interface ScheduleOption {
  id: string;
  name: string;
  frequency: string;
  suggestion: { start: string; end: string; pay: string };
}

const FREQ: Record<string, string> = { monthly: "monthly", semi_monthly: "twice a month", biweekly: "every two weeks", weekly: "weekly" };

export function NewRunButton({ schedules, adhocSuggestion }: { schedules: ScheduleOption[]; adhocSuggestion: { start: string; end: string; pay: string } }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"regular" | "adhoc">("regular");
  const [schedule, setSchedule] = useState(schedules[0]?.id ?? "");
  const router = useRouter();
  const sug = type === "adhoc" ? adhocSuggestion : (schedules.find((s) => s.id === schedule)?.suggestion ?? adhocSuggestion);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New pay run
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New pay run" description="Nothing is final until you approve and finalize it. You can calculate again as often as you like before that.">
        <div className="mb-5 flex flex-wrap gap-2 text-sm">
          {(
            [
              ["regular", "Regular pay"],
              ["adhoc", "Ad-hoc (bonus or one-off)"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5", type === k ? "border-foreground" : "border-border text-muted-foreground")}>
              <input type="radio" name="run-type" checked={type === k} onChange={() => setType(k)} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
        <ActionForm
          key={`${type}-${schedule}`}
          action={createRun}
          submitLabel={type === "adhoc" ? "Create ad-hoc run" : "Create and calculate"}
          pendingLabel="Working it out…"
          onSuccess={(s: ActionResult & { id?: string }) => {
            setOpen(false);
            if (s.id) router.push(`/app/payroll/${s.id}`);
          }}
        >
          <input type="hidden" name="run_type" value={type} />
          {type === "regular" && schedules.length > 0 && (
            <SelectField
              name="schedule"
              label="Pay schedule"
              options={schedules.map((s) => ({ value: s.id, label: `${s.name} (${FREQ[s.frequency] ?? s.frequency})` }))}
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              hint="Only the people on this schedule are in the run."
            />
          )}
          {type === "adhoc" && (
            <p className="text-sm text-muted-foreground">
              An ad-hoc run pays only the amounts you add to each person, such as a bonus. Salaries, allowances and deductions aren&apos;t included. Pension and tax
              are worked out on what you add, if it counts for them.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <TextField name="start" label="Period starts" type="date" defaultValue={sug.start} />
            <TextField name="end" label="Period ends" type="date" defaultValue={sug.end} />
          </div>
          <TextField name="pay_date" label="Pay day" type="date" defaultValue={sug.pay} />
          <TextField name="name" label="Name" placeholder={type === "adhoc" ? "For example Eid bonus 2026" : "For example September 2026 payroll"} optional />
        </ActionForm>
      </Modal>
    </>
  );
}
