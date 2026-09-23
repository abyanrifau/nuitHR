"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { importAttendance, type ImportRow } from "@/lib/time/attendance-actions";
import { cn } from "@/lib/utils";
import { parseCsv, parseXlsx, toDate, toTime } from "./parse";

type Layout = "day" | "punch";
type Mapping = { code: string; date: string; in: string; out: string; stamp: string };

const guess = (headers: string[], words: RegExp) => String(headers.findIndex((h) => words.test(h.toLowerCase())));

/** Turns the file's rows into one row per person per day, using the matched columns. */
function normalise(rows: string[][], layout: Layout, map: Mapping, dayFirst: boolean) {
  const out: ImportRow[] = [];
  const problems: { row: number; message: string }[] = [];
  const cell = (r: string[], i: string) => (i === "" || i === "-1" ? "" : String(r[Number(i)] ?? ""));
  if (layout === "day") {
    rows.forEach((r, i) => {
      const line = i + 2;
      const code = cell(r, map.code).trim();
      const date = toDate(cell(r, map.date), dayFirst);
      const inn = toTime(cell(r, map.in));
      const outT = cell(r, map.out).trim() ? toTime(cell(r, map.out)) : "";
      if (!code) return problems.push({ row: line, message: "No employee number" });
      if (!date) return problems.push({ row: line, message: `The date "${cell(r, map.date)}" isn't readable` });
      if (!inn) return problems.push({ row: line, message: `The time in "${cell(r, map.in)}" isn't readable` });
      if (outT === null) return problems.push({ row: line, message: `The time out "${cell(r, map.out)}" isn't readable` });
      out.push({ row: line, code, date, in: inn, out: outT });
    });
  } else {
    // Every clock punch: the first of the day is the time in, the last the time out.
    const days = new Map<string, { row: number; code: string; date: string; times: string[] }>();
    rows.forEach((r, i) => {
      const line = i + 2;
      const code = cell(r, map.code).trim();
      const stamp = cell(r, map.stamp);
      const date = toDate(map.date && map.date !== "-1" ? cell(r, map.date) : stamp, dayFirst);
      const time = toTime(map.in && map.in !== "-1" ? cell(r, map.in) : stamp);
      if (!code) return problems.push({ row: line, message: "No employee number" });
      if (!date || !time) return problems.push({ row: line, message: `The date or time "${stamp || cell(r, map.date)}" isn't readable` });
      const key = `${code.toLowerCase()}|${date}`;
      const d = days.get(key) ?? { row: line, code, date, times: [] };
      d.times.push(time);
      days.set(key, d);
    });
    for (const d of days.values()) {
      d.times.sort();
      out.push({ row: d.row, code: d.code, date: d.date, in: d.times[0], out: d.times.length > 1 ? d.times[d.times.length - 1] : "" });
    }
  }
  return { rows: out, problems };
}

