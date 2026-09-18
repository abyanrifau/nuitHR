/* eslint-disable jsx-a11y/alt-text -- PDF images, not web images; the PDF library has no alt text */
import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { fullBrandName } from "@/lib/brand";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate } from "@/lib/format";

/**
 * Payslip PDF, drawn from the stored pay run (a snapshot), so an old
 * payslip never changes when someone's profile changes later.
 */
const s = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 9.5, color: "#111111" },
  head: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.5, borderBottomColor: "#999999", paddingBottom: 12, marginBottom: 16 },
  logo: { maxHeight: 40, maxWidth: 140, objectFit: "contain" },
  company: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 14, textAlign: "right" },
  muted: { color: "#555555" },
  grid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 16 },
  cell: { width: "50%", marginBottom: 6 },
  label: { color: "#666666", fontSize: 8 },
  cols: { flexDirection: "row", gap: 16 },
  col: { flex: 1 },
  th: { fontFamily: "Helvetica-Bold", borderBottomWidth: 0.5, borderBottomColor: "#999999", paddingBottom: 4, marginBottom: 4, flexDirection: "row", justifyContent: "space-between" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2.5 },
  total: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: "#999999", paddingTop: 4, marginTop: 4, fontFamily: "Helvetica-Bold" },
  net: { marginTop: 18, padding: 10, borderWidth: 1, borderColor: "#111111", flexDirection: "row", justifyContent: "space-between", fontFamily: "Helvetica-Bold", fontSize: 12 },
  credit: { position: "absolute", bottom: 14, left: 40, right: 40, fontSize: 6, color: "#aaaaaa", textAlign: "center" },
  foot: { position: "absolute", bottom: 28, left: 40, right: 40, fontSize: 7.5, color: "#777777", textAlign: "center" },
});

const money = (n: number | string) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Line {
  name: string;
  kind: string;
  amount: number | string;
  quantity: number | string | null;
  sort: number;
}

export interface PayslipData {
  company: { name: string; address: string | null; logo: string | null; currency: string; date_format: string; footer: string | null };
  run: { name: string; period_start: string; period_end: string; pay_date: string };
  person: {
    employee_name: string;
    employee_code: string | null;
    position_title: string | null;
    department_name: string | null;
    bank_name: string | null;
    bank_account_number: string | null;
    paid_days: number | string;
    period_days: number | string;
    gross_pay: number | string;
    total_deductions: number | string;
    net_pay: number | string;
    employer_contributions: number | string;
  };
  lines: Line[];
}

