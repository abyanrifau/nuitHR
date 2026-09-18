"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm, TextareaField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { requestPaidTraining } from "@/lib/training/actions";

export function PaidTrainingForm({ currency }: { currency: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Ask for paid training
      </Button>
    );
  }
  return (
    <div className="rounded-xl border border-border p-4">
      <ActionForm
        action={requestPaidTraining}
        submitLabel="Send for approval"
        onSuccess={() => {
          setOpen(false);
          router.refresh();
        }}
        footer={
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        }
      >
        <TextField name="course_name" label="Course" placeholder="For example Barista level 2" />
        <TextField name="provider" label="Run by" placeholder="For example Maldives Hospitality School" />
        <TextField name="location" label="Where" optional />
        <div className="grid grid-cols-2 gap-4">
          <TextField name="start_date" label="Starts" type="date" optional />
          <TextField name="end_date" label="Ends" type="date" optional />
        </div>
        <TextField name="cost" label={`Cost (${currency})`} type="number" min={0} step="0.01" inputMode="decimal" />
        <TextareaField name="notes" label="Why it would help" optional />
      </ActionForm>
    </div>
  );
}
