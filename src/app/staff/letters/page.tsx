import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot } from "@/components/ui/table";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/access";
import { AskLetterForm, OpenFileButton } from "../staff-client";

export const metadata: Metadata = { title: "Ask for a letter" };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  pending: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved, being prepared", tone: "info" },
  issued: { label: "Ready", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default async function StaffLetters() {
  const { active, ctx, me, supabase } = await getStaffContext();
  if (!me) {
    return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  }
  const canAsk = can(ctx, "letters", "create", "own");
  const [{ data: templates }, { data: requests }] = await Promise.all([
    supabase.from("letter_templates").select("id, name").eq("business_id", active.business_id).eq("requestable_by_staff", true).eq("is_active", true).order("name"),
    supabase
      .from("letter_requests")
      .select("id, status, purpose, created_at, decision_comment, template:letter_templates(name), letter:generated_letters(pdf_path)")
      .eq("employee_id", me.id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader back={{ href: "/staff/requests", label: "Requests" }} title="Ask for a letter" description="HR prepares it on company letterhead. You'll get a notification when it's ready to download." />
      {canAsk && templates?.length ? (
        <AskLetterForm templates={templates.map((t) => ({ value: t.id, label: t.name }))} />
      ) : (
        <Alert tone="info">There are no letters you can ask for here yet. Speak to HR.</Alert>
      )}
      {requests && requests.length > 0 && (
        <section aria-labelledby="asked">
          <h2 id="asked" className="section-label mb-3">
            your letters
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {requests.map((r) => {
              const s = STATUS[r.status] ?? STATUS.pending;
              const path = (r.letter as unknown as { pdf_path: string | null } | null)?.pdf_path;
              return (
                <li key={r.id} className="flex items-start gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground">{(r.template as unknown as { name: string } | null)?.name ?? "Letter"}</p>
                    <p className="text-[13px] text-subtle-foreground">
                      {r.purpose} · <span className="tabular">{formatDate(r.created_at, active.date_format, active.timezone)}</span>
                    </p>
                    <p className="mt-1.5">
                      <StatusDot tone={s.tone}>{s.label}</StatusDot>
                    </p>
                    {r.decision_comment && r.status === "rejected" && <p className="mt-1 text-[13px] text-danger">Note: {r.decision_comment}</p>}
                  </div>
                  {r.status === "issued" && path && <OpenFileButton path={path} label="Download" />}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
