/**
 * Reading clock machine exports in the browser: CSV (comma, semicolon or
 * tab) and Excel (.xlsx), then turning dates and times into one format.
 */

/** A CSV file as rows of cells. Handles quotes and picks the separator the file uses. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", ";", "\t"].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

/** The first sheet of an Excel file as rows of cells. Dates and times stay as Excel numbers; toDate/toTime read them. */
export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");
  const shared: string[] = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) for (const si of Array.from(xml(await ss.async("string")).getElementsByTagName("si"))) shared.push(Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
  // The first sheet listed in the workbook.
  const wb = xml(await zip.file("xl/workbook.xml")!.async("string"));
  const rid = wb.getElementsByTagName("sheet")[0]?.getAttribute("r:id");
  const rels = xml(await zip.file("xl/_rels/workbook.xml.rels")!.async("string"));
  const target = Array.from(rels.getElementsByTagName("Relationship")).find((r) => r.getAttribute("Id") === rid)?.getAttribute("Target") ?? "worksheets/sheet1.xml";
  const path = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  const sheet = xml(await zip.file(path)!.async("string"));
  const colIndex = (ref: string) => {
    let n = 0;
    for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  const rows: string[][] = [];
  for (const r of Array.from(sheet.getElementsByTagName("row"))) {
    const out: string[] = [];
    for (const c of Array.from(r.getElementsByTagName("c"))) {
      const t = c.getAttribute("t");
      const v = c.getElementsByTagName("v")[0]?.textContent ?? "";
      const value = t === "s" ? (shared[Number(v)] ?? "") : t === "inlineStr" ? Array.from(c.getElementsByTagName("t")).map((x) => x.textContent ?? "").join("") : v;
      out[colIndex(c.getAttribute("r") ?? "A")] = value;
    }
    rows.push(Array.from(out, (x) => x ?? ""));
  }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A date as YYYY-MM-DD. Reads 2026-02-05, 05/02/2026 (in the company's order), 5-Feb-2026, and Excel date numbers. */
export function toDate(value: string, dayFirst: boolean): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v) && Number(v) > 20000 && Number(v) < 80000) {
    // Excel counts days from 30 December 1899.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(v)) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  let m = v.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = v.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return dayFirst ? valid(y, +m[2], +m[1]) : valid(y, +m[1], +m[2]);
  }
  m = v.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s,]+(\d{4})/);
  if (m) {
    const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()) + 1;
    return mon ? valid(+m[3], mon, +m[1]) : null;
  }
  return null;
}

function valid(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** A time as HH:MM. Reads 08:58, 8:58:12, 8:58 PM, and Excel time fractions. Also takes the time from "2026-02-05 08:58". */
export function toTime(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d*\.\d+$/.test(v) || /^\d+\.\d+$/.test(v)) {
    const frac = Number(v) % 1;
    const mins = Math.round(frac * 24 * 60) % (24 * 60);
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }
  const m = v.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*$/);
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  if (m[3]) {
    const pm = m[3].toLowerCase() === "pm";
    if (h === 12) h = pm ? 12 : 0;
    else if (pm) h += 12;
  }
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null;
}
