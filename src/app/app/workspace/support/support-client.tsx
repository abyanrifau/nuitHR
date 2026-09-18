"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionForm, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { createTicket, grantSupportAccess, revokeSupportAccess } from "@/lib/support/actions";

export function TicketForm() {
  return (
    <ActionForm action={createTicket} submitLabel="Send" pendingLabel="Sending…" resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <TextField name="subject" label="Subject" />
        <SelectField
          name="category"
          label="About"
          options={[
            { value: "question", label: "A question" },
            { value: "problem", label: "Something's not working" },
            { value: "billing", label: "Billing" },
            { value: "idea", label: "An idea" },
          ]}
          defaultValue="question"
        />
      </div>
      <TextareaField name="message" label="Message" rows={5} hint="If something's not working, tell us which page and what you clicked." />
    </ActionForm>
  );
}

export function SupportAccessPanel({ canEdit, grants }: { canEdit: boolean; grants: { id: string; until: string; reason: string | null }[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  if (grants.length > 0) {
    return (
      <ul className="space-y-3">
        {grants.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-warning/30 bg-warning-soft p-4">
            <p className="flex-1 text-sm">
              <span className="text-foreground">Support can see your company until {g.until}.</span>
              {g.reason && <span className="block text-muted-foreground">{g.reason}</span>}
            </p>
            {canEdit && (
              <Button
                variant="secondary"
                size="sm"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await revokeSupportAccess(g.id);
                    if (r.error) toast.error(r.error);
                    else {
                      toast.success("Support access ended.");
                      router.refresh();
                    }
                  })
                }
              >
                End now
              </Button>
            )}
          </li>
        ))}
      </ul>
    );
  }
  if (!canEdit) return <p className="text-sm text-subtle-foreground">Support can&apos;t see your company. Only the owner or an admin can change this.</p>;
  return (
    <ActionForm action={grantSupportAccess} submitLabel="Let support in" onSuccess={() => router.refresh()}>
      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <SelectField
          name="days"
          label="For"
          options={[
            { value: "1", label: "1 day" },
            { value: "3", label: "3 days" },
            { value: "7", label: "7 days" },
          ]}
          defaultValue="1"
        />
        <TextField name="reason" label="Why" placeholder="For example help with payroll setup" optional />
      </div>
    </ActionForm>
  );
}