function Payslip({ company, run, person, lines }: PayslipData) {
  const f = (d: string) => formatDate(d, company.date_format);
  const earnings = lines.filter((l) => l.kind === "earning");
  const deductions = lines.filter((l) => l.kind === "deduction");
  const employer = lines.filter((l) => l.kind === "employer_contribution");
  const acct = person.bank_account_number ? `•••• ${person.bank_account_number.slice(-4)}` : "Not set";
  return (
    <Document title={`Payslip ${run.name} ${person.employee_name}`} author={company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View>
            {company.logo ? <Image src={company.logo} style={s.logo} /> : <Text style={s.company}>{company.name}</Text>}
            {company.logo ? <Text style={[s.muted, { marginTop: 4 }]}>{company.name}</Text> : null}
            {company.address ? <Text style={s.muted}>{company.address}</Text> : null}
          </View>
          <View>
            <Text style={s.title}>Payslip</Text>
            <Text style={[s.muted, { textAlign: "right" }]}>
              {f(run.period_start)} to {f(run.period_end)}
            </Text>
            <Text style={[s.muted, { textAlign: "right" }]}>Paid on {f(run.pay_date)}</Text>
          </View>
        </View>
        <View style={s.grid}>
          {[
            ["Name", person.employee_name],
            ["Employee no.", person.employee_code ?? ""],
            ["Job title", person.position_title ?? ""],
            ["Department", person.department_name ?? ""],
            ["Bank", person.bank_name ?? "Not set"],
            ["Account", acct],
            ["Days paid", `${Number(person.paid_days).toFixed(1)} of ${Number(person.period_days)}`],
            ["Currency", company.currency],
          ].map(([k, v]) => (
            <View key={k} style={s.cell}>
              <Text style={s.label}>{k}</Text>
              <Text>{v}</Text>
            </View>
          ))}
        </View>
        <View style={s.cols}>
          <View style={s.col}>
            <View style={s.th}>
              <Text>Earnings</Text>
              <Text>Amount</Text>
            </View>
            {earnings.map((l, i) => (
              <View key={i} style={s.row}>
                <Text>{l.name}</Text>
                <Text>{money(l.amount)}</Text>
              </View>
            ))}
            <View style={s.total}>
              <Text>Total earnings</Text>
              <Text>{money(person.gross_pay)}</Text>
            </View>
          </View>
          <View style={s.col}>
            <View style={s.th}>
              <Text>Deductions</Text>
              <Text>Amount</Text>
            </View>
            {deductions.map((l, i) => (
              <View key={i} style={s.row}>
                <Text>{l.name}</Text>
                <Text>{money(l.amount)}</Text>
              </View>
            ))}
            <View style={s.total}>
              <Text>Total deductions</Text>
              <Text>{money(person.total_deductions)}</Text>
            </View>
          </View>
        </View>
        <View style={s.net}>
          <Text>Net pay</Text>
          <Text>
            {company.currency} {money(person.net_pay)}
          </Text>
        </View>
        {employer.length > 0 && (
          <View style={{ marginTop: 14 }}>
            <Text style={s.label}>Paid by {company.name} on top of your pay</Text>
            {employer.map((l, i) => (
              <View key={i} style={s.row}>
                <Text style={s.muted}>{l.name}</Text>
                <Text style={s.muted}>{money(l.amount)}</Text>
              </View>
            ))}
          </View>
        )}
        <Text style={s.foot} fixed>
          {company.footer ?? `${company.name}. This payslip was produced by computer and needs no signature.`}
        </Text>
        <Text style={s.credit} fixed>
          Generated with {fullBrandName}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderPayslipPdf(data: PayslipData): Promise<Buffer> {
  return renderToBuffer(<Payslip {...data} />);
}

/** Loads one payslip with the signed-in person's own access, and draws it. Returns null if they can't see it. */
export async function payslipPdf(supabase: SupabaseClient, runEmployeeId: string): Promise<{ pdf: Buffer; fileName: string } | null> {
  const { data: pe } = await supabase
    .from("payroll_run_employees")
    .select("*, run:payroll_runs(name, period_start, period_end, pay_date, business_id, status)")
    .eq("id", runEmployeeId)
    .maybeSingle();
  if (!pe) return null;
  const run = pe.run as { name: string; period_start: string; period_end: string; pay_date: string; business_id: string };
  const [{ data: lines }, { data: b }] = await Promise.all([
    supabase.from("payroll_run_lines").select("name, kind, amount, quantity, sort").eq("run_employee_id", pe.id).order("sort"),
    supabase.from("businesses").select("name, address, logo_path, currency, date_format, letterhead_footer").eq("id", run.business_id).single(),
  ]);
  let logo: string | null = null;
  if (b?.logo_path) {
    const { data } = await supabase.storage.from("tenant-files").download(b.logo_path);
    if (data && /png|jpe?g/.test(data.type)) logo = `data:${data.type};base64,${Buffer.from(await data.arrayBuffer()).toString("base64")}`;
  }
  const pdf = await renderPayslipPdf({
    company: { name: b?.name ?? "", address: b?.address ?? null, logo, currency: b?.currency ?? "MVR", date_format: b?.date_format ?? "DD/MM/YYYY", footer: b?.letterhead_footer ?? null },
    run,
    person: pe,
    lines: (lines ?? []) as Line[],
  });
  const fileName = `Payslip ${run.period_start.slice(0, 7)} ${pe.employee_name}`.replace(/[^\w\- ]+/g, "") + ".pdf";
  return { pdf, fileName };
}
