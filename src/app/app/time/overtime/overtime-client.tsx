"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { decideOvertime } from "@/lib/time/attendance-actions";
import { hm } from "@/lib/time/day-status";

export interface OvertimeRow {
  id: string;
  person: string;
  photo: string | null;
  employeeId: string;
  day: string;
  type: string;
  minutes: number;
  state: "approved" | "pending" | "rejected";
}

const STATE = {
  approved: { label: "Counted", tone: "success" },
  pending: { label: "Waiting", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
} as const;

export function OvertimeTable({ rows: loaded, canDecide }: { rows: OvertimeRow[]; canDecide: boolean }) {
  const [rows, patch] = useOptimistic(loaded, (list, change: { ids: string[]; state: OvertimeRow["state"] }) =>
    list.map((r) => (change.ids.includes(r.id) ? { ...r, state: change.state } : r)),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [, start] = useTransition();
  const router = useRouter();
  const decide = (ids: string[], decision: "approved" | "rejected") =>
    start(async () => {
      patch({ ids, state: decision });
      setSelected(new Set());
      const r = await decideOvertime(ids, decision);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Done.");
      router.refresh();
    });
  const waiting = rows.filter((r) => r.state === "pending");
  return (
    <>
      {canDecide && waiting.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border px-4 py-2.5 text-sm">
          <label className="flex items-center gap-2 text-muted-foreground">
            <input
              type="checkbox"
              checked={selected.size === waiting.length}
              onChange={() => setSelected(selected.size === waiting.length ? new Set() : new Set(waiting.map((w) => w.id)))}
              aria-label="Choose all waiting"
            />
            {selected.size ? `${selected.size} chosen` : `${waiting.length} waiting`}
          </label>
          {selected.size > 0 && (
            <span className="ml-auto flex gap-2">
              <Button size="sm" onClick={() => decide([...selected], "approved")}>
                <Check className="size-3.5" aria-hidden /> Approve {selected.size}
              </Button>
              <Button size="sm" variant="danger" onClick={() => decide([...selected], "rejected")}>
                Reject {selected.size}
              </Button>
            </span>
          )}
        </div>
      )}
      <Table>
        <thead>
          <tr>
            {canDecide && <Th className="w-8" />}
            <Th>Person</Th>
            <Th>Day</Th>
            <Th className="hidden sm:table-cell">Kind of day</Th>
            <Th className="text-right">Overtime</Th>
            <Th>Status</Th>
            {canDecide && (
              <Th>
                <span className="sr-only">Decide</span>
              </Th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              {canDecide && (
                <Td>
                  {r.state === "pending" && (
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          return n;
                        })
                      }
                      aria-label={`Choose ${r.person}, ${r.day}`}
                    />
                  )}
                </Td>
              )}
              <Td>
                <Link href={`/app/people/${r.employeeId}?tab=time`} className="flex items-center gap-2 hover:underline">
                  <Avatar name={r.person} path={r.photo} size="xs" />
                  {r.person}
                </Link>
              </Td>
              <Td className="tabular">{r.day}</Td>
              <Td className="hidden text-muted-foreground sm:table-cell">{r.type}</Td>
              <Td className="text-right tabular">{hm(r.minutes)}</Td>
              <Td>
                <StatusDot tone={STATE[r.state].tone}>{STATE[r.state].label}</StatusDot>
              </Td>
              {canDecide && (
                <Td className="text-right whitespace-nowrap">
                  {r.state !== "approved" && (
                    <Button variant="ghost" size="sm" onClick={() => decide([r.id], "approved")}>
                      <Check className="size-3.5" aria-hidden /> Approve
                    </Button>
                  )}
                  {r.state !== "rejected" && (
                    <Button variant="ghost" size="sm" onClick={() => decide([r.id], "rejected")}>
                      <X className="size-3.5" aria-hidden /> Reject
                    </Button>
                  )}
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
