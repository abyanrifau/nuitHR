"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import { ActionForm, SelectField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  adjustBalance,
  cancelApprovedLeave,
  decideLeave,
  extendLeaveDocument,
  leaveDocumentLink,
  recordLeave,
  startLeaveYear,
  waiveLeaveDocument,
} from "@/lib/leave/actions";

type Opt = { value: string; label: string };

const HALVES = [
  { value: "full", label: "Full day" },
  { value: "first_half", label: "Morning only" },
  { value: "second_half", label: "Afternoon only" },
];

export function DecideLeaveButtons({ id }: { id: string }) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [decided, setDecided] = useOptimistic<"approve" | "reject" | null>(null);
  const router = useRouter();
  const go = (decision: "approve" | "reject") =>
    start(async () => {
      setDecided(decision);
      setDeclining(false);
      const r = await decideLeave(id, decision, decision === "reject" ? note : undefined);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Done.");
      setDeclining(false);
      router.refresh();
    });
  if (decided) return <span className="text-[13px] text-muted-foreground">{decided === "approve" ? "Approved" : "Declined"}</span>;
  return (
    <>
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => go("approve")}>
        <Check className="size-3.5" aria-hidden /> Approve
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDeclining(true)}>
        <X className="size-3.5" aria-hidden /> Decline
      </Button>
      <Modal open={declining} onClose={() => setDeclining(false)} title="Decline time off" description="They'll see your note.">
        <div className="space-y-4">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder="For example two people are already off that week" />
          <Button variant="danger" loading={pending} onClick={() => (note.trim() ? go("reject") : toast.error("Add a short note so they know why."))}>
            Decline
          </Button>
        </div>
      </Modal>
    </>
  );
}

export function CancelLeaveButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Cancel
      </Button>
      <ConfirmDialog
        open={open}
        title="Cancel approved time off?"
        confirmLabel="Cancel time off"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const r = await cancelApprovedLeave(id, reason);
          if (r.error) return void toast.error(r.error);
          setOpen(false);
          toast.success(r.message ?? "Cancelled.");
          router.refresh();
        }}
      >
        <p className="mb-2">The days go back into their balance.</p>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" placeholder="Reason, for example came back early" />
      </ConfirmDialog>
    </>
  );
}

export function RecordLeaveButton({ people, types }: { people: Opt[]; types: Opt[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> Enter time off
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Enter time off" description="For someone who told you in person or by phone. It's approved straight away and comes off their balance.">
        <ActionForm
          action={recordLeave}
          submitLabel="Enter time off"
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        >
          <SelectField name="employee_id" label="Person" options={people} placeholder="Choose a person" />
          <SelectField name="leave_type_id" label="Type" options={types} />
          <div className="grid grid-cols-2 gap-3">
            <TextField name="start_date" label="First day" type="date" />
            <TextField name="end_date" label="Last day" type="date" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SelectField name="start_half" label="First day" options={HALVES} defaultValue="full" />
            <SelectField name="end_half" label="Last day" options={HALVES} defaultValue="full" />
          </div>
          <TextField name="reason" label="Note" optional />
        </ActionForm>
      </Modal>
    </>
  );
}

export function AdjustButton({ people, types, year }: { people: Opt[]; types: Opt[]; year: number }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Change a balance
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Change a balance" description="Add days (for example for working a holiday) or take them away. Every change is kept with its reason.">
        <ActionForm
          action={adjustBalance}
          submitLabel="Save"
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        >
          <input type="hidden" name="period_year" value={year} />
          <SelectField name="employee_id" label="Person" options={people} placeholder="Choose a person" />
          <SelectField name="leave_type_id" label="Type" options={types} />
          <TextField name="days" label="Days" type="number" step="0.5" hint="Use a minus to take days away, for example -1." />
          <TextField name="reason" label="Reason" />
        </ActionForm>
      </Modal>
    </>
  );
}

export function StartYearButton({ year }: { year: number }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Set up {year}
      </Button>
      <ConfirmDialog
        open={open}
        tone="primary"
        title={`Set up ${year}?`}
        confirmLabel={`Set up ${year}`}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const r = await startLeaveYear(year);
          setOpen(false);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Done.");
          router.refresh();
        }}
      >
        Gives everyone their full days for {year}. Nothing is carried over from {year - 1}. Balances that already exist stay as they are. Safe to run again.
      </ConfirmDialog>
    </>
  );
}

/** Open the document, or (HR) give more time or waive it. Both need a reason, which is kept in the history. */
export function DocumentActions({ id, path, canDecide, today }: { id: string; path: string | null; canDecide: boolean; today: string }) {
  const [mode, setMode] = useState<"extend" | "waive" | null>(null);
  const [due, setDue] = useState(today);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const open = () =>
    start(async () => {
      const r = await leaveDocumentLink(path!);
      if (r.error) return void toast.error(r.error);
      window.open(r.url, "_blank", "noopener");
    });
  const save = () =>
    start(async () => {
      if (!reason.trim()) return void toast.error("Add a short reason. It's kept in the history.");
      const r = mode === "extend" ? await extendLeaveDocument(id, due, reason) : await waiveLeaveDocument(id, reason);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Saved.");
      setMode(null);
      setReason("");
      router.refresh();
    });
  return (
    <>
      {path && (
        <Button variant="ghost" size="sm" disabled={pending} onClick={open}>
          Open
        </Button>
      )}
      {canDecide && (
        <>
          <Button variant="ghost" size="sm" onClick={() => setMode("extend")}>
            More time
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setMode("waive")}>
            Waive
          </Button>
        </>
      )}
      <Modal
        open={mode !== null}
        onClose={() => setMode(null)}
        title={mode === "extend" ? "Give more time for the document" : "Waive the document"}
        description={
          mode === "extend"
            ? "If the days had already become absences, the time off is put back until the new deadline."
            : "The time off stands without a document. If the days had become absences, they're put back as time off."
        }
      >
        <div className="space-y-4">
          {mode === "extend" && (
            <Field label="New deadline" htmlFor={`due-${id}`}>
              <Input id={`due-${id}`} type="date" min={today} value={due} onChange={(e) => setDue(e.target.value)} />
            </Field>
          )}
          <Field label="Reason" htmlFor={`why-${id}`}>
            <Textarea id={`why-${id}`} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example clinic was closed" />
          </Field>
          <Button loading={pending} onClick={save}>
            {mode === "extend" ? "Save new deadline" : "Waive document"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
