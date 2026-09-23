"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Paperclip } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getBrowserClient } from "@/lib/supabase/lazy-client";
import { attachLeaveDocument, previewLeave, requestLeave, type LeavePreview } from "@/lib/leave/actions";
import { num, ruleLines, type MyLeaveType } from "@/lib/leave/rules";

const HALVES = [
  { value: "full", label: "Full day" },
  { value: "first_half", label: "Morning only" },
  { value: "second_half", label: "Afternoon only" },
];

async function upload(file: File, businessId: string, employeeId: string): Promise<{ path?: string; error?: string }> {
  if (file.size > 10 * 1024 * 1024) return { error: "The document must be smaller than 10 MB." };
  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-60);
  const path = `${businessId}/leave/${employeeId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await (await getBrowserClient()).storage.from("tenant-files").upload(path, file, { contentType: file.type || undefined });
  return error ? { error: "The document didn't upload. Check your connection and try again." } : { path };
}

/** What's left of a type, in words. */
function left(t: MyLeaveType) {
  if (t.available === null) return "No limit";
  return `${num(t.available)} ${Number(t.available) === 1 ? "day" : "days"} left`;
}

export function LeaveRequestForm({ businessId, employeeId, today, types }: { businessId: string; employeeId: string; today: string; types: MyLeaveType[] }) {
  const [type, setType] = useState(types[0]?.id ?? "");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [startHalf, setStartHalf] = useState("full");
  const [endHalf, setEndHalf] = useState("full");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [checked, setChecked] = useState<{ key: string; result: LeavePreview } | null>(null);
  // Goes up after each request is sent, so the same dates are checked again against the new balance.
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start_] = useTransition();
  const router = useRouter();
  const t = types.find((x) => x.id === type);
  const single = start === end;
  const documentPossible = t?.rules.document_rule !== "none";
  const key = [type, start, end, startHalf, endHalf, file ? "doc" : "", sent].join("|");
  // The last check, while it still matches what's on screen.
  const preview = checked?.key === key ? checked.result : null;
  const checking = !preview;

  // Checks the request against the type's rules as it's filled in.
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      const r = await previewLeave(
        { leave_type_id: type, start_date: start, end_date: end < start ? start : end, start_half: t?.allow_half_day ? startHalf : "full", end_half: t?.allow_half_day ? endHalf : "full" },
        Boolean(file),
      );
      if (alive) setChecked({ key, result: r });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, type, start, end, startHalf, endHalf, file, t?.allow_half_day]);

  const blocked = Boolean(preview && !preview.ok);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start_(async () => {
      let attachment: string | undefined;
      if (file) {
        const up = await upload(file, businessId, employeeId);
        if (up.error) return setError(up.error);
        attachment = up.path;
      }
      const r = await requestLeave({
        leave_type_id: type,
        start_date: start,
        end_date: end < start ? start : end,
        start_half: t?.allow_half_day ? startHalf : "full",
        end_half: t?.allow_half_day ? endHalf : "full",
        reason,
        attachment_path: attachment,
      });
      if (r.error) return setError(r.error);
      toast.success(r.message ?? "Sent.");
      setReason("");
      setFile(null);
      setSent((n) => n + 1);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Type" htmlFor="lv-type">
        <Select
          id="lv-type"
          options={types.map((x) => ({ value: x.id, label: `${x.name} · ${left(x)}` }))}
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setFile(null);
          }}
        />
      </Field>

      {t && (
        <div className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display text-2xl tabular">{t.available === null ? "No limit" : num(t.available)}</p>
            <p className="text-[12px] text-subtle-foreground">
              {t.available === null
                ? `${num(t.taken)} used`
                : `days left · ${num(t.taken)} used${Number(t.pending) > 0 ? ` · ${num(t.pending)} waiting` : ""}${t.granted > 0 ? ` · includes ${num(t.granted)} given by HR` : ""}`}
            </p>
          </div>
          {t.mode !== "birthday" && t.available !== null && (
            <p className="text-[12px] text-subtle-foreground">
              Leave year {t.year_starts.split("-").reverse().join("/")} to {t.year_ends.split("-").reverse().join("/")}
            </p>
          )}
          <ul className="mt-3 space-y-1 text-[13px] text-muted-foreground">
            {ruleLines(t).map((l) => (
              <li key={l} className="flex gap-2">
                <span aria-hidden className="text-subtle-foreground">·</span>
                {l}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="First day" htmlFor="lv-start">
          <Input
            id="lv-start"
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (end < e.target.value) setEnd(e.target.value);
            }}
          />
        </Field>
        <Field label="Last day" htmlFor="lv-end">
          <Input id="lv-end" type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
      </div>
      {t?.allow_half_day && (
        <div className="grid grid-cols-2 gap-3">
          <Field label={single ? "How long" : "First day"} htmlFor="lv-sh">
            <Select id="lv-sh" options={single ? HALVES : HALVES.filter((h) => h.value !== "first_half")} value={startHalf} onChange={(e) => setStartHalf(e.target.value)} />
          </Field>
          {!single && (
            <Field label="Last day" htmlFor="lv-eh">
              <Select id="lv-eh" options={HALVES.filter((h) => h.value !== "second_half")} value={endHalf} onChange={(e) => setEndHalf(e.target.value)} />
            </Field>
          )}
        </div>
      )}
      <Field label="Note" htmlFor="lv-reason" optional>
        <Textarea id="lv-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Anything your manager should know" />
      </Field>
      {documentPossible && (
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-muted-foreground">
          <Paperclip className="size-4" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file ? file.name : "Add a document, for example a medical certificate"}</span>
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      )}

      <div aria-live="polite">
        {blocked ? (
          <Alert tone="warning">{preview!.error}</Alert>
        ) : preview?.ok ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span>
              Uses {num(preview.days ?? 0)} {preview.days === 1 ? "day" : "days"}.
              {preview.document === "later" && preview.document_due && ` A document is needed: add it by ${preview.document_due.split("-").reverse().join("/")}, or the days become unapproved absences.`}
            </span>
          </p>
        ) : null}
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={pending} disabled={!type || blocked || checking}>
          Send request
        </Button>
      </div>
    </form>
  );
}

/** Adds the document to time off already asked for. */
export function AddDocumentButton({ requestId, businessId, employeeId }: { requestId: string; businessId: string; employeeId: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[13px] text-foreground hover:bg-accent-soft ${pending ? "opacity-60" : ""}`}>
      <Paperclip className="size-3.5" aria-hidden />
      {pending ? "Adding…" : "Add document"}
      <input
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        disabled={pending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          start(async () => {
            const up = await upload(file, businessId, employeeId);
            if (up.error) return void toast.error(up.error);
            const r = await attachLeaveDocument(requestId, up.path!);
            if (r.error) return void toast.error(r.error);
            toast.success(r.message ?? "Added.");
            router.refresh();
          });
        }}
      />
    </label>
  );
}
