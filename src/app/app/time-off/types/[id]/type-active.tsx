"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { setLeaveTypeActive } from "@/lib/leave/setup-actions";

/** Switches a type off (or back on). Types aren't deleted, so past time off keeps its type. */
export function TypeActiveButton({ id, isActive }: { id: string; isActive: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const go = async () => {
    const r = await setLeaveTypeActive(id, !isActive);
    setOpen(false);
    if (r.error) return void toast.error(r.error);
    toast.success(r.message ?? "Saved.");
    router.refresh();
  };
  if (!isActive)
    return (
      <Button variant="secondary" onClick={go}>
        Switch back on
      </Button>
    );
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Switch off
      </Button>
      <ConfirmDialog open={open} title="Switch this type off?" confirmLabel="Switch off" onCancel={() => setOpen(false)} onConfirm={go}>
        Nobody will be able to ask for it. Time off already taken or approved stays, and you can switch it back on later.
      </ConfirmDialog>
    </>
  );
}
