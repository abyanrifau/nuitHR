"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { ActionForm, CheckboxField, SelectField, TextField, TextareaField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Modal } from "@/components/ui/modal";
import { deleteCompanyEvent, deleteHoliday, saveCompanyEvent, saveHoliday } from "@/lib/leave/setup-actions";
import type { ActionResult } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };

export interface CalendarEvent {
  id: string;
  title: string;
  kind: "event" | "blackout";
  start_date: string;
  end_date: string;
  branch_id: string | null;
  leave_type_ids: string[] | null;
  notes: string | null;
}

export interface CalendarHoliday {
  id: string;
  name: string;
  holiday_date: string;
  branch_id: string | null;
  is_optional: boolean;
}

type Kind = "event" | "blackout" | "holiday";

const KINDS = [
  { value: "event", label: "Company event" },
  { value: "blackout", label: "Blackout dates (no time off)" },
  { value: "holiday", label: "Public holiday" },
];

function EventFields({ kind, event, date, branches, types }: { kind: "event" | "blackout"; event?: CalendarEvent; date?: string; branches: Opt[]; types: Opt[] }) {
  const chosen = new Set(event?.leave_type_ids ?? []);
  return (
    <>
      <input type="hidden" name="kind" value={kind} />
      <TextField name="title" label="Title" defaultValue={event?.title} placeholder={kind === "blackout" ? "For example stock take" : "For example staff party"} />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="start_date" label="First day" type="date" defaultValue={event?.start_date ?? date} />
        <TextField name="end_date" label="Last day" type="date" defaultValue={event?.end_date ?? date} />
      </div>
      {branches.length > 0 ? (
        <SelectField name="branch_id" label="Where" options={[{ value: "", label: "Every location" }, ...branches]} defaultValue={event?.branch_id ?? ""} />
      ) : (
        <input type="hidden" name="branch_id" value="" />
      )}
      {kind === "blackout" && types.length > 0 && (
        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-[13px] text-muted-foreground">Types that can&apos;t be taken (none ticked means every type)</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {types.map((t) => (
              <label key={t.value} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="leave_type_ids" value={t.value} defaultChecked={chosen.has(t.value)} className="size-4 accent-[var(--color-accent)]" />
                {t.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <TextareaField name="notes" label="Notes" defaultValue={event?.notes ?? ""} optional rows={2} />
    </>
  );
}

function HolidayFields({ holiday, date, branches }: { holiday?: CalendarHoliday; date?: string; branches: Opt[] }) {
  return (
    <>
      <TextField name="name" label="Name" defaultValue={holiday?.name} placeholder="For example Independence Day" />
      <TextField name="holiday_date" label="Date" type="date" defaultValue={holiday?.holiday_date ?? date} />
      {branches.length > 0 ? (
        <SelectField name="branch_id" label="Where" options={[{ value: "", label: "Every location" }, ...branches]} defaultValue={holiday?.branch_id ?? ""} />
      ) : (
        <input type="hidden" name="branch_id" value="" />
      )}
      <CheckboxField name="is_optional" label="Optional holiday" hint="People still work unless they take it off." defaultChecked={holiday?.is_optional} />
    </>
  );
}

function DeleteLink({ onDelete }: { onDelete: () => Promise<ActionResult> }) {
  const [pending, start] = useTransition();
  const [sure, setSure] = useState(false);
  const router = useRouter();
  return (
    <Button
      type="button"
      variant={sure ? "danger" : "ghost"}
      loading={pending}
      onClick={() => {
        if (!sure) return setSure(true);
        start(async () => {
          const r = await onDelete();
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Deleted.");
          router.refresh();
        });
      }}
    >
      {sure ? "Yes, delete" : "Delete"}
    </Button>
  );
}

/** "+" on a day: add an event, blackout dates or a public holiday starting that day. */
export function AddEntryButton({ date, branches, types, label }: { date: string; branches: Opt[]; types: Opt[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("event");
  const router = useRouter();
  const done = () => {
    setOpen(false);
    router.refresh();
  };
  return (
    <>
      {label ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden /> {label}
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="grid size-5 place-items-center rounded text-subtle-foreground opacity-0 group-hover:opacity-100 hover:bg-accent-soft hover:text-foreground focus:opacity-100"
          aria-label={`Add to ${date}`}
        >
          <Plus className="size-3.5" aria-hidden />
        </button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add to the calendar">
        <Field label="What" htmlFor={`kind-${date}`} className="mb-4">
          <Select id={`kind-${date}`} options={KINDS} value={kind} onChange={(e) => setKind(e.target.value as Kind)} />
        </Field>
        {kind === "holiday" ? (
          <ActionForm key="holiday" action={saveHoliday.bind(null, null)} submitLabel="Add holiday" onSuccess={done}>
            <HolidayFields date={date} branches={branches} />
          </ActionForm>
        ) : (
          <ActionForm key={kind} action={saveCompanyEvent.bind(null, null)} submitLabel="Add" onSuccess={done}>
            <EventFields kind={kind} date={date} branches={branches} types={types} />
          </ActionForm>
        )}
      </Modal>
    </>
  );
}

/** An event or blackout on the calendar. Editors can open it to change or delete it. */
export function EventChip({ event, branches, types, canEdit }: { event: CalendarEvent; branches: Opt[]; types: Opt[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const cls = cn(
    "block w-full truncate rounded px-1.5 py-0.5 text-left text-[11px]",
    event.kind === "blackout" ? "bg-danger-soft text-danger" : "bg-accent-soft text-foreground",
  );
  const title = `${event.kind === "blackout" ? "No time off: " : ""}${event.title}${event.notes ? ` · ${event.notes}` : ""}`;
  if (!canEdit)
    return (
      <span className={cls} title={title}>
        {event.title}
      </span>
    );
  return (
    <>
      <button type="button" className={cls} title={title} onClick={() => setOpen(true)}>
        {event.title}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={event.kind === "blackout" ? "Blackout dates" : "Company event"}>
        <ActionForm
          action={saveCompanyEvent.bind(null, event.id)}
          submitLabel="Save"
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
          footer={<DeleteLink onDelete={() => deleteCompanyEvent(event.id)} />}
        >
          <EventFields kind={event.kind} event={event} branches={branches} types={types} />
        </ActionForm>
      </Modal>
    </>
  );
}

export function HolidayChip({ holiday, branches, canEdit }: { holiday: CalendarHoliday; branches: Opt[]; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const cls = "block w-full truncate text-left text-[11px] text-info";
  if (!canEdit)
    return (
      <span className={cls} title={holiday.name}>
        {holiday.name}
      </span>
    );
  return (
    <>
      <button type="button" className={cls} title={holiday.name} onClick={() => setOpen(true)}>
        {holiday.name}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Public holiday">
        <ActionForm
          action={saveHoliday.bind(null, holiday.id)}
          submitLabel="Save"
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
          footer={<DeleteLink onDelete={() => deleteHoliday(holiday.id)} />}
        >
          <HolidayFields holiday={holiday} branches={branches} />
        </ActionForm>
      </Modal>
    </>
  );
}
