"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, ExternalLink, Pencil, Trash2, Upload } from "lucide-react";
import { ActionForm, CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DetailList, EmptyState } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getBrowserClient } from "@/lib/supabase/lazy-client";
import {
  addCompensation,
  changeStatus,
  deleteDocument,
  deleteEmergencyContact,
  fileLink,
  inviteLogin,
  recordDocument,
  saveBankAccount,
  saveEmergencyContact,
  saveProfileSection,
  type ProfileSection,
} from "@/lib/people/actions";
import { EXIT_REASONS, STATUSES, statusMeta } from "@/lib/people/constants";
import type { ActionResult } from "@/lib/errors";
import { today } from "@/lib/format";
import { ContactFields, EmploymentFields, IdFields, PersonalFields, type OrgOptions } from "../person-fields";

function SectionHeading({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-4 border-b border-border pb-3">
      <h2 className="text-lg">{title}</h2>
      {action}
    </div>
  );
}

/** Read-only details with an Edit button that swaps in the form. */
export function EditableSection({
  title,
  employeeId,
  section,
  values,
  canEdit,
  view,
  org,
}: {
  title: string;
  employeeId: string;
  section: ProfileSection;
  values: Record<string, unknown>;
  canEdit: boolean;
  view: ReactNode;
  org?: OrgOptions;
}) {
  const [editing, setEditing] = useState(false);
  const done = useCallback(() => setEditing(false), []);
  const action = useCallback((s: ActionResult, f: FormData) => saveProfileSection(employeeId, section, s, f), [employeeId, section]);
  const v = values as Record<string, string | boolean | null>;
  return (
    <section>
      <SectionHeading
        title={title}
        action={
          canEdit && !editing ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" aria-hidden /> Edit
            </Button>
          ) : null
        }
      />
      {editing ? (
        <ActionForm
          action={action}
          onSuccess={done}
          footer={
            <Button variant="ghost" type="button" onClick={done}>
              Cancel
            </Button>
          }
        >
          {section === "personal" && <PersonalFields values={v} />}
          {section === "contact" && <ContactFields values={v} />}
          {section === "employment" && org && <EmploymentFields values={v} org={org} />}
          {section === "id" && <IdFields values={v} />}
        </ActionForm>
      ) : (
        view
      )}
    </section>
  );
}

export function StatusPanel({
  employeeId,
  canEdit,
  status,
  exit,
  exitDateText,
}: {
  employeeId: string;
  canEdit: boolean;
  status: string;
  exit: { date: string | null; reason: string | null; notes: string | null };
  exitDateText: string;
}) {
  const [editing, setEditing] = useState(false);
  const [next, setNext] = useState(status);
  const action = useCallback((s: ActionResult, f: FormData) => changeStatus(employeeId, s, f), [employeeId]);
  const leaving = next === "resigned" || next === "terminated";
  const current = statusMeta(status);
  return (
    <section>
      <SectionHeading
        title="Status"
        action={
          canEdit && !editing ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Change status
            </Button>
          ) : null
        }
      />
      {editing ? (
        <ActionForm
          action={action}
          onSuccess={() => setEditing(false)}
          footer={
            <Button variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField name="status" label="Status" options={STATUSES.map((s) => ({ value: s.value, label: s.label }))} value={next} onChange={(e) => setNext(e.target.value)} />
            {leaving && (
              <>
                <TextField name="exit_date" label="Last working day" type="date" defaultValue={exit.date ?? ""} />
                <SelectField name="exit_reason" label="Reason" options={EXIT_REASONS} placeholder="Choose a reason" defaultValue={exit.reason ?? ""} />
                <TextareaField name="exit_notes" label="Notes" className="sm:col-span-2" defaultValue={exit.notes ?? ""} optional />
              </>
            )}
          </div>
          {leaving && <p className="text-[13px] text-muted-foreground">They keep their records. Their login stops working for this company from their last day once you disable it in the Login tab.</p>}
        </ActionForm>
      ) : (
        <DetailList
          items={[
            { label: "Status", value: <StatusDot tone={current.tone}>{current.label}</StatusDot> },
            ...(exit.date ? [{ label: "Last working day", value: exitDateText }, { label: "Reason", value: exit.reason }, { label: "Notes", value: exit.notes }] : []),
          ]}
        />
      )}
    </section>
  );
}

interface Contact {
  id: string;
  name: string;
  relationship: string | null;
  phone: string | null;
  alt_phone: string | null;
  address: string | null;
  is_primary: boolean;
}

