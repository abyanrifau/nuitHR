"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { deleteAccount } from "@/lib/platform/actions";

/** Deletes one login, after the admin types the email and a reason. */
export function DeleteAccountButton({ id, email }: { id: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Delete ${email}`}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This removes the sign-in for good. They lose access to every company they belong to. If they are the only owner of a company, delete that company first.
          </p>
          <Field label="Type the email to confirm" htmlFor="del-email">
            <Input id="del-email" value={confirmEmail} onChange={(e) => setConfirmEmail(e.target.value)} placeholder={email} autoComplete="off" />
          </Field>
          <Field label="Reason" htmlFor="del-reason" hint="Saved in the admin log.">
            <Input id="del-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example Test account" />
          </Field>
          <Button
            variant="danger"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await deleteAccount({ userId: id, confirmEmail, reason });
                if (r.error) return void toast.error(r.error);
                toast.success(r.message ?? "Deleted.");
                setOpen(false);
                router.refresh();
              })
            }
          >
            Delete this login
          </Button>
        </div>
      </Modal>
    </>
  );
}
