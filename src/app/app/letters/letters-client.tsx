"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { ActionForm, CheckboxField, SelectField, TextField } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/page";
import { declineLetterRequest, deleteTemplate, generateLetter, letterLink, previewLetter, saveTemplate } from "@/lib/letters/actions";
import { exampleValues, LETTER_KINDS, MERGE_FIELDS, renderTemplate } from "@/lib/letters/merge";
import type { ActionResult } from "@/lib/errors";

type Opt = { value: string; label: string };

export function LetterMaker({
  templates,
  people,
  prefill,
  brandingMissing,
}: {
  templates: Opt[];
  people: Opt[];
  prefill?: { requestId: string; employeeId: string; templateId: string | null; purpose: string | null; addressedTo: string | null };
  brandingMissing: boolean;
}) {
  const [employee, setEmployee] = useState(prefill?.employeeId ?? "");
  const [template, setTemplate] = useState(prefill?.templateId ?? "");
  const [purpose, setPurpose] = useState(prefill?.purpose ?? "");
  const [addressedTo, setAddressedTo] = useState(prefill?.addressedTo ?? "");
  const [draft, setDraft] = useState<{ subject: string; body: string; missing: string[] } | null>(null);
  const [saveToFiles, setSaveToFiles] = useState(true);
  const [pending, start] = useTransition();
  const router = useRouter();

  const fill = () =>
    start(async () => {
      if (!employee || !template) return void toast.error("Choose a person and a template.");
      const r = await previewLetter({ employee_id: employee, template_id: template, purpose, addressed_to: addressedTo });
      if (r.error) toast.error(r.error);
      else setDraft({ subject: r.subject ?? "", body: r.body ?? "", missing: r.missing ?? [] });
    });

  const make = () =>
    start(async () => {
      const r = await generateLetter({
        employee_id: employee,
        template_id: template,
        subject: draft!.subject,
        body: draft!.body,
        addressed_to: addressedTo,
        save_to_files: saveToFiles,
        request_id: prefill?.requestId ?? "",
      });
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Letter ready.");
      if (r.url) window.location.href = r.url;
      setDraft(null);
      router.refresh();
    });

  if (templates.length === 0) {
    return (
      <EmptyState
        title="No templates yet"
        description="Add a template first. It's the letter with blanks that fill in from each person's profile."
        action={
          <Link href="/app/letters?tab=templates" className={buttonClasses()}>
            Add a template
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-4">
        {prefill?.requestId && <Alert tone="info">Issuing a letter someone asked for. When you make it, they&apos;re told it&apos;s ready.</Alert>}
        {brandingMissing && (
          <Alert tone="warning" title="Your letterhead isn't finished">
            Add your logo and who signs letters in{" "}
            <Link href="/app/workspace/company?tab=branding" className="underline underline-offset-4">
              Company settings
            </Link>
            .
          </Alert>
        )}
        <Field label="Person" htmlFor="lm-person">
          <Select id="lm-person" options={people} placeholder="Choose a person" value={employee} onChange={(e) => (setEmployee(e.target.value), setDraft(null))} />
        </Field>
        <Field label="Template" htmlFor="lm-template">
          <Select id="lm-template" options={templates} placeholder="Choose a template" value={template} onChange={(e) => (setTemplate(e.target.value), setDraft(null))} />
        </Field>
        <Field label="Purpose" htmlFor="lm-purpose" optional hint="Fills in {{letter.purpose}}, for example a bank loan application.">
          <Input id="lm-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </Field>
        <Field label="Addressed to" htmlFor="lm-to" optional>
          <Input id="lm-to" value={addressedTo} onChange={(e) => setAddressedTo(e.target.value)} placeholder="For example The Manager, Bank of Maldives" />
        </Field>
        <Button variant="secondary" onClick={fill} loading={pending && !draft}>
          {draft ? "Fill in again" : "Fill in the letter"}
        </Button>
      </div>

      <div>
        {draft ? (
          <div className="space-y-4">
            {draft.missing.length > 0 && (
              <Alert tone="warning" title="Some blanks couldn't be filled">
                These are shown in [brackets]: {draft.missing.join(", ")}. Add them to the profile and fill in again, or type over them below.
              </Alert>
            )}
            <Field label="Subject" htmlFor="lm-subject">
              <Input id="lm-subject" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            </Field>
            <Field label="Letter" htmlFor="lm-body" hint="Leave an empty line between paragraphs.">
              <Textarea id="lm-body" rows={16} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="font-body leading-relaxed" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={saveToFiles} onChange={(e) => setSaveToFiles(e.target.checked)} /> Also add it to their files
            </label>
            <Button onClick={make} loading={pending}>
              <Download className="size-4" aria-hidden /> Make PDF
            </Button>
          </div>
        ) : (
          <div className="grid h-full min-h-64 place-items-center rounded-xl border border-dashed border-border-strong p-8 text-center text-sm text-muted-foreground">
            Choose a person and template, then fill in the letter to check it before making the PDF.
          </div>
        )}
      </div>
    </div>
  );
}

export function OpenLetterButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      aria-label="Open letter"
      onClick={() =>
        start(async () => {
          const r = await letterLink(id);
          if (r.url) window.open(r.url, "_blank", "noopener");
          else toast.error(r.error ?? "Couldn't open the letter.");
        })
      }
    >
      <ExternalLink className="size-3.5" aria-hidden /> Open
    </Button>
  );
}