export function EmergencyContactsPanel({ employeeId, contacts, canEdit }: { employeeId: string; contacts: Contact[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [removing, setRemoving] = useState<Contact | null>(null);
  const router = useRouter();
  const action = useCallback((s: ActionResult, f: FormData) => saveEmergencyContact(employeeId, s, f), [employeeId]);
  const editingContact = contacts.find((c) => c.id === editing);

  return (
    <section>
      <SectionHeading
        title="Emergency contacts"
        action={
          canEdit && !editing ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing("new")}>
              Add contact
            </Button>
          ) : null
        }
      />
      {editing ? (
        <ActionForm
          action={action}
          onSuccess={() => setEditing(null)}
          footer={
            <Button variant="ghost" type="button" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          }
        >
          {editingContact && <input type="hidden" name="id" value={editingContact.id} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="name" label="Name" defaultValue={editingContact?.name} />
            <TextField name="relationship" label="Relationship" hint="For example mother, spouse." defaultValue={editingContact?.relationship ?? ""} optional />
            <TextField name="phone" label="Phone" type="tel" defaultValue={editingContact?.phone ?? ""} optional />
            <TextField name="alt_phone" label="Other phone" type="tel" defaultValue={editingContact?.alt_phone ?? ""} optional />
            <TextareaField name="address" label="Address" className="sm:col-span-2" defaultValue={editingContact?.address ?? ""} optional />
            <CheckboxField name="is_primary" label="Call this person first" defaultChecked={editingContact?.is_primary ?? contacts.length === 0} />
          </div>
        </ActionForm>
      ) : contacts.length === 0 ? (
        <EmptyState title="No emergency contacts" description="Add someone to call if something happens at work." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {contacts.map((c) => (
            <li key={c.id} className="rounded-xl border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-foreground">
                    {c.name} {c.is_primary && <Badge className="ml-1">First to call</Badge>}
                  </p>
                  <p className="text-[13px] text-muted-foreground">{c.relationship}</p>
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" aria-label={`Edit ${c.name}`} onClick={() => setEditing(c.id)}>
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                    <Button variant="ghost" size="sm" aria-label={`Remove ${c.name}`} onClick={() => setRemoving(c)}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-3 text-sm tabular">{[c.phone, c.alt_phone].filter(Boolean).join(" · ")}</p>
              {c.address && <p className="mt-1 text-[13px] text-muted-foreground">{c.address}</p>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name ?? "contact"}?`}
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await deleteEmergencyContact(employeeId, removing!.id);
          setRemoving(null);
          if (r.error) toast.error(r.error);
          else {
            toast.success("Contact removed.");
            router.refresh();
          }
        }}
      />
    </section>
  );
}

export function CompensationPanel({
  employeeId,
  rows,
  canCreate,
  defaultCurrency,
}: {
  employeeId: string;
  rows: { id: string; when: string; amount: string; basis: string; reason: string | null }[];
  canCreate: boolean;
  defaultCurrency: string;
}) {
  const [adding, setAdding] = useState(false);
  const action = useCallback((s: ActionResult, f: FormData) => addCompensation(employeeId, s, f), [employeeId]);
  return (
    <section>
      <SectionHeading
        title="Salary"
        action={
          canCreate && !adding ? (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              {rows.length ? "Change salary" : "Add salary"}
            </Button>
          ) : null
        }
      />
      <p className="-mt-2 mb-5 text-[13px] text-subtle-foreground">Only people you&apos;ve allowed to see salaries can open this tab. Changes are kept as history.</p>
      {adding && (
        <div className="mb-6 rounded-xl border border-border p-5">
          <ActionForm
            action={action}
            onSuccess={() => setAdding(false)}
            footer={
              <Button variant="ghost" type="button" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="basic_salary" label="Basic salary" type="number" min={0} step="0.01" inputMode="decimal" />
              <SelectField
                name="pay_basis"
                label="Paid"
                options={[
                  { value: "monthly", label: "Monthly" },
                  { value: "daily", label: "Daily" },
                  { value: "hourly", label: "Hourly" },
                ]}
                defaultValue="monthly"
              />
              <TextField name="effective_date" label="Starts on" type="date" defaultValue={today()} />
              <TextField name="currency" label="Currency" defaultValue={defaultCurrency} maxLength={3} />
              <TextField name="reason" label="Reason" hint="For example yearly increase, promotion." className="sm:col-span-2" optional />
            </div>
          </ActionForm>
        </div>
      )}
      {rows.length === 0 ? (
        !adding && <EmptyState title="No salary recorded" description="Add their basic salary so payroll can use it." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Starts on</Th>
              <Th>Basic salary</Th>
              <Th className="hidden sm:table-cell">Paid</Th>
              <Th className="hidden sm:table-cell">Reason</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Tr key={r.id}>
                <Td className="tabular">
                  {r.when} {i === 0 && <Badge className="ml-1">Current</Badge>}
                </Td>
                <Td className="tabular">{r.amount}</Td>
                <Td className="hidden text-muted-foreground sm:table-cell">{r.basis}</Td>
                <Td className="hidden text-muted-foreground sm:table-cell">{r.reason}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  );
}

interface Bank {
  id: string;
  bank_name: string;
  account_name: string | null;
  account_number: string;
  branch: string | null;
  swift_code: string | null;
  currency: string | null;
}

export function BankPanel({ employeeId, account, canEdit }: { employeeId: string; account: Bank | null; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [reveal, setReveal] = useState(false);
  const action = useCallback((s: ActionResult, f: FormData) => saveBankAccount(employeeId, s, f), [employeeId]);
  const masked = account ? `•••• ${account.account_number.slice(-4)}` : "";
  return (
    <section>
      <SectionHeading
        title="Bank account"
        action={
          canEdit && !editing ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {account ? "Edit" : "Add bank account"}
            </Button>
          ) : null
        }
      />
      {editing ? (
        <ActionForm
          action={action}
          onSuccess={() => setEditing(false)}
          footer={
            <Button variant="ghost" type="button" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          }
        >
          {account && <input type="hidden" name="id" value={account.id} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField name="bank_name" label="Bank" hint="For example Bank of Maldives." defaultValue={account?.bank_name} />
            <TextField name="account_name" label="Name on the account" defaultValue={account?.account_name ?? ""} optional />
            <TextField name="account_number" label="Account number" defaultValue={account?.account_number} inputMode="numeric" autoComplete="off" />
            <TextField name="currency" label="Account currency" defaultValue={account?.currency ?? ""} maxLength={3} optional />
            <TextField name="branch" label="Branch" defaultValue={account?.branch ?? ""} optional />
            <TextField name="swift_code" label="SWIFT code" hint="Only needed for overseas transfers." defaultValue={account?.swift_code ?? ""} optional />
          </div>
        </ActionForm>
      ) : account ? (
        <DetailList
          items={[
            { label: "Bank", value: account.bank_name },
            { label: "Name on the account", value: account.account_name },
            {
              label: "Account number",
              value: (
                <span className="flex items-center gap-2 tabular">
                  {reveal ? account.account_number : masked}
                  <button type="button" className="text-[13px] text-muted-foreground underline underline-offset-4" onClick={() => setReveal((r) => !r)}>
                    {reveal ? "Hide" : "Show"}
                  </button>
                </span>
              ),
            },
            { label: "Currency", value: account.currency },
            { label: "Branch", value: account.branch },
            { label: "SWIFT code", value: account.swift_code },
          ]}
        />
      ) : (
        <EmptyState title="No bank account" description="Add where their salary is paid." />
      )}
    </section>
  );
}

interface Doc {
  id: string;
  title: string;
  path: string;
  fileName: string | null;
  size: number | null;
  category: string | null;
  expiry: string;
  expired: boolean;
  added: string;
  hidden: boolean;
}

const MAX_MB = 25;

export function DocumentsPanel({
  employeeId,
  businessId,
  docs,
  categories,
  canCreate,
  canDelete,
}: {
  employeeId: string;
  businessId: string;
  docs: Doc[];
  categories: { value: string; label: string }[];
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Doc | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const file = form.get("file") as File | null;
    if (!file || file.size === 0) return setError("Choose a file to upload.");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`Files can be up to ${MAX_MB} MB.`);
    setBusy(true);
    const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `${businessId}/documents/${employeeId}/${crypto.randomUUID()}-${safe}`;
    const supabase = await getBrowserClient();
    const { error: upErr } = await supabase.storage.from("tenant-files").upload(path, file, { contentType: file.type || undefined });
    if (upErr) {
      setBusy(false);
      return setError("The upload didn't work. Check you have permission to add files, then try again.");
    }
    const r = await recordDocument(employeeId, {
      title: (form.get("title") as string) || file.name,
      file_path: path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      category_id: form.get("category_id") ?? "",
      expiry_date: form.get("expiry_date") ?? "",
      visible_to_employee: form.get("visible_to_employee") === "true",
    });
    setBusy(false);
    if (r.error) return setError(r.error);
    toast.success("File added.");
    formRef.current?.reset();
    setAdding(false);
    router.refresh();
  }

  async function open(path: string) {
    const r = await fileLink(path);
    if (r.url) window.open(r.url, "_blank", "noopener");
    else toast.error(r.error ?? "Couldn't open the file.");
  }

  return (
    <section>
      <SectionHeading
        title="Files"
        action={
          canCreate && !adding ? (
            <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
              <Upload className="size-3.5" aria-hidden /> Upload file
            </Button>
          ) : null
        }
      />
      {adding && (
        <form ref={formRef} onSubmit={upload} className="mb-6 space-y-4 rounded-xl border border-border p-5" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-[13px] text-muted-foreground">File (up to {MAX_MB} MB)</span>
              <input
                name="file"
                type="file"
                required
                className="block w-full text-sm file:mr-3 file:h-9 file:rounded-lg file:border file:border-border-strong file:bg-transparent file:px-3 file:text-foreground"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] text-muted-foreground">Name</span>
              <input name="title" placeholder="For example employment contract" className="block h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm" />
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] text-muted-foreground">Type</span>
              <select name="category_id" className="block h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm">
                <option value="">Other</option>
                {categories.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="text-[13px] text-muted-foreground">Expires on (optional)</span>
              <input name="expiry_date" type="date" className="block h-10 w-full rounded-lg border border-border-strong bg-surface px-3 text-sm" />
            </label>
            <div className="flex items-end pb-2">
              <CheckboxField name="visible_to_employee" label="They can see this file" defaultChecked />
            </div>
          </div>
          <div className="flex gap-3">
            <Button type="submit" loading={busy}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {docs.length === 0 ? (
        !adding && <EmptyState title="No files yet" description="Upload contracts, ID copies and certificates. Only people with access to files can open them." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>File</Th>
              <Th className="hidden sm:table-cell">Type</Th>
              <Th className="hidden md:table-cell">Expires</Th>
              <Th className="hidden md:table-cell">Added</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <Tr key={d.id}>
                <Td>
                  <span className="block text-foreground">{d.title}</span>
                  <span className="block text-[13px] text-subtle-foreground">
                    {d.fileName} {d.hidden && "· hidden from them"}
                  </span>
                </Td>
                <Td className="hidden text-muted-foreground sm:table-cell">{d.category ?? "Other"}</Td>
                <Td className="hidden tabular md:table-cell">{d.expiry ? d.expired ? <StatusDot tone="danger">{d.expiry}</StatusDot> : d.expiry : ""}</Td>
                <Td className="hidden text-muted-foreground tabular md:table-cell">{d.added}</Td>
                <Td className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => open(d.path)} aria-label={`Open ${d.title}`}>
                    <ExternalLink className="size-3.5" aria-hidden />
                  </Button>
                  {canDelete && (
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(d)} aria-label={`Remove ${d.title}`}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.title ?? "file"}?`}
        confirmLabel="Remove file"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await deleteDocument(employeeId, removing!.id);
          setRemoving(null);
          if (r.error) toast.error(r.error);
          else {
            toast.success("File removed.");
            router.refresh();
          }
        }}
      >
        The file is deleted for good. This can&apos;t be undone.
      </ConfirmDialog>
    </section>
  );
}

export function LoginPanel({
  employeeId,
  canInvite,
  defaultEmail,
  member,
  pendingInvite,
  roles,
}: {
  employeeId: string;
  canInvite: boolean;
  defaultEmail: string;
  member: { role: string; status: string } | null;
  pendingInvite: string | null;
  roles: { value: string; label: string; isStaff: boolean }[];
}) {
  const [link, setLink] = useState<string | null>(null);
  const action = useCallback(
    async (s: ActionResult, f: FormData) => {
      const r = await inviteLogin(employeeId, s, f);
      if (r.link) setLink(r.link);
      return r;
    },
    [employeeId],
  );
  return (
    <section className="max-w-2xl">
      <SectionHeading title="Login" />
      {member ? (
        <DetailList
          items={[
            { label: "Can sign in", value: member.status === "active" ? "Yes" : "No, their login is turned off" },
            { label: "Role", value: member.role },
          ]}
        />
      ) : (
        <>
          <p className="mb-5 text-sm text-muted-foreground">
            {pendingInvite
              ? `An invitation is waiting for ${pendingInvite}. Sending a new one cancels the old link.`
              : "They can't sign in yet. Invite them and they'll get an email with a link to set a password. Their login is linked to this profile, so they see their own time off, payslips and files."}
          </p>
          {canInvite ? (
            <ActionForm action={action} submitLabel={pendingInvite ? "Send a new invitation" : "Send invitation"} pendingLabel="Sending…">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField name="email" label="Email" type="email" defaultValue={defaultEmail} />
                <SelectField name="role_id" label="Role" options={roles} defaultValue={roles.find((r) => r.isStaff)?.value} />
              </div>
            </ActionForm>
          ) : (
            <Alert tone="info">Ask the owner or an admin to invite them.</Alert>
          )}
          {link && (
            <div className="mt-5 flex items-center gap-2 rounded-lg border border-border p-3 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{link}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(link);
                  toast.success("Link copied.");
                }}
              >
                <Copy className="size-3.5" aria-hidden /> Copy link
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
