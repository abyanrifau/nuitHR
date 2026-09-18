import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fullBrandName } from "@/lib/brand";
import { formatDate } from "@/lib/format";

/**
 * A plain, landscape certificate of completion. Built-in Helvetica only,
 * so it works without extra font files.
 */
const s = StyleSheet.create({
  page: { padding: 48, fontFamily: "Helvetica", color: "#111111" },
  frame: { flex: 1, borderWidth: 1, borderColor: "#111111", padding: 48, justifyContent: "center", alignItems: "center" },
  label: { fontSize: 10, letterSpacing: 3, color: "#666666", marginBottom: 28 },
  name: { fontSize: 34, fontFamily: "Helvetica-Bold", marginBottom: 18, textAlign: "center" },
  line: { fontSize: 12, color: "#444444", marginBottom: 8, textAlign: "center" },
  course: { fontSize: 20, fontFamily: "Helvetica-Bold", marginBottom: 30, textAlign: "center" },
  foot: { flexDirection: "row", justifyContent: "space-between", width: "100%", marginTop: 36, fontSize: 10, color: "#444444" },
  credit: { position: "absolute", bottom: 20, left: 48, right: 48, fontSize: 6, color: "#aaaaaa", textAlign: "center" },
});

export interface CertificateData {
  person: string;
  course: string;
  company: string;
  completed: string;
  score: number | null;
}

function Certificate(d: CertificateData) {
  return (
    <Document title={`Certificate: ${d.course}`}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.frame}>
          <Text style={s.label}>CERTIFICATE OF COMPLETION</Text>
          <Text style={s.name}>{d.person}</Text>
          <Text style={s.line}>has finished the course</Text>
          <Text style={s.course}>{d.course}</Text>
          {d.score !== null && <Text style={s.line}>Quiz score: {d.score}%</Text>}
          <View style={s.foot}>
            <Text>{d.company}</Text>
            <Text>{d.completed}</Text>
          </View>
        </View>
        <Text style={s.credit} fixed>
          Generated with {fullBrandName}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderCertificatePdf(d: CertificateData): Promise<Buffer> {
  return renderToBuffer(<Certificate {...d} />);
}

/** The signed-in person's certificate for a course, or null if they haven't finished it. */
export async function certificatePdf(supabase: SupabaseClient, employeeId: string, courseId: string): Promise<{ pdf: Buffer; fileName: string } | null> {
  const { data: en } = await supabase
    .from("course_enrollments")
    .select("status, score, completed_at, business_id, course:courses(title, certificate_enabled), employee:employees(first_name, last_name, preferred_name)")
    .eq("employee_id", employeeId)
    .eq("course_id", courseId)
    .maybeSingle();
  const course = en?.course as unknown as { title: string; certificate_enabled: boolean } | null;
  if (!en || en.status !== "completed" || !course?.certificate_enabled) return null;
  const { data: b } = await supabase.from("businesses").select("name, date_format, timezone").eq("id", en.business_id).single();
  const e = en.employee as unknown as { first_name: string; last_name: string };
  const pdf = await renderCertificatePdf({
    person: `${e.first_name} ${e.last_name}`.trim(),
    course: course.title,
    company: b?.name ?? "",
    completed: formatDate(en.completed_at, b?.date_format ?? "DD/MM/YYYY", b?.timezone ?? "Indian/Maldives"),
    score: en.score,
  });
  const slug = course.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "course";
  return { pdf, fileName: `certificate-${slug}.pdf` };
}
