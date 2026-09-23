"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Paperclip } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getBrowserClient } from "@/lib/supabase/lazy-client";
import { previewLeaveDays, requestLeave } from "@/lib/leave/actions";

const HALVES = [
  { value: "full", label: "Full day" },
  { value: "first_half", label: "Morning only" },
  { value: "second_half", label: "Afternoon only" },
];

export function LeaveRequestForm({
  businessId,
  employeeId,
  today,
  types,
}: {
  businessId: string;
  employeeId: string;
  today: string;
  types: { id: string; name: string; halfDays: boolean; needsDocument: boolean }[];
}) {
  const [type, setType] = useState(types[0]?.id ?? "");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [startHalf, setStartHalf] = useState("full");
  const [endHalf, setEndHalf] = useState("full");
  const [reason, setReason] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start_] = useTransition();
  const router = useRouter();
  const t = types.find((x) => x.id === type);
  const single = start === end;

  // Show how many days this uses as the dates change.
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(async () => {
      const r = await previewLeaveDays({ leave_type_id: type, start_date: start, end_date: end < start ? start : end, start_half: startHalf, end_half: endHalf });
      if (alive) setDays(r.days ?? null);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [type, start, end, startHalf, endHalf]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start_(async () => {
      let attachment: string | undefined;
      if (file) {
        if (file.size > 10 * 1024 * 1024) return setError("The document must be smaller than 10 MB.");
        const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-60);
        attachment = `${businessId}/leave/${employeeId}/${crypto.randomUUID()}-${safe}`;
        const { error: up } = await (await getBrowserClient()).storage.from("tenant-files").upload(attachment, file, { contentType: file.type || undefined });
        if (up) return setError("The document didn't upload. Check your connection and try again.");
      }
      const r = await requestLeave({
        leave_type_id: type,
        start_date: start,
        end_date: end < start ? start : end,
        start_half: startHalf,
        end_half: endHalf,
        reason,
        attachment_path: attachment,
      });
      if (r.error) return setError(r.error);
      toast.success(r.message ?? "Sent.");
      setReason("");
      setFile(null);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Type" htmlFor="lv-type">
        <Select id="lv-type" options={types.map((x) => ({ value: x.id, label: x.name }))} value={type} onChange={(e) => setType(e.target.value)} />
      </Field>
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
      {t?.halfDays && (
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
      {t?.needsDocument && (
        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-muted-foreground">
          <Paperclip className="size-4" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file ? file.name : "Add a document, for example a medical certificate"}</span>
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {days === null ? "" : days === 0 ? "No working days in those dates" : `Uses ${days} ${days === 1 ? "day" : "days"}`}
        </p>
        <Button type="submit" loading={pending} disabled={!type || days === 0}>
          Send request
        </Button>
      </div>
    </form>
  );
}
