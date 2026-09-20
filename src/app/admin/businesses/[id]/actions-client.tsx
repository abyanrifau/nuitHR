"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionForm, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/errors";
import {
  addNote,
  deleteBusiness,
  extendSubscription,
  extendTrial,
  openAsSupport,
  receiptLink,
  recordPayment,
  sendReminder,
  setPlanStatus,
  setPrice,
  setTools,
} from "@/lib/platform/actions";

export interface AdminBusinessView {
  id: string;
  name: string;
  timezone: string;
  planStatus: string;
  status: string;
  trialEndsAt: string | null;
  paidUntil: string | null;
  customPrice: number | null;
  discount: number | null;
  priceUntil: string | null;
  monthlyPrice: number;
  modules: string[];
  supportUntil: string | null;
}

type Kind = "trial" | "subscription" | "status" | "tools" | "price" | "payment" | "reminder" | "note" | "support" | "delete";

const localDate = (iso: string | null, tz: string) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso)) : "");
function plusMonths(day: string, n: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Closes the open action form once an action succeeds. */
const CloseForm = createContext<() => void>(() => {});

/** The reason box every action needs, and a clear "Confirm" button. */
function Confirm({ children, label, onConfirm, needsReason = true }: { children?: ReactNode; label: string; onConfirm: (reason: string) => Promise<ActionResult>; needsReason?: boolean }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const close = useContext(CloseForm);
  return (
    <div className="space-y-4">
      {children}
      {needsReason && (
        <Field label="Reason" htmlFor="adm-reason" hint="Saved in the admin log.">
          <Input id="adm-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example Paid by bank transfer, asked for more time" />
        </Field>
      )}
      <Button
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await onConfirm(reason);
            if (r.error) return void toast.error(r.error);
            toast.success(r.message ?? "Done.");
            close();
            router.refresh();
          })
        }
      >
        {label}
      </Button>
    </div>
  );
}

