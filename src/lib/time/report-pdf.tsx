import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { fullBrandName } from "@/lib/brand";
import type { Report } from "./reports";

/** An attendance report as a landscape A4 table. Built-in Helvetica only. */
const s = StyleSheet.create({
  page: { padding: 32, fontFamily: "Helvetica", fontSize: 8, color: "#111111" },
  company: { fontSize: 9, color: "#666666" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginTop: 2, marginBottom: 14 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#dddddd", paddingVertical: 4 },
  head: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#111111", paddingBottom: 4 },
  th: { fontFamily: "Helvetica-Bold", paddingRight: 6 },
  td: { paddingRight: 6 },
  empty: { marginTop: 20, color: "#666666" },
  note: { marginTop: -8, marginBottom: 12, color: "#8a5a00" },
  foot: { position: "absolute", bottom: 16, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", fontSize: 6, color: "#999999" },
});

function ReportDoc({ report, company, generated }: { report: Report; company: string; generated: string }) {
  // Wider columns for names and day lists; numbers stay narrow.
  const weight = (i: number) => (report.columns[i].numeric ? 1 : i === 1 ? 2.2 : i === report.columns.length - 1 && !report.columns[i].numeric ? 3 : 1.4);
  const total = report.columns.reduce((t, _, i) => t + weight(i), 0);
  const width = (i: number) => `${(weight(i) / total) * 100}%`;
  return (
    <Document title={report.title}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <Text style={s.company}>{company}</Text>
        <Text style={s.title}>{report.title}</Text>
        {report.note ? <Text style={s.note}>{report.note}</Text> : null}
        <View style={s.head} fixed>
          {report.columns.map((c, i) => (
            <Text key={c.label} style={[s.th, { width: width(i), textAlign: c.numeric ? "right" : "left" }]}>
              {c.label}
            </Text>
          ))}
        </View>
        {report.rows.length === 0 && <Text style={s.empty}>Nothing to report for this period.</Text>}
        {report.rows.map((r, ri) => (
          <View key={ri} style={s.row} wrap={false}>
            {r.map((v, i) => (
              <Text key={i} style={[s.td, { width: width(i), textAlign: report.columns[i].numeric ? "right" : "left" }]}>
                {typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : v}
              </Text>
            ))}
          </View>
        ))}
        <View style={s.foot} fixed>
          <Text>
            Generated {generated} with {fullBrandName}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function reportPdf(report: Report, company: string, generated: string): Promise<Buffer> {
  return renderToBuffer(<ReportDoc report={report} company={company} generated={generated} />);
}