export function RequestActions({ id, ready }: { id: string; ready: boolean }) {
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <span className="flex justify-end gap-1">
        {ready ? (
          <Link href={`/app/letters?tab=make&request=${id}`} className={buttonClasses({ size: "sm" })}>
            Issue
          </Link>
        ) : (
          <Link href="/app/requests" className={buttonClasses({ size: "sm", variant: "secondary" })}>
            Decide
          </Link>
        )}
        <Button variant="ghost" size="sm" onClick={() => setDeclining(true)}>
          Decline
        </Button>
      </span>
      <Modal open={declining} onClose={() => setDeclining(false)} title="Decline letter request" description="They'll see your note.">
        <div className="space-y-4">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" autoFocus />
          <Button
            variant="danger"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await declineLetterRequest(id, note);
                if (r.error) toast.error(r.error);
                else {
                  toast.success("Request declined.");
                  setDeclining(false);
                  router.refresh();
                }
              })
            }
          >
            Decline
          </Button>
        </div>
      </Modal>
    </>
  );
}

interface Template {
  id: string;
  name: string;
  kind: string;
  subject: string | null;
  body: string;
  include_signature: boolean;
  include_stamp: boolean;
  requestable_by_staff: boolean;
  is_active: boolean;
}

export function TemplatesPanel({ canEdit, templates }: { canEdit: boolean; templates: Template[] }) {
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [removing, setRemoving] = useState<Template | null>(null);
  const router = useRouter();
  const current = editing === "new" ? null : editing;
  const action = useCallback((s: ActionResult, f: FormData) => saveTemplate(current?.id ?? null, s, f), [current]);

  return (
    <div>
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" aria-hidden /> New template
          </Button>
        </div>
      )}
      {templates.length === 0 ? (
        <EmptyState title="No templates" />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-foreground">
                  {t.name} {!t.is_active && <Badge>Off</Badge>}
                </p>
                <p className="text-[13px] text-subtle-foreground">
                  {LETTER_KINDS.find((k) => k.value === t.kind)?.label}
                  {t.requestable_by_staff && " · staff can ask for it"}
                </p>
              </div>
              {canEdit && (
                <span className="flex">
                  <Button variant="ghost" size="sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t)}>
                    <Pencil className="size-3.5" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Remove ${t.name}`} onClick={() => setRemoving(t)}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={current ? `Edit ${current.name}` : "New template"} wide>
        {editing && <TemplateForm key={current?.id ?? "new"} template={current} action={action} onDone={() => setEditing(null)} />}
      </Modal>
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name}?`}
        confirmLabel="Remove template"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await deleteTemplate(removing!.id);
          setRemoving(null);
          if (r.error) toast.error(r.error);
          else {
            toast.success("Template removed.");
            router.refresh();
          }
        }}
      >
        Letters already made from it are kept.
      </ConfirmDialog>
    </div>
  );
}

function TemplateForm({ template, action, onDone }: { template: Template | null; action: (s: ActionResult, f: FormData) => Promise<ActionResult>; onDone: () => void }) {
  const [body, setBody] = useState(template?.body ?? "");
  const [preview, setPreview] = useState(false);
  const example = useMemo(() => renderTemplate(body, exampleValues()).text, [body]);
  const insert = (key: string) => setBody((b) => `${b}{{${key}}}`);
  return (
    <ActionForm action={action} onSuccess={onDone}>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="name" label="Name" defaultValue={template?.name} />
        <SelectField name="kind" label="Kind" options={LETTER_KINDS} defaultValue={template?.kind ?? "custom"} />
        <TextField name="subject" label="Subject line" defaultValue={template?.subject ?? ""} className="sm:col-span-2" optional />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor="body" className="text-[13px] text-muted-foreground">
            Letter
          </label>
          <button type="button" className="text-[13px] text-muted-foreground underline underline-offset-4" onClick={() => setPreview((p) => !p)}>
            {preview ? "Edit" : "Preview with example details"}
          </button>
        </div>
        {preview ? (
          <div className="min-h-64 rounded-lg border border-border bg-surface p-4 text-sm whitespace-pre-wrap">{example}</div>
        ) : (
          <Textarea id="body" rows={12} value={body} onChange={(e) => setBody(e.target.value)} />
        )}
        <input type="hidden" name="body" value={body} />
        <p className="text-xs text-subtle-foreground">Leave an empty line between paragraphs. Click a blank to add it:</p>
        <div className="flex flex-wrap gap-1.5">
          {MERGE_FIELDS.map((m) => (
            <button key={m.key} type="button" onClick={() => insert(m.key)} className="rounded-full border border-border px-2 py-0.5 text-[12px] text-muted-foreground hover:border-border-strong hover:text-foreground">
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CheckboxField name="include_signature" label="Add the signature" defaultChecked={template?.include_signature ?? true} />
        <CheckboxField name="include_stamp" label="Add the company stamp" defaultChecked={template?.include_stamp ?? false} />
        <CheckboxField name="requestable_by_staff" label="Staff can ask for it" defaultChecked={template?.requestable_by_staff ?? false} />
        <CheckboxField name="is_active" label="In use" defaultChecked={template?.is_active ?? true} />
      </div>
    </ActionForm>
  );
}
