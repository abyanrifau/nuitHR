"use client";

import { useMemo, useState, useTransition } from "react";
import { CheckCircle2, Copy, Download, FileSpreadsheet, Link2, Plus, Trash2, Upload, UserPlus, XCircle } from "lucide-react";
import { addTeamMembers, finishSetup, importEmployeesCsv, type InviteOutcome } from "@/lib/onboarding/actions";
import { IMPORT_COLUMNS, previewImport, templateCsv, type ImportPreview } from "@/modules/employee-import";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type Role = { value: string; label: string; key: string | null };
type Person = {
  first_name: string;
  last_name: string;
  email: string;
  role_id: string;
  department: string;
  add_as_employee: boolean;
  send_invite: boolean;
};

export function TeamStep({
  businessId,
  roles,
  departments,
  importContext,
  alreadyAdded,
}: {
  businessId: string;
  roles: Role[];
  departments: string[];
  importContext: Parameters<typeof previewImport>[1];
  alreadyAdded: { employees: number; invites: number };
}) {
  const [tab, setTab] = useState<"manual" | "import">("manual");
  const [results, setResults] = useState<InviteOutcome[]>([]);
  const [imported, setImported] = useState(0);
  const [finishing, startFinish] = useTransition();
  const done = results.length > 0 || imported > 0 || alreadyAdded.employees > 0 || alreadyAdded.invites > 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-6">
        <div role="tablist" className="inline-flex rounded-lg bg-surface-muted p-1">
          {(
            [
              { key: "manual", label: "Invite by email", Icon: UserPlus },
              { key: "import", label: "Upload a spreadsheet", Icon: FileSpreadsheet },
            ] as const
          ).map(({ key, label, Icon }) => (
            <button
              key={key}
              role="tab"
              type="button"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground",
                tab === key && "bg-surface text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden /> {label}
            </button>
          ))}
        </div>

        {tab === "manual" ? (
          <ManualAdd businessId={businessId} roles={roles} departments={departments} onDone={(r) => setResults((x) => [...r, ...x])} />
        ) : (
          <CsvImport
            businessId={businessId}
            roles={roles}
            ctx={importContext}
            onDone={(n, inv) => {
              setImported((x) => x + n);
              setResults((x) => [...inv, ...x]);
            }}
          />
        )}

        {results.length > 0 && <ResultsList results={results} />}
      </div>

      <aside>
        <div className="space-y-4 rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-6">
          <h2 className="text-lg">So far</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            <li>{alreadyAdded.employees + imported + results.filter((r) => r.status !== "error").length} people added</li>
            <li>{alreadyAdded.invites + results.filter((r) => r.status === "invited" || r.status === "invite_link").length} invitations</li>
          </ul>
          <Button size="lg" className="w-full" loading={finishing} onClick={() => startFinish(() => finishSetup())}>
            {done ? "Finish and go to Home" : "Skip and go to Home"}
          </Button>
          <p className="text-xs text-muted-foreground">You can invite more people later from Workspace.</p>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------
function ManualAdd({
  businessId,
  roles,
  departments,
  onDone,
}: {
  businessId: string;
  roles: Role[];
  departments: string[];
  onDone: (r: InviteOutcome[]) => void;
}) {
  const employeeRole = roles.find((r) => r.key === "employee")?.value ?? roles[0]?.value ?? "";
  const blank = (): Person => ({
    first_name: "",
    last_name: "",
    email: "",
    role_id: employeeRole,
    department: "",
    add_as_employee: true,
    send_invite: true,
  });
  const [people, setPeople] = useState<Person[]>([blank()]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const update = (i: number, patch: Partial<Person>) => setPeople((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = () =>
    start(async () => {
      setError(null);
      const filled = people.filter((p) => p.first_name.trim() || p.email.trim());
      if (!filled.length) return setError("Enter at least one person's name.");
      const missing = filled.findIndex((p) => !p.first_name.trim());
      if (missing >= 0) return setError(`Person ${missing + 1} needs a first name.`);
      const r = await addTeamMembers(businessId, filled);
      if (r.error) return setError(r.error);
      onDone(r.results ?? []);
      setPeople([blank()]);
    });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite by email</CardTitle>
        <CardDescription>
          Each person gets a profile in the people directory. Add an email and they get a link to sign in with the role you pick.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <datalist id="dept-list">
          {departments.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        {people.map((p, i) => (
          <div key={i} className="space-y-3 rounded-lg border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Input
                aria-label={`Person ${i + 1} first name`}
                placeholder="First name"
                value={p.first_name}
                onChange={(e) => update(i, { first_name: e.target.value })}
              />
              <Input
                aria-label={`Person ${i + 1} last name`}
                placeholder="Last name"
                value={p.last_name}
                onChange={(e) => update(i, { last_name: e.target.value })}
              />
              <Input
                aria-label={`Person ${i + 1} email`}
                placeholder="Email (to invite them)"
                type="email"
                value={p.email}
                onChange={(e) => update(i, { email: e.target.value })}
              />
              <Select
                aria-label={`Person ${i + 1} role`}
                value={p.role_id}
                onChange={(e) => update(i, { role_id: e.target.value })}
                options={roles}
              />
              <Input
                aria-label={`Person ${i + 1} department`}
                placeholder="Department"
                list="dept-list"
                value={p.department}
                onChange={(e) => update(i, { department: e.target.value })}
              />
              <div className="flex items-center justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove person ${i + 1}`}
                  disabled={people.length === 1}
                  onClick={() => setPeople((x) => x.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" aria-hidden /> Remove
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <Checkbox label="Send an invitation email" checked={p.send_invite && !!p.email} onChange={(v) => update(i, { send_invite: v })} />
              <Checkbox
                label="Add them to the people directory"
                description="Untick for someone who only needs to sign in, like an outside accountant."
                checked={p.add_as_employee}
                onChange={(v) => update(i, { add_as_employee: v })}
              />
            </div>
          </div>
        ))}
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPeople((p) => [...p, blank()])}>
            <Plus className="size-4" aria-hidden /> Add another person
          </Button>
          <Button onClick={submit} loading={pending}>
            Add {people.filter((p) => p.first_name.trim()).length || ""}{" "}
            {people.filter((p) => p.first_name.trim()).length === 1 ? "person" : "people"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
function CsvImport({
  businessId,
  roles,
  ctx,
  onDone,
}: {
  businessId: string;
  roles: Role[];
  ctx: Parameters<typeof previewImport>[1];
  onDone: (imported: number, invited: InviteOutcome[]) => void;
}) {
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [inviteRole, setInviteRole] = useState<string>(roles.find((r) => r.key === "employee")?.value ?? "");
  const [invite, setInvite] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const preview: ImportPreview | null = useMemo(() => (csv == null ? null : previewImport(csv, ctx)), [csv, ctx]);
  const blocked = !preview || preview.fileErrors.length > 0 || preview.errorCount > 0 || preview.validCount === 0;

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "employee-import-template.csv" });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload a spreadsheet</CardTitle>
        <CardDescription>
          Fill in the template in Excel or Google Sheets, save it as <strong>CSV</strong>, then upload it. Every row is checked before anything is
          saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={downloadTemplate}>
            <Download className="size-4" aria-hidden /> Download template
          </Button>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 font-display rounded-lg bg-accent px-4 text-sm text-accent-foreground hover:opacity-85">
            <Upload className="size-4" aria-hidden /> {fileName ? "Choose a different file" : "Upload CSV file"}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                setError(null);
                setSuccess(null);
                if (!file) return;
                if (file.size > 2 * 1024 * 1024) return setError("That file is too big. Split it into files under 2 MB.");
                if (/\.xlsx?$/i.test(file.name)) return setError("That's an Excel file. In Excel choose File → Save As → CSV, then upload the CSV.");
                setFileName(file.name);
                setCsv(await file.text());
                e.target.value = "";
              }}
            />
          </label>
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">What goes in each column?</summary>
          <ul className="mt-2 space-y-1">
            {IMPORT_COLUMNS.map((c) => (
              <li key={c.key}>
                <span className="">{c.label}</span>
                {c.help && <span className="text-muted-foreground"> · {c.help}</span>}
              </li>
            ))}
          </ul>
        </details>

        {error && <Alert tone="danger">{error}</Alert>}
        {success && <Alert tone="success">{success}</Alert>}

        {preview && (
          <div className="space-y-3">
            {preview.fileErrors.map((e) => (
              <Alert key={e} tone="danger">
                {e}
              </Alert>
            ))}
            {preview.fileNotices.map((e) => (
              <Alert key={e} tone="info">
                {e}
              </Alert>
            ))}
            {preview.rows.length > 0 && (
              <>
                <p className="text-sm">
                  <span className="">{fileName}</span>: {preview.validCount} ready
                  {preview.errorCount > 0 && (
                    <span className="text-danger">, {preview.errorCount} with problems. Fix them in your spreadsheet and upload again.</span>
                  )}
                </p>
                <div className="max-h-96 overflow-auto rounded-lg border border-border">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-surface-muted text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Email</th>
                        <th className="px-3 py-2">Department / position</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {preview.rows.map((r) => (
                        <tr key={r.line} className={r.errors.length ? "bg-danger-soft/50" : undefined}>
                          <td className="px-3 py-2 align-top text-muted-foreground tabular">{r.line}</td>
                          <td className="px-3 py-2 align-top">{`${r.data.first_name} ${r.data.last_name}`.trim() || "–"}</td>
                          <td className="px-3 py-2 align-top">{r.data.work_email || "–"}</td>
                          <td className="px-3 py-2 align-top">{[r.data.department, r.data.position].filter(Boolean).join(" / ") || "–"}</td>
                          <td className="px-3 py-2 align-top">
                            {r.errors.length ? (
                              <ul className="space-y-0.5 text-danger">
                                {r.errors.map((e) => (
                                  <li key={e}>{e}</li>
                                ))}
                              </ul>
                            ) : (
                              <span className="space-y-0.5">
                                <Badge tone="success">Ready</Badge>
                                {r.warnings.map((w) => (
                                  <span key={w} className="block text-xs text-muted-foreground">
                                    {w}
                                  </span>
                                ))}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Checkbox label="Invite everyone who has an email, as" checked={invite} onChange={setInvite} />
                  <Select
                    aria-label="Role for invited people"
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    options={roles}
                    className="w-48"
                  />
                </div>
                <Button
                  disabled={blocked}
                  loading={pending}
                  onClick={() =>
                    start(async () => {
                      setError(null);
                      const r = await importEmployeesCsv(businessId, csv!, invite ? inviteRole : null);
                      if (r.error) return setError(r.error);
                      setSuccess(`Imported ${r.imported} employee${r.imported === 1 ? "" : "s"}.`);
                      setCsv(null);
                      setFileName("");
                      onDone(r.imported ?? 0, r.invited ?? []);
                    })
                  }
                >
                  Import {preview.validCount} employee{preview.validCount === 1 ? "" : "s"}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------
function ResultsList({ results }: { results: InviteOutcome[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const anyLinks = results.some((r) => r.status === "invite_link");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Added</CardTitle>
        {anyLinks && (
          <CardDescription>
            Some invitation emails couldn&apos;t be sent (email isn&apos;t set up yet). Copy their link and send it by WhatsApp or email instead.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {results.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="flex items-center gap-2">
                {r.status === "error" ? (
                  <XCircle className="size-4 text-danger" aria-hidden />
                ) : (
                  <CheckCircle2 className="size-4 text-success" aria-hidden />
                )}
                <span>
                  <span className="">{r.name}</span>
                  {r.email && <span className="text-muted-foreground"> · {r.email}</span>}
                  {r.status === "error" && <span className="block text-danger">{r.detail}</span>}
                </span>
              </span>
              <span className="flex items-center gap-2">
                {r.status === "added" && <Badge>Added</Badge>}
                {r.status === "invited" && <Badge tone="success">Invitation sent</Badge>}
                {r.status === "invite_link" && <Badge tone="warning">Share link</Badge>}
                {r.link && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      await navigator.clipboard.writeText(r.link!);
                      setCopied(r.link!);
                    }}
                  >
                    {copied === r.link ? <Link2 className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                    {copied === r.link ? "Copied" : "Copy link"}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
