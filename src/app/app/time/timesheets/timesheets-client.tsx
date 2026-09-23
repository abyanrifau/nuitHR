"use client";

import { useOptimistic, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Calculator, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { buildTimesheets, setTimesheetStatus } from "@/lib/time/actions";

const hm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

export function PeriodPicker({ start, end, canBuild }: { start: string; end: string; canBuild: boolean }) {
  const [s, setS] = useState(start);
  const [e, setE] = useState(end);
  const [pending, run] = useTransition();
  const router = useRouter();
  const path = usePathname();
  return (
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="space-y-1.5 text-[13px] text-muted-foreground">
        <span className="block">From</span>
        <Input type="date" value={s} onChange={(x) => setS(x.target.value)} className="w-40" />
      </label>
      <label className="space-y-1.5 text-[13px] text-muted-foreground">
        <span className="block">To</span>
        <Input type="date" value={e} min={s} onChange={(x) => setE(x.target.value)} className="w-40" />
      </label>
      <Button variant="secondary" onClick={() => router.push(`${path}?start=${s}&end=${e}`)}>
        Show
      </Button>
      {canBuild && (
        <Button
          loading={pending}
          onClick={() =>
            run(async () => {
              const r = await buildTimesheets({ start: s, end: e });
              if (r.error) return void toast.error(r.error);
              toast.success(r.message ?? "Done.");
              router.push(`${path}?start=${s}&end=${e}`);
              router.refresh();
            })
          }
        >
          <Calculator className="size-4" aria-hidden /> Add up this period
        </Button>
      )}
    </div>
  );
}

interface Row {
  id: string;
  employeeId: string;
  name: string;
  code: string;
  status: string;
  present: number;
  absent: number;
  worked: number;
  overtime: number;
  late: number;
}

export function TimesheetTable({ rows: loaded, canApprove, period }: { rows: Row[]; canApprove: boolean; period: { start: string; end: string } }) {
  const [pending, run] = useTransition();
  // New statuses show straight away; if saving fails they go back.
  const [rows, patch] = useOptimistic(loaded, (list, change: { ids: string[]; status: Row["status"] }) =>
    list.map((r) => (change.ids.includes(r.id) ? { ...r, status: change.status } : r)),
  );
  const router = useRouter();
  if (!rows.length) {
    return <EmptyState title="Not added up yet" description="Choose the period and select Add up this period. You can add it up again as many times as you like until it's approved." />;
  }
  const open = rows.filter((r) => r.status !== "approved");
  const set = (ids: string[], status: "approved" | "draft") =>
    run(async () => {
      patch({ ids, status });
      const r = await setTimesheetStatus(ids, status);
      if (r.error) toast.error(r.error);
      else {
        toast.success(r.message ?? "Done.");
        router.refresh();
      }
    });
  const exportCsv = () => {
    const lines = [
      ["Employee no.", "Name", "Days present", "Days absent", "Hours worked", "Overtime hours", "Late minutes", "Status"],
      ...rows.map((r) => [r.code, r.name, r.present, r.absent, (r.worked / 60).toFixed(2), (r.overtime / 60).toFixed(2), r.late, r.status]),
    ];
    const csv = "﻿" + lines.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `timesheets-${period.start}-to-${period.end}.csv`;
    a.click();
  };
  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {canApprove && open.length > 0 && (
          <Button size="sm" loading={pending} onClick={() => set(open.map((r) => r.id), "approved")}>
            <Check className="size-3.5" aria-hidden /> Approve all {open.length}
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={exportCsv}>
          <Download className="size-3.5" aria-hidden /> Download CSV
        </Button>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Person</Th>
            <Th className="text-right">Days</Th>
            <Th className="hidden text-right sm:table-cell">Absent</Th>
            <Th className="text-right">Hours</Th>
            <Th className="text-right">Overtime</Th>
            <Th className="hidden text-right md:table-cell">Late</Th>
            <Th>Status</Th>
            {canApprove && (
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td>
                <span className="block text-foreground">{r.name}</span>
                <span className="block text-[12px] text-subtle-foreground tabular">{r.code}</span>
              </Td>
              <Td className="text-right tabular">{r.present}</Td>
              <Td className="hidden text-right tabular sm:table-cell">{r.absent}</Td>
              <Td className="text-right tabular">{hm(r.worked)}</Td>
              <Td className="text-right tabular">{r.overtime ? hm(r.overtime) : ""}</Td>
              <Td className="hidden text-right text-muted-foreground tabular md:table-cell">{r.late ? `${r.late} min` : ""}</Td>
              <Td>
                <StatusDot tone={r.status === "approved" ? "success" : "neutral"}>{r.status === "approved" ? "Approved" : "To check"}</StatusDot>
              </Td>
              {canApprove && (
                <Td className="text-right">
                  <Button variant="ghost" size="sm" disabled={pending} onClick={() => set([r.id], r.status === "approved" ? "draft" : "approved")}>
                    {r.status === "approved" ? "Reopen" : "Approve"}
                  </Button>
                </Td>
              )}
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
