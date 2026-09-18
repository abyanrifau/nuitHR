import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/access";

export const metadata: Metadata = { title: "Surveys" };

const STATUS = {
  draft: { label: "Draft", tone: "neutral" },
  open: { label: "Open", tone: "info" },
  closed: { label: "Closed", tone: "success" },
} as const;

export default async function SurveysPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "surveys", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to run surveys. Surveys for you are in the staff app.
      </Alert>
    );
  }
  const supabase = await createClient();
  const { data: surveys } = await supabase
    .from("surveys")
    .select("id, title, status, is_anonymous, opens_at, closes_at, created_at, responses:survey_participation(id)")
    .eq("business_id", active.business_id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        label="grow"
        title="Surveys"
        description="Ask staff how things are going. Make it anonymous and people tend to be more honest."
        actions={
          can(ctx, "surveys", "create") ? (
            <Link href="/app/reviews/surveys/new" className={buttonClasses()}>
              <Plus className="size-4" aria-hidden /> New survey
            </Link>
          ) : undefined
        }
      />
      {surveys?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Survey</Th>
              <Th>Replies</Th>
              <Th>Closes</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {surveys.map((s) => {
              const st = STATUS[s.status as keyof typeof STATUS];
              return (
                <Tr key={s.id}>
                  <Td>
                    <Link href={`/app/reviews/surveys/${s.id}`} className="text-foreground underline-offset-4 hover:underline">
                      {s.title}
                    </Link>
                    <span className="block text-[12px] text-subtle-foreground">{s.is_anonymous ? "Anonymous" : "Names shown"}</span>
                  </Td>
                  <Td className="tabular">{(s.responses ?? []).length}</Td>
                  <Td className="tabular">{s.closes_at ? formatDate(s.closes_at, active.date_format, active.timezone) : "—"}</Td>
                  <Td>
                    <StatusDot tone={st.tone}>{st.label}</StatusDot>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title="No surveys yet"
          description="A four-question check-in every few months is a good start."
          action={
            can(ctx, "surveys", "create") ? (
              <Link href="/app/reviews/surveys/new" className={buttonClasses()}>
                New survey
              </Link>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
