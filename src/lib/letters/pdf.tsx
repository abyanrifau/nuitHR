/* eslint-disable jsx-a11y/alt-text -- PDF images, not web images; the PDF library has no alt text */
import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

/**
 * Draws a letter on the company letterhead: logo and details at the top,
 * the letter, then the signatory with optional signature and stamp.
 * Uses the built-in Helvetica so it works without extra font files.
 */
export interface LetterPdfInput {
  company: { name: string; address: string | null; phone: string | null; email: string | null; registration_no: string | null; footer: string | null };
  images: { logo?: string | null; signature?: string | null; stamp?: string | null };
  signatory: { name: string | null; title: string | null };
  date: string;
  reference: string;
  addressedTo?: string | null;
  subject: string | null;
  body: string;
}

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 72, paddingHorizontal: 56, fontFamily: "Helvetica", fontSize: 10.5, lineHeight: 1.55, color: "#111111" },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 0.5, borderBottomColor: "#999999", paddingBottom: 14, marginBottom: 28 },
  logo: { maxHeight: 48, maxWidth: 160, objectFit: "contain" },
  company: { fontFamily: "Helvetica-Bold", fontSize: 13 },
  details: { fontSize: 8.5, color: "#555555", textAlign: "right", lineHeight: 1.45 },
  meta: { flexDirection: "row", justifyContent: "space-between", fontSize: 9.5, color: "#444444", marginBottom: 22 },
  to: { marginBottom: 16 },
  subject: { fontFamily: "Helvetica-Bold", fontSize: 12, marginBottom: 14 },
  para: { marginBottom: 10 },
  sign: { marginTop: 36, flexDirection: "row", alignItems: "flex-end", gap: 24 },
  signature: { height: 46, maxWidth: 160, objectFit: "contain", marginBottom: 4 },
  stamp: { height: 78, width: 78, objectFit: "contain", opacity: 0.9 },
  footer: { position: "absolute", bottom: 32, left: 56, right: 56, borderTopWidth: 0.5, borderTopColor: "#999999", paddingTop: 8, fontSize: 8, color: "#666666", textAlign: "center" },
});

function Letter(p: LetterPdfInput) {
  const details = [p.company.address, p.company.phone, p.company.email, p.company.registration_no ? `Reg. ${p.company.registration_no}` : null].filter(Boolean);
  const paragraphs = p.body.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  return (
    <Document title={p.subject ?? "Letter"} author={p.company.name} creator={p.company.name}>
      <Page size="A4" style={s.page}>
        <View style={s.head} fixed>
          {p.images.logo ? <Image src={p.images.logo} style={s.logo} /> : <Text style={s.company}>{p.company.name}</Text>}
          <View>
            {p.images.logo && <Text style={[s.details, { fontFamily: "Helvetica-Bold", color: "#111111" }]}>{p.company.name}</Text>}
            {details.map((d) => (
              <Text key={d} style={s.details}>
                {d}
              </Text>
            ))}
          </View>
        </View>
        <View style={s.meta}>
          <Text>Ref: {p.reference}</Text>
          <Text>{p.date}</Text>
        </View>
        {p.addressedTo ? <Text style={s.to}>{p.addressedTo}</Text> : null}
        {p.subject ? <Text style={s.subject}>{p.subject}</Text> : null}
        {paragraphs.map((para, i) => (
          <Text key={i} style={s.para}>
            {para}
          </Text>
        ))}
        <View style={s.sign} wrap={false}>
          <View>
            <Text style={{ marginBottom: 6 }}>Yours sincerely,</Text>
            {p.images.signature ? <Image src={p.images.signature} style={s.signature} /> : <View style={{ height: 40 }} />}
            {p.signatory.name ? <Text style={{ fontFamily: "Helvetica-Bold" }}>{p.signatory.name}</Text> : null}
            {p.signatory.title ? <Text style={{ color: "#444444" }}>{p.signatory.title}</Text> : null}
            <Text style={{ color: "#444444" }}>{p.company.name}</Text>
          </View>
          {p.images.stamp ? <Image src={p.images.stamp} style={s.stamp} /> : null}
        </View>
        {p.company.footer ? (
          <Text style={s.footer} fixed>
            {p.company.footer}
          </Text>
        ) : null}
      </Page>
    </Document>
  );
}

export async function renderLetterPdf(input: LetterPdfInput): Promise<Buffer> {
  return renderToBuffer(<Letter {...input} />);
}
