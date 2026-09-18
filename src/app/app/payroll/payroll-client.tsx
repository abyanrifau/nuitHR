"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { ActionForm, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { createRun } from "@/lib/payroll/actions";
import type { ActionResult } from "@/lib/errors";

export function NewRunButton({ suggestion }: { suggestion: { start: string; end: string; pay: string } }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> New pay run
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New pay run" description="Nothing is final until you finalize it. You can recalculate as often as you like.">
        <ActionForm
          action={createRun}
          submitLabel="Create and calculate"
          pendingLabel="Calculating…"
          onSuccess={(s: ActionResult & { id?: string }) => {
            setOpen(false);
            if (s.id) router.push(`/app/payroll/${s.id}`);
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <TextField name="start" label="Period starts" type="date" defaultValue={suggestion.start} />
            <TextField name="end" label="Period ends" type="date" defaultValue={suggestion.end} />
          </div>
          <TextField name="pay_date" label="Pay day" type="date" defaultValue={suggestion.pay} />
          <TextField name="name" label="Name" placeholder="For example September 2026 payroll" optional />
        </ActionForm>
      </Modal>
    </>
  );
}
