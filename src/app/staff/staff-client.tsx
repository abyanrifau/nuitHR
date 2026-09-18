"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { ActionForm, CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { askForLetter, deleteMyEmergencyContact, myFileLink, saveMyEmergencyContact, updateMyContact } from "@/lib/staff/actions";

type Opt = { value: string; label: string };

export function AskLetterForm({ templates }: { templates: Opt[] }) {
  const router = useRouter();
  return (
    <ActionForm action={askForLetter} submitLabel="Send request" pendingLabel="Sending…" resetOnSuccess onSuccess={() => router.refresh()}>
      <SelectField name="template_id" label="Which letter" options={templates} placeholder="Choose a letter" />
      <TextField name="purpose" label="What it's for" placeholder="For example a bank loan application" />
      <TextField name="addressed_to" label="Addressed to" placeholder="For example The Manager, Bank of Maldives" optional />
    </ActionForm>
  );
}

/** Opens one of my files in a new tab using a short-lived private link. */
export function OpenFileButton({ path, label }: { path: string; label: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await myFileLink(path);
          if (r.url) window.open(r.url, "_blank", "noopener");
          else toast.error(r.error ?? "Couldn't open the file.");
        })
      }
    >
      {label}
    </Button>
  );
}

export function MyContactForm({ values }: { values: { phone: string; personal_email: string; current_address: string; permanent_address: string } }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <div className="space-y-3">
        <dl className="space-y-3 text-sm">
          {[
            ["Phone", values.phone],
            ["Personal email", values.personal_email],
            ["Current address", values.current_address],
            ["Home address", values.permanent_address],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[13px] text-muted-foreground">{k}</dt>
              <dd className={v ? "text-foreground" : "text-subtle-foreground"}>{v || "Not added"}</dd>
            </div>
          ))}
        </dl>
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          <Pencil className="size-3.5" aria-hidden /> Edit
        </Button>
      </div>
    );
  }
  return (
    <ActionForm
      action={updateMyContact}
      onSuccess={() => setEditing(false)}
      footer={
        <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      }
    >
      <TextField name="phone" label="Phone" type="tel" inputMode="tel" defaultValue={values.phone} autoComplete="tel" />
      <TextField name="personal_email" label="Personal email" type="email" defaultValue={values.personal_email} autoComplete="email" optional />
      <TextareaField name="current_address" label="Current address" defaultValue={values.current_address} optional />
      <TextareaField name="permanent_address" label="Home address" defaultValue={values.permanent_address} optional />
    </ActionForm>
  );
}

interface Contact {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  is_primary: boolean;
}

export function MyEmergencyContacts({ contacts }: { contacts: Contact[] }) {
  const [editing, setEditing] = useState<Contact | "new" | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const router = useRouter();
  const current = editing === "new" ? null : editing;

  return (
    <div className="space-y-3">
      {contacts.length > 0 && !editing && (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-foreground">
                  {c.name} {c.is_primary && <Badge className="ml-1">First to call</Badge>}
                </p>
                <p className="text-[13px] text-subtle-foreground">{[c.relationship, c.phone].filter(Boolean).join(" · ")}</p>
              </div>
              <Button variant="ghost" size="sm" aria-label={`Edit ${c.name}`} className="size-11 p-0" onClick={() => setEditing(c)}>
                <Pencil className="size-4" aria-hidden />
              </Button>
              <Button variant="ghost" size="sm" aria-label={`Remove ${c.name}`} className="size-11 p-0" onClick={() => setRemoving(c)}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ActionForm
          key={current?.id ?? "new"}
          action={saveMyEmergencyContact}
          onSuccess={() => setEditing(null)}
          footer={
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          }
        >
          {current && <input type="hidden" name="id" value={current.id} />}
          <TextField name="name" label="Name" defaultValue={current?.name} autoFocus />
          <TextField name="relationship" label="Relationship" placeholder="For example mother" defaultValue={current?.relationship ?? ""} optional />
          <TextField name="phone" label="Phone" type="tel" inputMode="tel" defaultValue={current?.phone ?? ""} />
          <CheckboxField name="is_primary" label="Call this person first" defaultChecked={current?.is_primary ?? contacts.length === 0} />
        </ActionForm>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setEditing("new")}>
          Add emergency contact
        </Button>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name}?`}
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await deleteMyEmergencyContact(removing!.id);
          setRemoving(null);
          if (r.error) toast.error(r.error);
          else {
            toast.success("Contact removed.");
            router.refresh();
          }
        }}
      />
    </div>
  );
}
