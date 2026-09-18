import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/access";
import { STARTER, SurveyEditor } from "../survey-editor";

export const metadata: Metadata = { title: "New survey" };

export default async function NewSurveyPage() {
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "surveys", "create")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to run surveys.
      </Alert>
    );
  }
  const { data: departments } = await (await createClient()).from("departments").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name");
  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: "/app/reviews/surveys", label: "Surveys" }}
        title="New survey"
        description="We've added four starter questions. Change them as you like. Nothing is sent until you open the survey."
      />
      <SurveyEditor
        departments={(departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
        initial={{ id: null, title: "Quick check-in", description: "", is_anonymous: true, min_responses_to_show: 3, closes_at: "", department_ids: [], questions: STARTER }}
      />
    </div>
  );
}
