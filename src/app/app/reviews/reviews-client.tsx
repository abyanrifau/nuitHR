"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { ActionForm, SelectField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { closeCycle, deleteCycle, openCycle, saveCycle, shareReview } from "@/lib/reviews/actions";
import type { ActionResult } from "@/lib/errors";

type Opt = { value: string; label: string };

const PERIODS = [
  { value: "annual", label: "Yearly" },
  { value: "half_yearly", label: "Every six months" },
  { value: "quarterly", label: "Every three months" },
  { value: "custom", label: "Other" },
];

export function NewRoundButton({ templates, departments }: { templates: Opt[]; departments: Opt[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const year = new Date().getFullYear();
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New review round
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New review round" description="Nothing is sent until you open the round.">
        <ActionForm
          action={saveCycle.bind(null, null)}
          submitLabel="Create round"
          onSuccess={(s: ActionResult & { id?: string }) => {
            setOpen(false);
            if (s.id) router.push(`/app/reviews/${s.id}`);
          }}
        >
          <TextField name="name" label="Name" defaultValue={`${year} review`} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField name="period_type" label="How often" options={PERIODS} defaultValue="annual" />
            <SelectField name="template_id" label="Questions" options={templates} defaultValue={templates[0]?.value} />
            <TextField name="period_start" label="Period starts" type="date" defaultValue={`${year}-01-01`} />
            <TextField name="period_end" label="Period ends" type="date" defaultValue={`${year}-12-31`} />
            <TextField name="self_review_due" label="Self reviews due" type="date" optional />
            <TextField name="manager_review_due" label="Manager reviews due" type="date" optional />
          </div>
          {departments.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-sm text-foreground">Who&apos;s in it</legend>
              <p className="mb-2 text-[12px] text-subtle-foreground">Leave all unticked to include everyone.</p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {departments.map((d) => (
                  <label key={d.value} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="department_ids" value={d.value} className="size-4 accent-[var(--color-accent)]" /> {d.label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </ActionForm>
      </Modal>
    </>
  );
}

export function RoundButtons({ id, status }: { id: string; status: string }) {
  const [confirm, setConfirm] = useState<"open" | "close" | "delete" | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setConfirm(null);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Done.");
      if (after) after();
      else router.refresh();
    });
  return (
    <>
      {status === "draft" && (
        <>
          <Button variant="ghost" disabled={pending} onClick={() => setConfirm("delete")}>
            Delete
          </Button>
          <Button loading={pending} onClick={() => setConfirm("open")}>
            Open round
          </Button>
        </>
      )}
      {status === "open" && (
        <>
          <Button variant="secondary" loading={pending} onClick={() => run(() => openCycle(id))} title="Adds anyone who joined since the round opened">
            Add new joiners
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => setConfirm("close")}>
            Close round
          </Button>
        </>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "open" ? "Open this round?" : confirm === "close" ? "Close this round?" : "Delete this round?"}
        confirmLabel={confirm === "open" ? "Open" : confirm === "close" ? "Close" : "Delete"}
        onCancel={() => setConfirm(null)}
        onConfirm={async () =>
          confirm === "open" ? run(() => openCycle(id)) : confirm === "close" ? run(() => closeCycle(id)) : run(() => deleteCycle(id), () => router.push("/app/reviews"))
        }
      >
        {confirm === "open"
          ? "Everyone in it is told to fill in their self review."
          : confirm === "close"
            ? "Reviews that aren't finished stay as they are and can't be changed."
            : "Nobody has been asked yet, so nothing is lost."}
      </ConfirmDialog>
    </>
  );
}

export function ShareButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await shareReview(id);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Shared.");
          router.refresh();
        })
      }
    >
      Share with them
    </Button>
  );
}
