"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { Textarea } from "@/components/ui/textarea";
import { decideRequests } from "@/lib/requests/actions";

export interface InboxItem {
  id: string;
  request_type: string;
  title: string;
  summary: string | null;
  amount: number | null;
  submitted_at: string;
  employee_name: string | null;
  requested_by_name: string | null;
  step_order: number;
  total_steps: number;
  via: "you" | "role" | "stand-in" | "admin";
}

type Item = InboxItem & { when: string; amountText: string | null; typeLabel: string };

const VIA: Record<Item["via"], string | null> = {
  you: null,
  role: "Sent to your role",
  "stand-in": "You're standing in",
  admin: "You can step in",
};

export function Inbox({ items }: { items: Item[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [declining, setDeclining] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  if (items.length === 0) {
    return <EmptyState title="Nothing waiting for you" description="When someone asks for time off, a claim or a letter and it needs your decision, it shows up here." />;
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const all = selected.size === items.length;

  const decide = (ids: string[], decision: "approve" | "reject", comment?: string) =>
    start(async () => {
      const r = await decideRequests({ ids, decision, comment });
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.message ?? "Done.");
        if (r.failed?.length) toast.error(r.failed[0].error);
        setSelected(new Set());
        setDeclining(null);
        setNote("");
        router.refresh();
      }
    });

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-2.5 text-sm">
        <label className="flex items-center gap-2 text-muted-foreground">
          <input type="checkbox" checked={all} onChange={() => setSelected(all ? new Set() : new Set(items.map((i) => i.id)))} aria-label="Select all" />
          {selected.size ? `${selected.size} selected` : `${items.length} waiting`}
        </label>
        {selected.size > 0 && (
          <span className="ml-auto flex gap-2">
            <Button size="sm" loading={pending} onClick={() => decide([...selected], "approve")}>
              <Check className="size-3.5" aria-hidden /> Approve {selected.size}
            </Button>
            <Button size="sm" variant="danger" disabled={pending} onClick={() => setDeclining([...selected])}>
              Decline {selected.size}
            </Button>
          </span>
        )}
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-start gap-3 px-4 py-4 sm:flex-nowrap">
            <input type="checkbox" className="mt-1" checked={selected.has(i.id)} onChange={() => toggle(i.id)} aria-label={`Select ${i.title}`} />
            <div className="min-w-0 flex-1">
              <p className="text-foreground">{i.title}</p>
              <p className="text-[13px] text-muted-foreground">
                {i.employee_name || i.requested_by_name} · {i.typeLabel}
                {i.amountText && <span className="tabular"> · {i.amountText}</span>}
              </p>
              {i.summary && <p className="mt-1 text-sm text-muted-foreground">{i.summary}</p>}
              <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-subtle-foreground">
                <span className="tabular">{i.when}</span>
                {i.total_steps > 1 && (
                  <Badge>
                    Step {i.step_order} of {i.total_steps}
                  </Badge>
                )}
                {VIA[i.via] && <Badge>{VIA[i.via]}</Badge>}
              </p>
            </div>
            <div className="flex w-full gap-2 pl-7 sm:w-auto sm:pl-0">
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => decide([i.id], "approve")}>
                <Check className="size-3.5" aria-hidden /> Approve
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining([i.id])}>
                <X className="size-3.5" aria-hidden /> Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Modal
        open={Boolean(declining)}
        onClose={() => setDeclining(null)}
        title={declining && declining.length > 1 ? `Decline ${declining.length} requests` : "Decline request"}
        description="They'll see your note, so they know why and what to do next."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!note.trim()) return toast.error("Add a short note so they know why.");
            decide(declining!, "reject", note.trim());
          }}
          className="space-y-4"
        >
          <label htmlFor="decline-note" className="text-[13px] text-muted-foreground">
            Note
          </label>
          <Textarea id="decline-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: we're short-staffed that week, could you move it to the following week?" autoFocus />
          <div className="flex gap-3">
            <Button type="submit" variant="danger" loading={pending}>
              Decline
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeclining(null)}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
