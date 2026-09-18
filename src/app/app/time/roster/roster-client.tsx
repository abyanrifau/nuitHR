"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { copyLastWeek, publishWeek, setRosterCell } from "@/lib/time/actions";
import { cn } from "@/lib/utils";

interface Day {
  date: string;
  label: string;
  today: boolean;
  workday: boolean;
  holiday: string | null;
}

export function RosterWeekActions({ weekStart, unpublished }: { weekStart: string; unpublished: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.error) toast.error(r.error);
      else {
        if (r.message) toast.success(r.message);
        router.refresh();
      }
    });
  return (
    <span className="ml-auto flex gap-2">
      <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => copyLastWeek(weekStart))}>
        <Copy className="size-3.5" aria-hidden /> Copy last week
      </Button>
      <Button size="sm" disabled={pending || unpublished === 0} onClick={() => run(() => publishWeek(weekStart))}>
        <Send className="size-3.5" aria-hidden /> {unpublished ? `Publish ${unpublished} changes` : "Published"}
      </Button>
    </span>
  );
}

/** A week of shifts, one row per person. Changing a cell saves straight away. */
export function RosterGrid({
  canEdit,
  days,
  people,
  shifts,
  entries,
  leave,
}: {
  canEdit: boolean;
  days: Day[];
  people: { id: string; name: string }[];
  shifts: { id: string; label: string; name: string; color: string; time: string }[];
  entries: { employee_id: string; work_date: string; value: string; published: boolean }[];
  leave: { employee_id: string; start: string; end: string }[];
}) {
  const [cells, setCells] = useState(() => new Map(entries.map((e) => [`${e.employee_id}|${e.work_date}`, e])));
  const [, start] = useTransition();
  const router = useRouter();
  const shiftBy = new Map(shifts.map((s) => [s.id, s]));
  const onLeave = (emp: string, d: string) => leave.some((l) => l.employee_id === emp && l.start <= d && l.end >= d);

  const change = (employee_id: string, work_date: string, value: string) => {
    const key = `${employee_id}|${work_date}`;
    const prev = cells.get(key);
    setCells((m) => {
      const n = new Map(m);
      if (value) n.set(key, { employee_id, work_date, value, published: false });
      else n.delete(key);
      return n;
    });
    start(async () => {
      const r = await setRosterCell({ employee_id, work_date, value });
      if (r.error) {
        toast.error(r.error);
        setCells((m) => {
          const n = new Map(m);
          if (prev) n.set(key, prev);
          else n.delete(key);
          return n;
        });
      } else router.refresh();
    });
  };

  const counts = days.map((d) => people.filter((p) => {
    const c = cells.get(`${p.id}|${d.date}`);
    return c && c.value && c.value !== "rest";
  }).length);

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 border-b border-border bg-background px-3 py-2 text-left text-[11px] font-normal tracking-[0.12em] text-subtle-foreground uppercase">
                Person
              </th>
              {days.map((d, i) => (
                <th key={d.date} className={cn("border-b border-border px-1.5 py-2 text-center text-[12px] font-normal", d.today ? "text-foreground" : "text-muted-foreground")}>
                  <span className="block">{d.label}</span>
                  <span className="block text-[11px] text-subtle-foreground">{d.holiday ? d.holiday : `${counts[i]} on`}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id} className="hover:bg-accent-soft">
                <td className="sticky left-0 z-10 border-b border-border bg-background px-3 py-1.5 whitespace-nowrap text-foreground">{p.name}</td>
                {days.map((d) => {
                  const c = cells.get(`${p.id}|${d.date}`);
                  const s = c?.value && c.value !== "rest" ? shiftBy.get(c.value) : null;
                  const off = onLeave(p.id, d.date);
                  return (
                    <td key={d.date} className={cn("border-b border-l border-border px-1 py-1", !d.workday && "bg-surface-muted/40")}>
                      {off ? (
                        <span className="block rounded-md px-1.5 py-1.5 text-center text-[12px] text-info">Time off</span>
                      ) : canEdit ? (
                        <select
                          aria-label={`${p.name}, ${d.label}`}
                          value={c?.value ?? ""}
                          onChange={(e) => change(p.id, d.date, e.target.value)}
                          className={cn(
                            "h-9 w-full min-w-[5.5rem] rounded-md border bg-transparent px-1.5 text-[12px]",
                            c?.value ? "border-border-strong text-foreground" : "border-transparent text-subtle-foreground",
                            c && !c.published && "border-dashed",
                          )}
                          style={s ? { boxShadow: `inset 3px 0 0 ${s.color}` } : undefined}
                        >
                          <option value="">·</option>
                          {shifts.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.label} {x.time}
                            </option>
                          ))}
                          <option value="rest">Rest day</option>
                        </select>
                      ) : (
                        <span className="block px-1.5 py-1.5 text-center text-[12px] text-muted-foreground">{c?.value === "rest" ? "Rest" : (s?.label ?? "")}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[13px] text-subtle-foreground">A dashed outline means the change isn&apos;t published yet. Staff only see published shifts.</p>
      <ul className="mt-3 flex flex-wrap gap-3 text-[12px] text-muted-foreground">
        {shifts.map((s) => (
          <li key={s.id} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden /> {s.name} {s.time}
          </li>
        ))}
      </ul>
    </div>
  );
}
