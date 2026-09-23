"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Paperclip, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { decideClaim, markClaimsPaid, receiptLink } from "@/lib/claims/actions";

interface Row {
  id: string;
  employeeId: string;
  person: string;
  type: string;
  date: string;
  amount: string;
  status: string;
  detail: string;
  receipt: string | null;
  payout: string;
  inRun: boolean;
  late: boolean;
  note: string | null;
  decidable: boolean;
}

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  pending: { label: "Waiting", tone: "warning" },
  approved: { label: "To be paid", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export function ClaimsTable({ rows: loaded, tab, canPay }: { rows: Row[]; tab: string; canPay: boolean }) {
  // New statuses show straight away; if saving fails they go back.
  const [rows, patch] = useOptimistic(loaded, (list, change: { ids: string[]; status: string }) =>
    list.map((r) => (change.ids.includes(r.id) ? { ...r, status: change.status, decidable: false } : r)),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [declining, setDeclining] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [paying, setPaying] = useState(false);
  const [reference, setReference] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const payable = rows.filter((r) => r.status === "approved" && !r.inRun);
  const run = (fn: () => Promise<{ error?: string; message?: string }>, after?: () => void, optimistic?: { ids: string[]; status: string }) =>
    start(async () => {
      if (optimistic) {
        patch(optimistic);
        after?.();
      }
      const r = await fn();
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Done.");
      after?.();
      router.refresh();
    });

  const openReceipt = (path: string) =>
    start(async () => {
      const r = await receiptLink(path);
      if (r.url) window.open(r.url, "_blank", "noopener");
      else toast.error(r.error ?? "Couldn't open the receipt.");
    });

  return (
    <>
      {tab === "to_pay" && canPay && payable.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-muted-foreground">Claims not going through payroll can be marked paid once you&apos;ve paid them.</span>
          <Button size="sm" disabled={!selected.size} onClick={() => setPaying(true)}>
            Mark {selected.size || ""} as paid
          </Button>
        </div>
      )}
      <Table>
        <thead>
          <tr>
            {tab === "to_pay" && canPay && (
              <Th>
                <span className="sr-only">Select</span>
              </Th>
            )}
            <Th>Person</Th>
            <Th className="hidden md:table-cell">Claim</Th>
            <Th className="text-right">Amount</Th>
            <Th>Status</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = STATUS[r.status] ?? STATUS.pending;
            const canSelect = r.status === "approved" && !r.inRun;
            return (
              <Tr key={r.id}>
                {tab === "to_pay" && canPay && (
                  <Td>
                    {canSelect && (
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.person}'s claim`}
                        checked={selected.has(r.id)}
                        onChange={() =>
                          setSelected((x) => {
                            const n = new Set(x);
                            if (n.has(r.id)) n.delete(r.id);
                            else n.add(r.id);
                            return n;
                          })
                        }
                      />
                    )}
                  </Td>
                )}
                <Td>
                  <Link href={`/app/people/${r.employeeId}`} className="block text-foreground hover:underline">
                    {r.person}
                  </Link>
                  <span className="block text-[12px] text-subtle-foreground md:hidden">
                    {r.type} · {r.date}
                  </span>
                </Td>
                <Td className="hidden md:table-cell">
                  <span className="block text-foreground">
                    {r.type} <span className="text-muted-foreground tabular">· {r.date}</span>
                  </span>
                  {r.detail && <span className="block text-[12px] text-subtle-foreground">{r.detail}</span>}
                </Td>
                <Td className="text-right tabular">{r.amount}</Td>
                <Td>
                  <StatusDot tone={s.tone}>{s.label}</StatusDot>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {r.status === "approved" && <Badge>{r.inRun ? "On a pay run" : r.payout === "payroll" ? "Next payroll" : "Pay separately"}</Badge>}
                    {r.late && r.status !== "paid" && <Badge>After cut-off</Badge>}
                  </span>
                  {r.note && <span className="block text-[12px] text-subtle-foreground">{r.note}</span>}
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {r.receipt && (
                    <Button variant="ghost" size="sm" aria-label="Open receipt" disabled={pending} onClick={() => openReceipt(r.receipt!)}>
                      <Paperclip className="size-3.5" aria-hidden />
                    </Button>
                  )}
                  {r.status === "pending" && r.decidable && (
                    <>
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => decideClaim(r.id, "approve"), undefined, { ids: [r.id], status: "approved" })}>
                        <Check className="size-3.5" aria-hidden /> Approve
                      </Button>
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => setDeclining(r.id)}>
                        <X className="size-3.5" aria-hidden /> Decline
                      </Button>
                    </>
                  )}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>

      <Modal open={Boolean(declining)} onClose={() => setDeclining(null)} title="Decline claim" description="They'll see your note.">
        <div className="space-y-4">
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder="For example the receipt is unreadable, please send a clearer photo" />
          <Button
            variant="danger"
            loading={pending}
            onClick={() => (note.trim() ? run(() => decideClaim(declining!, "reject", note), () => setDeclining(null), { ids: [declining!], status: "rejected" }) : toast.error("Add a short note so they know why."))}
          >
            Decline
          </Button>
        </div>
      </Modal>
      <Modal open={paying} onClose={() => setPaying(false)} title={`Mark ${selected.size} as paid`} description="For claims paid in cash or by bank transfer, outside payroll.">
        <div className="space-y-4">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference, for example bank transfer number" aria-label="Reference" />
          <Button
            loading={pending}
            onClick={() =>
              run(
                () => markClaimsPaid([...selected], reference),
                () => {
                  setPaying(false);
                  setSelected(new Set());
                },
                { ids: [...selected], status: "paid" },
              )
            }
          >
            Mark as paid
          </Button>
        </div>
      </Modal>
    </>
  );
}
