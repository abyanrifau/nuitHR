"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { submitClaim } from "@/lib/claims/actions";

interface ClaimType {
  id: string;
  name: string;
  isTransport: boolean;
  max: number | null;
  receipt: boolean;
  cutoff: number | null;
}

export function ClaimForm({ businessId, employeeId, currency, today, types }: { businessId: string; employeeId: string; currency: string; today: string; types: ClaimType[] }) {
  const [typeId, setTypeId] = useState(types[0].id);
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [route, setRoute] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const t = types.find((x) => x.id === typeId)!;
  const late = t.cutoff !== null && Number(today.slice(8)) > t.cutoff;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!amount || Number(amount) <= 0) return setError("Enter the amount.");
    if (t.max && Number(amount) > t.max) return setError(`${t.name} claims can be up to ${currency} ${t.max}.`);
    if (t.receipt && !file) return setError("Add a photo of the receipt.");
    start(async () => {
      let receipt: string | undefined;
      if (file) {
        if (file.size > 10 * 1024 * 1024) return setError("The photo must be smaller than 10 MB.");
        const ext = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        receipt = `${businessId}/claims/${employeeId}/${crypto.randomUUID()}.${ext}`;
        const { error: up } = await createClient().storage.from("tenant-files").upload(receipt, file, { contentType: file.type || undefined });
        if (up) return setError("The receipt didn't upload. Check your connection and try again.");
      }
      const r = await submitClaim({ claim_type_id: typeId, claim_date: date, amount, description, route, receipt_path: receipt });
      if (r.error) return setError(r.error);
      toast.success(r.message ?? "Sent.");
      setAmount("");
      setRoute("");
      setDescription("");
      setFile(null);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Type" htmlFor="cl-type">
        <Select id="cl-type" options={types.map((x) => ({ value: x.id, label: x.name }))} value={typeId} onChange={(e) => setTypeId(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date" htmlFor="cl-date">
          <Input id="cl-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={`Amount (${currency})`} htmlFor="cl-amount" hint={t.max ? `Up to ${t.max}` : undefined}>
          <Input id="cl-amount" type="number" inputMode="decimal" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
      </div>
      {t.isTransport && (
        <Field label="From and to" htmlFor="cl-route" optional>
          <Input id="cl-route" value={route} onChange={(e) => setRoute(e.target.value)} placeholder="For example Malé to Hulhumalé" />
        </Field>
      )}
      <Field label="What it was for" htmlFor="cl-desc" optional>
        <Input id="cl-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="For example taxi to the airport for a guest" />
      </Field>
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border-strong px-4 py-3 text-sm text-muted-foreground">
        <Camera className="size-4" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{file ? file.name : t.receipt ? "Add a photo of the receipt" : "Add a receipt (optional)"}</span>
        <input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {late && <p className="text-[13px] text-subtle-foreground">It&apos;s after this month&apos;s cut-off (day {t.cutoff}), so this will be paid with next month&apos;s pay.</p>}
      <Button type="submit" loading={pending} className="w-full" size="lg">
        Send claim
      </Button>
    </form>
  );
}