export function ImportWizard({ dayFirst }: { dayFirst: boolean }) {
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [layout, setLayout] = useState<Layout>("day");
  const [map, setMap] = useState<Mapping>({ code: "", date: "", in: "", out: "", stamp: "" });
  const [check, setCheck] = useState<{ valid: number; errors: { row: number; message: string }[] } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const load = (file: File | undefined) => {
    if (!file) return;
    start(async () => {
      try {
        const rows = /\.xlsx$/i.test(file.name) ? await parseXlsx(await file.arrayBuffer()) : parseCsv(await file.text());
        if (rows.length < 2) return void toast.error("That file has no rows under the headings.");
        if (rows.length > 20001) return void toast.error("That file is too big. Split it into smaller files (up to 20,000 rows).");
        const h = rows[0].map((x, i) => String(x).trim() || `Column ${i + 1}`);
        setFileName(file.name);
        setHeaders(h);
        setData(rows.slice(1));
        setCheck(null);
        setDone(null);
        const code = guess(h, /(emp|staff|badge|user|person).*(no|id|code|number)|^(id|code|no\.?|ac-?no\.?|enroll)/);
        const date = guess(h, /date|day/);
        const inn = guess(h, /(^|[^a-z])(in|start|arrive|check.?in|clock.?in)([^a-z]|$)/);
        const out = guess(h, /(^|[^a-z])(out|end|leave|check.?out|clock.?out)([^a-z]|$)/);
        const stamp = guess(h, /(time|stamp|punch|datetime|date.?time)/);
        const punches = inn === "-1" && out === "-1";
        setLayout(punches ? "punch" : "day");
        setMap({ code, date: punches && date === stamp ? "-1" : date, in: punches ? "-1" : inn, out, stamp });
      } catch {
        toast.error("That file couldn't be read. Save it as CSV or Excel (.xlsx) and try again.");
      }
    });
  };

  const prepared = useMemo(() => (headers.length ? normalise(data, layout, map, dayFirst) : null), [data, layout, map, dayFirst, headers.length]);

  const runCheck = () =>
    start(async () => {
      if (!prepared) return;
      if (prepared.rows.length > 5000) return void toast.error("Import up to 5,000 days at a time. Split the file by month.");
      const r = await importAttendance(prepared.rows, true);
      if (r.error) return void toast.error(r.error);
      setCheck({ valid: r.valid ?? 0, errors: [...prepared.problems, ...(r.errors ?? [])].sort((a, b) => a.row - b.row) });
    });

  const runImport = () =>
    start(async () => {
      if (!prepared || !check) return;
      const bad = new Set(check.errors.map((e) => e.row));
      const r = await importAttendance(
        prepared.rows.filter((x) => !bad.has(x.row)),
        false,
      );
      if (r.error) return void toast.error(r.error);
      setDone(r.imported ?? 0);
      toast.success(r.message ?? "Imported.");
    });

  const pick = (label: string, key: keyof Mapping, optional = false) => (
    <Field label={label} htmlFor={`map-${key}`} optional={optional}>
      <Select
        id={`map-${key}`}
        value={map[key]}
        onChange={(e) => {
          setMap({ ...map, [key]: e.target.value });
          setCheck(null);
        }}
        options={[{ value: "-1", label: optional ? "Not in the file" : "Choose a column" }, ...headers.map((h, i) => ({ value: String(i), label: h }))]}
      />
    </Field>
  );

  if (done !== null) {
    return (
      <Alert tone="success" title={`${done} ${done === 1 ? "day" : "days"} imported`}>
        Lateness, hours and overtime were worked out from the imported times. <Link href="/app/time/register" className="underline underline-offset-4">See the attendance register</Link>.
      </Alert>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg">1. Choose the file</h2>
        <label className={cn(buttonClasses({ variant: "secondary" }), "cursor-pointer")}>
          <FileUp className="size-4" aria-hidden /> {fileName || "Choose a CSV or Excel file"}
          <input type="file" accept=".csv,.txt,.xlsx" className="sr-only" onChange={(e) => load(e.target.files?.[0])} />
        </label>
        <p className="text-[13px] text-muted-foreground">
          Export from the fingerprint or face machine&apos;s software. The first row must be the column headings. Employee numbers must match the ones in Harbor.
        </p>
      </section>

      {headers.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-lg">2. Match the columns</h2>
          <fieldset className="flex flex-wrap gap-3 text-sm">
            {(
              [
                ["day", "One row per person per day (time in and time out)"],
                ["punch", "One row per clock punch (the machine lists every punch)"],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2", layout === k ? "border-foreground" : "border-border text-muted-foreground")}>
                <input type="radio" name="layout" checked={layout === k} onChange={() => (setLayout(k), setCheck(null))} />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {pick("Employee number", "code")}
            {layout === "day" ? (
              <>
                {pick("Date", "date")}
                {pick("Time in", "in")}
                {pick("Time out", "out", true)}
              </>
            ) : (
              <>
                {pick("Date and time of the punch", "stamp")}
                {pick("Date (if in its own column)", "date", true)}
                {pick("Time (if in its own column)", "in", true)}
              </>
            )}
          </div>
          <p className="text-[12px] text-subtle-foreground">
            Dates like 05/02/2026 are read as {dayFirst ? "day/month/year" : "month/day/year"}, like your company&apos;s date format. {layout === "punch" && "The first punch of a day is the time in and the last is the time out."}
            {layout === "day" && " A time out earlier than the time in is read as the next morning (a night shift)."}
          </p>
          {prepared && (
            <div>
              <h3 className="mb-2 text-sm text-foreground">
                Preview: {prepared.rows.length} {prepared.rows.length === 1 ? "day" : "days"} from {data.length} rows
              </h3>
              <Table>
                <thead>
                  <tr>
                    <Th>Row</Th>
                    <Th>Employee no.</Th>
                    <Th>Date</Th>
                    <Th>In</Th>
                    <Th>Out</Th>
                  </tr>
                </thead>
                <tbody>
                  {prepared.rows.slice(0, 8).map((r) => (
                    <Tr key={`${r.row}-${r.code}-${r.date}`}>
                      <Td className="text-subtle-foreground tabular">{r.row}</Td>
                      <Td>{r.code}</Td>
                      <Td className="tabular">{r.date}</Td>
                      <Td className="tabular">{r.in}</Td>
                      <Td className="tabular">{r.out || "–"}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
          <Button onClick={runCheck} loading={pending} disabled={!prepared?.rows.length}>
            Check the file
          </Button>
        </section>
      )}

      {check && (
        <section className="space-y-4">
          <h2 className="text-lg">3. Check and import</h2>
          <p className="text-sm">
            <span className="text-foreground">{check.valid} {check.valid === 1 ? "day is" : "days are"} ready to import.</span>{" "}
            {check.errors.length > 0 && <span className="text-danger">{check.errors.length} rows have problems and will be skipped.</span>}
          </p>
          {check.errors.length > 0 && (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
              {check.errors.map((e, i) => (
                <li key={i} className="flex gap-3 px-3 py-2">
                  <span className="w-16 shrink-0 text-subtle-foreground tabular">Row {e.row}</span>
                  <span>{e.message}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[13px] text-muted-foreground">Importing replaces the times already saved for the same person and day. Each imported day is marked as imported in its history.</p>
          <Button onClick={runImport} loading={pending} disabled={!check.valid}>
            Import {check.valid} {check.valid === 1 ? "day" : "days"}
          </Button>
        </section>
      )}
    </div>
  );
}
