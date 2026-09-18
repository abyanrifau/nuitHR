"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelChecklist } from "@/lib/joiners/actions";

export function CancelChecklistButton({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Cancel checklist
      </Button>
      <ConfirmDialog
        open={open}
        title="Cancel this checklist?"
        confirmLabel="Cancel checklist"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          const r = await cancelChecklist(id);
          setOpen(false);
          if (r.error) return void toast.error(r.error);
          toast.success(r.message ?? "Cancelled.");
          router.refresh();
        }}
      >
        For example if they didn&apos;t start after all. Nobody gets any more reminders about it.
      </ConfirmDialog>
    </>
  );
}
