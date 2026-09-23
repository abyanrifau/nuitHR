"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, FileUp } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { importSalaries, type SalaryImportRow } from "@/lib/payroll/salary-actions";
import { cn } from "@/lib/utils";
import { parseCsv, parseXlsx, toDate } from "@/app/app/time/import/parse";

type Mapping = { code: string; salary: string; date: string; basis: string; reason: string };

const guess = (headers: string[], words: RegExp) => String(headers.findIndex((h) => words.test(h.toLowerCase())));

const SAMPLE = "staff number,basic salary,start date,paid,reason\nE001,15000,2026-10-01,monthly,Yearly raise\nE002,450,2026-10-01,daily,\n";

export function SalaryImport({ dayFirst, currency }: { dayFirst: boolean; currency: string }) {
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [data, setData] = useState<string[][]>([]);
  const [map, setMap] = useState<Mapping>({ code: "-1", salary: "-1", date: "-1", basis: "-1", reason: "-1" });
  const [check, setCheck] = useState<{ valid: number; errors: { row: number; message: string }[] } | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const load = (file: File | undefined) => {
    if (!file) return;
    start(async () => {
      try {
        const rows = /\.xlsx$/i.test(file.name) ? await parseXlsx(await file.arrayBuffer()) : parseCsv(await file.text());
        if (rows.length < 2) return void toast.error("That file has no rows under the headings.");
        if (rows.length > 5001) return void toast.error("Import up to 5,000 salaries at a time.");
        const h = rows[0].map((x, i) => String(x).trim() || `Column ${i + 1}`);
        setFileName(file.name);
        setHeaders(h);
        setData(rows.slice(1).filter((r) => r.some((c) => String(c).trim())));
        setCheck(null);
        setDone(null);
        setMap({
          code: guess(h, /(staff|emp|employee).*(no|number|id|code)|^(code|id|no\.?)$/),
          salary: guess(h, /salary|basic|amount|pay/),
          date: guess(h, /date|from|start|effective/),
          basis: guess(h, /paid|basis|per|frequency/),
          reason: guess(h, /reason|note|comment/),
        });
      } catch {
        toast.error("That file couldn't be read. Save it as CSV or Excel (.xlsx) and try again.");
      }
    });
  };

  const prepared = useMemo(() => {
    if (!headers.length) return null;
    const cell = (r: string[], i: string) => (i === "-1" ? "" : String(r[Number(i)] ?? "").trim());
    const rows: SalaryImportRow[] = [];
    const problems: { row: number; message: string }[] = [];
    data.forEach((r, i) => {
      const line = i + 2;
      const rawDate = cell(r, map.date);
      const date = toDate(rawDate, dayFirst);
      if (!cell(r, map.code)) return problems.push({ row: line, message: "No staff number" });
      if (!date) return problems.push({ row: line, message: `The date "${rawDate}" isn't readable` });
      rows.push({ row: line, code: cell(r, map.code), salary: cell(r, map.salary), date, basis: cell(r, map.basis) || undefined, reason: cell(r, map.reason) || undefined });
    });
    return { rows, problems };
  }, [data, map, headers.length, dayFirst]);

  const runCheck = () =>
    start(async () => {
      if (!prepared) return;
      const r = await importSalaries(prepared.rows, true);
      if (r.error) return void toast.error(r.error);
      setCheck({ valid: r.valid ?? 0, errors: [...prepared.problems, ...(r.errors ?? [])].sort((a, b) => a.row - b.row) });
    });

  const runImport = () =>
    start(async () => {
      if (!prepared) return;
      const r = await importSalaries(prepared.rows, false);
      if (r.error) return void toast.error(r.error);
      if (r.errors?.length) return setCheck({ valid: r.valid ?? 0, errors: r.errors });
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
      <Alert tone="success" title={`${done} ${done === 1 ? "salary" : "salaries"} imported`}>
        Each starts on its own date; earlier salaries are kept.{" "}
        <Link href="/app/payroll/salaries" className="underline underline-offset-4">
          Back to salaries
        </Link>
        .
      </Alert>
    );
  }

  const ready = map.code !== "-1" && map.salary !== "-1" && map.date !== "-1";
  const blocking = (check?.errors.length ?? 0) > 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-lg">1. Choose the file</h2>
        <div className="flex flex-wrap gap-2">
          <label className={cn(buttonClasses({ variant: "secondary" }), "cursor-pointer")}>
            <FileUp className="size-4" aria-hidden /> {fileName || "Choose a CSV or Excel file"}
            <input type="file" accept=".csv,.txt,.xlsx" className="sr-only" onChange={(e) => load(e.target.files?.[0])} />
          </label>
          <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="salaries-example.csv" className={buttonClasses({ variant: "ghost" })}>
            <Download className="size-4" aria-hidden /> Example file
          </a>
        </div>
        <p className="text-[13px] text-muted-foreground">
          One row per salary, with column headings in the first row: staff number, basic salary ({currency}) and the date it starts. You can also add how it&apos;s paid
          (monthly, daily or hourly; monthly if left out) and a reason.
        </p>
      </section>

      {headers.length > 0 && prepared && (
        <section className="space-y-4">
          <h2 className="text-lg">2. Match the columns</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {pick("Staff number", "code")}
            {pick("Basic salary", "salary")}
            {pick("Start date", "date")}
            {pick("Paid (monthly, daily or hourly)", "basis", true)}
            {pick("Reason", "reason", true)}
          </div>
          <p className="text-[12px] text-subtle-foreground">Dates like 05/02/2026 are read as {dayFirst ? "day/month/year" : "month/day/year"}, like your company&apos;s date format.</p>
          <Table>
            <thead>
              <tr>
                <Th>Row</Th>
                <Th>Staff number</Th>
                <Th className="text-right">Salary</Th>
                <Th>Starts</Th>
              </tr>
            </thead>
            <tbody>
              {prepared.rows.slice(0, 8).map((r) => (
                <Tr key={r.row}>
                  <Td className="tabular text-subtle-foreground">{r.row}</Td>
                  <Td>{r.code}</Td>
                  <Td className="text-right tabular">{r.salary}</Td>
                  <Td className="tabular">{r.date}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          {prepared.rows.length > 8 && <p className="text-[12px] text-subtle-foreground">and {prepared.rows.length - 8} more rows</p>}
        </section>
      )}

      {headers.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg">3. Check, then import</h2>
          {check && (
            <Alert tone={blocking ? "warning" : "success"} title={blocking ? `${check.errors.length} ${check.errors.length === 1 ? "row needs" : "rows need"} fixing` : `All ${check.valid} rows are ready`}>
              {blocking ? (
                <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-[13px]">
                  {check.errors.map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              ) : (
                "Nothing has been saved yet."
              )}
            </Alert>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" loading={pending && !check} disabled={!ready} onClick={runCheck}>
              Check the file
            </Button>
            <Button loading={pending && Boolean(check)} disabled={!check || blocking} onClick={runImport}>
              Import {check && !blocking ? `${check.valid} salaries` : ""}
            </Button>
          </div>
          {blocking && <p className="text-[12px] text-subtle-foreground">Fix those rows in the file and choose it again. Nothing is imported while any row has a problem.</p>}
        </section>
      )}
    </div>
  );
}
