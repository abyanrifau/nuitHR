"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, FileText, Plus, Star, UserCheck } from "lucide-react";
import { ActionForm, SelectField, TextField } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getBrowserClient } from "@/lib/supabase/lazy-client";
import { addCandidate, addNote, candidateFileLink, hireCandidate, moveApplication, rateApplication, scheduleInterview, setInterviewStatus } from "@/lib/hiring/actions";
import type { ActionResult } from "@/lib/errors";
import { today } from "@/lib/format";
import { cn } from "@/lib/utils";

type Opt = { value: string; label: string };

interface App {
  id: string;
  stage: string;
  rating: number | null;
  coverLetter: string | null;
  rejectedReason: string | null;
  hiredEmployeeId: string | null;
  applied: string;
  candidate: { id: string; full_name: string; email: string | null; phone: string | null; current_position: string | null; cv_path: string | null; source: string };
  notes: { id: string; body: string; when: string; by: string }[];
  interviews: { id: string; when: string; minutes: number; location: string | null; status: string }[];
}

const COLUMNS = [
  { key: "applied", label: "New" },
  { key: "screening", label: "Shortlisted" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
] as const;

const SOURCES: Opt[] = [
  { value: "manual", label: "Added by you" },
  { value: "referral", label: "Referral" },
  { value: "agency", label: "Agency" },
  { value: "job_board", label: "Job site" },
  { value: "other", label: "Other" },
];

export function Board({
  vacancyId,
  businessId,
  canEdit,
  canHire,
  canSetSalary,
  suggestedCode,
  org,
  currency,
  apps,
}: {
  vacancyId: string;
  businessId: string;
  canEdit: boolean;
  canHire: boolean;
  canSetSalary: boolean;
  suggestedCode: string;
  org: { departments: Opt[]; branches: Opt[]; positions: Opt[]; managers: Opt[] } | null;
  currency: string;
  apps: App[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const open = apps.find((a) => a.id === openId) ?? null;
  const rejected = apps.filter((a) => a.stage === "rejected");

  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) return void toast.error(r.error);
      if (r.message) toast.success(r.message);
      after?.();
      router.refresh();
    });
  const move = (a: App, dir: -1 | 1) => {
    const i = COLUMNS.findIndex((c) => c.key === a.stage);
    const next = COLUMNS[i + dir];
    if (!next || next.key === "hired") return;
    run(() => moveApplication(a.id, next.key, vacancyId));
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {canEdit && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" aria-hidden /> Add a candidate
          </Button>
        )}
        {rejected.length > 0 && (
          <button type="button" onClick={() => setShowRejected((x) => !x)} className="text-[13px] text-muted-foreground underline underline-offset-4">
            {showRejected ? "Hide" : "Show"} {rejected.length} not going ahead
          </button>
        )}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="grid min-w-[60rem] grid-cols-5 gap-3">
          {COLUMNS.map((col) => {
            const list = apps.filter((a) => a.stage === col.key);
            return (
              <section key={col.key} aria-label={col.label} className="rounded-xl border border-border bg-surface-muted/30 p-2">
                <h2 className="mb-2 flex items-center justify-between px-1.5 pt-1 font-body text-[12px] tracking-[0.12em] text-subtle-foreground uppercase">
                  {col.label} <span className="tabular">{list.length}</span>
                </h2>
                <ul className="space-y-2">
                  {list.map((a) => (
                    <li key={a.id} className="rounded-lg border border-border bg-surface p-3">
                      <button type="button" onClick={() => setOpenId(a.id)} className="block w-full text-left">
                        <span className="block truncate text-sm text-foreground">{a.candidate.full_name}</span>
                        <span className="block truncate text-[12px] text-subtle-foreground">{a.candidate.current_position ?? a.applied}</span>
                        {a.rating ? (
                          <span className="mt-1 flex gap-0.5" aria-label={`${a.rating} stars`}>
                            {Array.from({ length: 5 }, (_, i) => (
                              <Star key={i} className={cn("size-3", i < a.rating! ? "fill-current text-warning" : "text-border-strong")} aria-hidden />
                            ))}
                          </span>
                        ) : null}
                        {a.interviews.some((i) => i.status === "scheduled") && <Badge className="mt-1.5">Interview booked</Badge>}
                      </button>
                      {canEdit && col.key !== "hired" && (
                        <span className="mt-2 flex justify-between">
                          <Button variant="ghost" size="sm" className="h-7 px-2" disabled={pending || col.key === "applied"} onClick={() => move(a, -1)} aria-label="Move back">
                            <ArrowLeft className="size-3.5" aria-hidden />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2" disabled={pending || col.key === "offer"} onClick={() => move(a, 1)} aria-label="Move forward">
                            <ArrowRight className="size-3.5" aria-hidden />
                          </Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>

      {showRejected && (
        <ul className="mt-4 divide-y divide-border rounded-xl border border-border">
          {rejected.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setOpenId(a.id)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm hover:bg-accent-soft">
                <span className="text-foreground">{a.candidate.full_name}</span>
                <span className="text-[12px] text-subtle-foreground">{a.rejectedReason ?? "Not going ahead"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Modal open={Boolean(open)} onClose={() => setOpenId(null)} title={open?.candidate.full_name ?? ""} wide>
        {open && (
          <CandidatePanel
            key={open.id}
            app={open}
            vacancyId={vacancyId}
            canEdit={canEdit}
            canHire={canHire}
            canSetSalary={canSetSalary}
            suggestedCode={suggestedCode}
            org={org}
            currency={currency}
            onDone={() => setOpenId(null)}
          />
        )}
      </Modal>
      <Modal open={adding} onClose={() => setAdding(false)} title="Add a candidate" description="For someone who applied another way: a referral, a walk-in or an agency.">
        {adding && <AddCandidateForm vacancyId={vacancyId} businessId={businessId} onDone={() => setAdding(false)} />}
      </Modal>
    </div>
  );
}

function AddCandidateForm({ vacancyId, businessId, onDone }: { vacancyId: string; businessId: string; onDone: () => void }) {
  const [v, setV] = useState({ full_name: "", email: "", phone: "", current_position: "", source: "manual", notes: "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          let cv: string | undefined;
          if (file) {
            if (file.size > 10 * 1024 * 1024) return setError("The CV must be smaller than 10 MB.");
            const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "pdf";
            cv = `${businessId}/recruitment/${crypto.randomUUID()}/cv.${ext}`;
            const { error: up } = await (await getBrowserClient()).storage.from("tenant-files").upload(cv, file, { contentType: file.type || undefined });
            if (up) return setError("The CV didn't upload. Check you can add candidates, then try again.");
          }
          const r = await addCandidate({ ...v, vacancy_id: vacancyId, cv_path: cv });
          if (r.error) return setError(r.error);
          toast.success(r.message ?? "Added.");
          onDone();
          router.refresh();
        });
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Name" htmlFor="ac-name">
        <Input id="ac-name" value={v.full_name} onChange={set("full_name")} autoFocus />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Email" htmlFor="ac-email" optional>
          <Input id="ac-email" type="email" value={v.email} onChange={set("email")} />
        </Field>
        <Field label="Phone" htmlFor="ac-phone" optional>
          <Input id="ac-phone" type="tel" value={v.phone} onChange={set("phone")} />
        </Field>
        <Field label="Current job" htmlFor="ac-job" optional>
          <Input id="ac-job" value={v.current_position} onChange={set("current_position")} />
        </Field>
        <Field label="Where they came from" htmlFor="ac-src">
          <Select id="ac-src" options={SOURCES} value={v.source} onChange={set("source")} />
        </Field>
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-muted-foreground">
        <FileText className="size-4" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{file ? file.name : "Add their CV (optional)"}</span>
        <input type="file" accept=".pdf,.doc,.docx,image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <Button type="submit" loading={pending}>
        Add candidate
      </Button>
    </form>
  );
}

function CandidatePanel({
  app,
  vacancyId,
  canEdit,
  canHire,
  canSetSalary,
  suggestedCode,
  org,
  currency,
  onDone,
}: {
  app: App;
  vacancyId: string;
  canEdit: boolean;
  canHire: boolean;
  canSetSalary: boolean;
  suggestedCode: string;
  org: { departments: Opt[]; branches: Opt[]; positions: Opt[]; managers: Opt[] } | null;
  currency: string;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<"view" | "interview" | "hire" | "reject">("view");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const c = app.candidate;
  const interviewAction = useCallback((s: ActionResult, f: FormData) => scheduleInterview(vacancyId, s, f), [vacancyId]);
  const hireAction = useCallback((s: ActionResult, f: FormData) => hireCandidate(vacancyId, s, f), [vacancyId]);
  const stageLabel = useMemo(() => (app.stage === "rejected" ? "Not going ahead" : COLUMNS.find((x) => x.key === app.stage)?.label), [app.stage]);
  const run = (fn: () => Promise<ActionResult>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.error) return void toast.error(r.error);
      if (r.message) toast.success(r.message);
      after?.();
      router.refresh();
    });

  if (mode === "interview") {
    return (
      <ActionForm action={interviewAction} submitLabel="Book interview" onSuccess={() => setMode("view")} footer={<Button variant="ghost" type="button" onClick={() => setMode("view")}>Back</Button>}>
        <input type="hidden" name="application_id" value={app.id} />
        <div className="grid grid-cols-2 gap-3">
          <TextField name="date" label="Date" type="date" defaultValue={today()} />
          <TextField name="time" label="Time" type="time" defaultValue="10:00" />
        </div>
        <SelectField
          name="duration_minutes"
          label="How long"
          options={[
            { value: "15", label: "15 minutes" },
            { value: "30", label: "30 minutes" },
            { value: "45", label: "45 minutes" },
            { value: "60", label: "1 hour" },
          ]}
          defaultValue="30"
        />
        <TextField name="location" label="Where" placeholder="For example HR office, or a video call link" optional />
      </ActionForm>
    );
  }

  if (mode === "hire" && org) {
    return (
      <ActionForm
        action={hireAction}
        submitLabel={`Hire ${c.full_name.split(" ")[0]}`}
        onSuccess={(s: ActionResult & { employeeId?: string }) => {
          onDone();
          if (s.employeeId) router.push(`/app/people/${s.employeeId}?added=1`);
        }}
        footer={<Button variant="ghost" type="button" onClick={() => setMode("view")}>Back</Button>}
      >
        <p className="text-sm text-muted-foreground">They&apos;re added to People on probation, and their joiner checklist starts.</p>
        <input type="hidden" name="application_id" value={app.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField name="join_date" label="First day" type="date" defaultValue={today()} />
          <TextField name="employee_code" label="Employee number" defaultValue={suggestedCode} />
          <SelectField name="position_id" label="Job title" options={org.positions} placeholder="Use the role's" optional />
          <SelectField name="department_id" label="Department" options={org.departments} placeholder="Use the role's" optional />
          <SelectField name="branch_id" label="Location" options={org.branches} placeholder="Use the role's" optional />
          <SelectField name="manager_id" label="Reports to" options={org.managers} placeholder="Nobody yet" optional />
          {canSetSalary && <TextField name="salary" label={`Basic salary (${currency})`} type="number" min={0} optional />}
        </div>
      </ActionForm>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge>{stageLabel}</Badge>
        <span className="text-muted-foreground">Applied {app.applied}</span>
        {c.source === "careers_page" && <Badge>Careers page</Badge>}
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        {[
          ["Email", c.email],
          ["Phone", c.phone],
          ["Current job", c.current_position],
        ].map(([k, val]) => (
          <div key={k}>
            <dt className="text-[13px] text-muted-foreground">{k}</dt>
            <dd className="text-foreground">{val ? k === "Email" ? <a href={`mailto:${val}`} className="underline underline-offset-4">{val}</a> : val : <span className="text-subtle-foreground">Not given</span>}</dd>
          </div>
        ))}
        {c.cv_path && (
          <div>
            <dt className="text-[13px] text-muted-foreground">CV</dt>
            <dd>
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() =>
                  start(async () => {
                    const r = await candidateFileLink(c.cv_path!);
                    if (r.url) window.open(r.url, "_blank", "noopener");
                    else toast.error(r.error ?? "Couldn't open the CV.");
                  })
                }
              >
                Open CV
              </button>
            </dd>
          </div>
        )}
      </dl>
      {app.coverLetter && <p className="rounded-lg border border-border p-3 text-sm whitespace-pre-line text-muted-foreground">{app.coverLetter}</p>}

      {canEdit && app.stage !== "hired" && (
        <div className="flex items-center gap-1">
          <span className="mr-2 text-[13px] text-muted-foreground">Your rating</span>
          {Array.from({ length: 5 }, (_, i) => (
            <button key={i} type="button" aria-label={`${i + 1} stars`} disabled={pending} onClick={() => run(() => rateApplication(app.id, i + 1, vacancyId))}>
              <Star className={cn("size-5", app.rating && i < app.rating ? "fill-current text-warning" : "text-border-strong")} aria-hidden />
            </button>
          ))}
        </div>
      )}

      {app.interviews.length > 0 && (
        <section>
          <h3 className="mb-2 text-[13px] text-muted-foreground">Interviews</h3>
          <ul className="space-y-2">
            {app.interviews.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <span className="flex-1 tabular">
                  {i.when} · {i.minutes} min{i.location && ` · ${i.location}`}
                </span>
                {i.status === "scheduled" && canEdit ? (
                  <>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setInterviewStatus(i.id, "completed", vacancyId))}>
                      Done
                    </Button>
                    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setInterviewStatus(i.id, "cancelled", vacancyId))}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Badge>{i.status === "completed" ? "Done" : i.status === "cancelled" ? "Cancelled" : i.status === "no_show" ? "Didn't come" : "Booked"}</Badge>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-[13px] text-muted-foreground">Notes</h3>
        {canEdit && (
          <div className="mb-3 flex gap-2">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What stood out, questions to follow up" aria-label="Note" />
            <Button variant="secondary" disabled={pending || !note.trim()} onClick={() => run(() => addNote(app.id, note, vacancyId), () => setNote(""))}>
              Add
            </Button>
          </div>
        )}
        {app.notes.length ? (
          <ul className="space-y-2">
            {app.notes.map((n) => (
              <li key={n.id} className="text-sm">
                <p className="whitespace-pre-line text-foreground">{n.body}</p>
                <p className="text-[12px] text-subtle-foreground">
                  {n.by} · {n.when}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-subtle-foreground">No notes yet.</p>
        )}
      </section>

      {mode === "reject" ? (
        <div className="space-y-3 rounded-lg border border-border p-3">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (only your team sees this)" aria-label="Reason" />
          <div className="flex gap-2">
            <Button variant="danger" size="sm" loading={pending} onClick={() => run(() => moveApplication(app.id, "rejected", vacancyId, reason), onDone)}>
              Not going ahead
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setMode("view")}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        canEdit && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {app.stage === "hired" ? (
              app.hiredEmployeeId && (
                <Link href={`/app/people/${app.hiredEmployeeId}`} className={buttonClasses({ size: "sm" })}>
                  <UserCheck className="size-3.5" aria-hidden /> Open their profile
                </Link>
              )
            ) : (
              <>
                {canHire && (
                  <Button size="sm" onClick={() => setMode("hire")}>
                    <UserCheck className="size-3.5" aria-hidden /> Hire
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={() => setMode("interview")}>
                  Book interview
                </Button>
                {app.stage === "rejected" ? (
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => moveApplication(app.id, "applied", vacancyId), onDone)}>
                    Reconsider
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setMode("reject")}>
                    Not going ahead
                  </Button>
                )}
              </>
            )}
          </div>
        )
      )}
    </div>
  );
}