function ByOrTo({ unit, mode, setMode, amount, setAmount, date, setDate }: { unit: string; mode: "by" | "to"; setMode: (m: "by" | "to") => void; amount: string; setAmount: (v: string) => void; date: string; setDate: (v: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "by"} onChange={() => setMode("by")} className="accent-[var(--color-accent)]" /> Add {unit}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={mode === "to"} onChange={() => setMode("to")} className="accent-[var(--color-accent)]" /> Set a date
        </label>
      </div>
      {mode === "by" ? (
        <Field label={`How many ${unit}`} htmlFor="adm-amount">
          <Input id="adm-amount" type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28" />
        </Field>
      ) : (
        <Field label="New end date" htmlFor="adm-date">
          <Input id="adm-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      )}
    </div>
  );
}

function ExtendForm({ b, kind }: { b: AdminBusinessView; kind: "trial" | "subscription" }) {
  const [mode, setMode] = useState<"by" | "to">("by");
  const [amount, setAmount] = useState(kind === "trial" ? "14" : "1");
  const [date, setDate] = useState("");
  const current = kind === "trial" ? b.trialEndsAt : b.paidUntil;
  return (
    <Confirm
      label={kind === "trial" ? "Confirm new trial end" : "Confirm new paid-until date"}
      onConfirm={(reason) => (kind === "trial" ? extendTrial : extendSubscription)({ businessId: b.id, mode, amount, date: date || undefined, reason })}
    >
      <p className="text-sm text-muted-foreground">
        {kind === "trial" ? "Trial" : "Paid"} currently {current ? `ends ${localDate(current, b.timezone)}` : "has no end date"}. Adding counts from that date, or from today if it has passed.
        {kind === "subscription" && " This also makes their plan active."}
      </p>
      <ByOrTo unit={kind === "trial" ? "days" : "months"} mode={mode} setMode={setMode} amount={amount} setAmount={setAmount} date={date} setDate={setDate} />
    </Confirm>
  );
}

function StatusForm({ b }: { b: AdminBusinessView }) {
  const [status, setStatus] = useState(b.status === "suspended" ? "reactivate" : "suspended");
  const pastDue = b.planStatus !== "trial" && (!b.paidUntil || new Date(b.paidUntil) < new Date());
  return (
    <Confirm label="Confirm status change" onConfirm={(reason) => setPlanStatus({ businessId: b.id, status, reason })}>
      <Field label="New status" htmlFor="adm-status">
        <Select
          id="adm-status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: "suspended", label: "Suspend (read-only, they're emailed)" },
            { value: "reactivate", label: "Reactivate" },
            { value: "active", label: "Active" },
            { value: "trial", label: "Trial" },
            { value: "cancelled", label: "Cancelled (read-only)" },
          ]}
        />
      </Field>
      {(status === "reactivate" || status === "active") && pastDue && (
        <p className="text-[13px] text-warning">Their paid-until date has passed, so they&apos;d go straight back into grace or suspension. Extend their subscription or record a payment too.</p>
      )}
    </Confirm>
  );
}

function ToolsForm({ b, tools }: { b: AdminBusinessView; tools: { key: string; name: string; requires: string[] }[] }) {
  const [on, setOn] = useState<string[]>(b.modules);
  const toggle = (k: string) => setOn((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  return (
    <Confirm label="Confirm tools" onConfirm={(reason) => setTools({ businessId: b.id, modules: on, reason })}>
      <p className="text-sm text-muted-foreground">The foundation tools are always on. Tools that need another one switch it on too.</p>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {tools.map((t) => (
          <label key={t.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={on.includes(t.key)}
              onChange={() => {
                toggle(t.key);
                if (!on.includes(t.key)) setOn((x) => [...new Set([...x, t.key, ...t.requires])]);
              }}
              className="size-4 accent-[var(--color-accent)]"
            />
            {t.name}
          </label>
        ))}
      </div>
    </Confirm>
  );
}

function PriceForm({ b }: { b: AdminBusinessView }) {
  const [kind, setKind] = useState<"standard" | "custom" | "discount">(b.customPrice != null ? "custom" : b.discount != null ? "discount" : "standard");
  const [customPrice, setCustomPrice] = useState(b.customPrice?.toString() ?? "");
  const [discount, setDiscount] = useState(b.discount?.toString() ?? "");
  const [until, setUntil] = useState(b.priceUntil ?? "");
  return (
    <Confirm label="Confirm price" onConfirm={(reason) => setPrice({ businessId: b.id, kind, customPrice: customPrice || undefined, discount: discount || undefined, until, reason })}>
      <Field label="Price" htmlFor="adm-pkind">
        <Select
          id="adm-pkind"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          options={[
            { value: "standard", label: "Standard price (from their tools and staff)" },
            { value: "custom", label: "A custom monthly price" },
            { value: "discount", label: "Standard price with a discount" },
          ]}
        />
      </Field>
      {kind === "custom" && (
        <Field label="Monthly price (MVR)" htmlFor="adm-cprice">
          <Input id="adm-cprice" type="number" min={0} step="0.01" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} className="w-40" />
        </Field>
      )}
      {kind === "discount" && (
        <Field label="Discount (%)" htmlFor="adm-disc">
          <Input id="adm-disc" type="number" min={0} max={100} value={discount} onChange={(e) => setDiscount(e.target.value)} className="w-28" />
        </Field>
      )}
      {kind !== "standard" && (
        <Field label="Until" htmlFor="adm-until" optional hint="After this date they go back to the standard price.">
          <Input id="adm-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </Field>
      )}
    </Confirm>
  );
}

function PaymentForm({ b, onDone }: { b: AdminBusinessView; onDone: () => void }) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: b.timezone }).format(new Date());
  const paidUntil = localDate(b.paidUntil, b.timezone);
  const start = paidUntil && paidUntil >= today ? (() => { const d = new Date(`${paidUntil}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); })() : today;
  const [months, setMonths] = useState(1);
  const [periodStart, setPeriodStart] = useState(start);
  const [periodEnd, setPeriodEnd] = useState(plusMonths(start, 1));
  const router = useRouter();
  return (
    <ActionForm
      action={recordPayment}
      submitLabel="Confirm payment"
      onSuccess={() => {
        onDone();
        router.refresh();
      }}
    >
      <input type="hidden" name="businessId" value={b.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="amount" label="Amount (MVR)" type="number" min={0} step="0.01" defaultValue={String(b.monthlyPrice * months)} key={months} />
        <TextField name="paid_on" label="Paid on" type="date" defaultValue={today} />
        <SelectField
          name="method"
          label="Method"
          options={[
            { value: "bank_transfer", label: "Bank transfer" },
            { value: "mobile_payment", label: "Mobile payment" },
            { value: "cash", label: "Cash" },
            { value: "other", label: "Other" },
          ]}
          defaultValue="bank_transfer"
        />
        <TextField name="reference" label="Reference number" optional />
      </div>
      <Field label="Covers" htmlFor="adm-months">
        <Select
          id="adm-months"
          value={String(months)}
          onChange={(e) => {
            const n = Number(e.target.value);
            setMonths(n);
            setPeriodEnd(plusMonths(periodStart, n));
          }}
          options={[1, 2, 3, 6, 12].map((n) => ({ value: String(n), label: `${n} month${n === 1 ? "" : "s"}` }))}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="period_start" label="Period starts" type="date" value={periodStart} onChange={(e) => { setPeriodStart(e.target.value); setPeriodEnd(plusMonths(e.target.value, months)); }} />
        <TextField name="period_end" label="Period ends" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} hint="Their paid-until date moves to this day." />
      </div>
      <Field label="Receipt" htmlFor="adm-receipt" optional hint="PDF, JPG or PNG, up to 2.5 MB.">
        <input id="adm-receipt" name="receipt" type="file" accept="application/pdf,image/jpeg,image/png" className="block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-border-strong file:bg-surface file:px-3 file:py-1.5 file:text-foreground" />
      </Field>
      <TextareaField name="notes" label="Notes" optional />
    </ActionForm>
  );
}

function ReminderForm({ b }: { b: AdminBusinessView }) {
  const [kind, setKind] = useState<"trial_ending" | "payment_due" | "custom">(b.planStatus === "trial" ? "trial_ending" : "payment_due");
  const [message, setMessage] = useState("");
  return (
    <Confirm label="Send email" needsReason={false} onConfirm={() => sendReminder({ businessId: b.id, kind, message: message || undefined })}>
      <Field label="Email" htmlFor="adm-rkind">
        <Select
          id="adm-rkind"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
          options={[
            { value: "trial_ending", label: "Trial ending" },
            { value: "payment_due", label: "Payment due" },
            { value: "custom", label: "Custom message" },
          ]}
        />
      </Field>
      <Field label={kind === "custom" ? "Message" : "Extra line"} htmlFor="adm-msg" optional={kind !== "custom"}>
        <Textarea id="adm-msg" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <p className="text-[12px] text-subtle-foreground">Goes to the company&apos;s owners.</p>
    </Confirm>
  );
}

function NoteForm({ b }: { b: AdminBusinessView }) {
  const [body, setBody] = useState("");
  return (
    <Confirm label="Save note" needsReason={false} onConfirm={() => addNote({ businessId: b.id, body })}>
      <Field label="Note" htmlFor="adm-note" hint="Only Harbor admins see this.">
        <Textarea id="adm-note" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
      </Field>
    </Confirm>
  );
}

function SupportForm({ b }: { b: AdminBusinessView }) {
  if (!b.supportUntil) {
    return <p className="text-sm text-muted-foreground">This company hasn&apos;t turned on support access. Ask the owner to switch it on in Workspace, Help & support.</p>;
  }
  return (
    <Confirm label="Open their workspace" onConfirm={(reason) => openAsSupport({ businessId: b.id, reason })}>
      <p className="text-sm text-muted-foreground">
        Support access is on until {new Date(b.supportUntil).toLocaleString("en-GB", { timeZone: b.timezone })}. You&apos;ll see their workspace read-only, without pay data, with a
        banner saying you&apos;re viewing as support. This is logged.
      </p>
    </Confirm>
  );
}

function DeleteForm({ b }: { b: AdminBusinessView }) {
  const [name, setName] = useState("");
  const router = useRouter();
  return (
    <Confirm
      label="Delete this company for good"
      onConfirm={async (reason) => {
        const r = await deleteBusiness({ businessId: b.id, confirmName: name, reason });
        if (!r.error) router.push("/admin/businesses");
        return r;
      }}
    >
      <p className="text-sm text-muted-foreground">
        This permanently removes {b.name} and everything in it: staff records, attendance, leave, payroll, claims and uploaded files. Their logins stay, but they will no longer
        belong to this company. <strong className="text-foreground">This cannot be undone.</strong> The admin log keeps a record that you deleted it.
      </p>
      <Field label="Type the company name to confirm" htmlFor="adm-del-name">
        <Input id="adm-del-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={b.name} autoComplete="off" />
      </Field>
    </Confirm>
  );
}

const TITLES: Record<Kind, string> = {
  trial: "Extend trial",
  subscription: "Extend subscription",
  status: "Change status",
  tools: "Tools",
  price: "Price",
  payment: "Record a payment",
  reminder: "Send an email",
  note: "Add a note",
  support: "Support access",
  delete: "Delete company",
};

export function BusinessActions({ business: b, tools }: { business: AdminBusinessView; tools: { key: string; name: string; requires: string[] }[] }) {
  const [open, setOpen] = useState<Kind | null>(null);
  const buttons: Kind[] = ["payment", "subscription", "trial", "status", "price", "tools", "reminder", "note", "support"];
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {buttons.map((k) => (
          <Button key={k} variant={k === "payment" ? "primary" : "secondary"} size="sm" onClick={() => setOpen(k)}>
            {k === "status" ? (b.status === "suspended" ? "Reactivate" : "Suspend or change status") : TITLES[k]}
            {k === "support" && (b.supportUntil ? " (on)" : " (off)")}
          </Button>
        ))}
        <Button variant="danger" size="sm" onClick={() => setOpen("delete")}>
          Delete company
        </Button>
      </div>
      <Modal open={open !== null} onClose={() => setOpen(null)} title={open ? `${TITLES[open]}: ${b.name}` : ""}>
        <CloseForm.Provider value={() => setOpen(null)}>
        {open === "trial" && <ExtendForm b={b} kind="trial" />}
        {open === "subscription" && <ExtendForm b={b} kind="subscription" />}
        {open === "status" && <StatusForm b={b} />}
        {open === "tools" && <ToolsForm b={b} tools={tools} />}
        {open === "price" && <PriceForm b={b} />}
        {open === "payment" && <PaymentForm b={b} onDone={() => setOpen(null)} />}
        {open === "reminder" && <ReminderForm b={b} />}
        {open === "note" && <NoteForm b={b} />}
        {open === "support" && <SupportForm b={b} />}
        {open === "delete" && <DeleteForm b={b} />}
        </CloseForm.Provider>
      </Modal>
    </>
  );
}

export function ReceiptButton({ paymentId }: { paymentId: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await receiptLink(paymentId);
          if (r.error || !r.url) return void toast.error(r.error ?? "Couldn't open it.");
          window.open(r.url, "_blank", "noopener");
        })
      }
    >
      View
    </Button>
  );
}
