import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getStaffContext } from "@/lib/staff/context";
import { SurveyForm } from "./survey-form";

export const metadata: Metadata = { title: "Survey" };

export default async function StaffSurvey(props: PageProps<"/staff/surveys/[survey]">) {
  const { survey: id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { active, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  // my_surveys only returns surveys that are open and meant for this person.
  const { data: mine } = await supabase.rpc("my_surveys", { p_business: active.business_id });
  const s = ((mine ?? []) as { id: string; title: string; description: string | null; is_anonymous: boolean; answered: boolean }[]).find((x) => x.id === id);
  if (!s) notFound();
  if (s.answered) {
    return (
      <div className="space-y-6">
        <PageHeader back={{ href: "/staff/surveys", label: "Surveys" }} title={s.title} />
        <Alert tone="success">You&apos;ve already answered this survey. Thank you.</Alert>
      </div>
    );
  }
  const { data: rawQuestions } = await supabase.rpc("my_survey_questions", { p_survey: id });
  const questions = (rawQuestions ?? []) as { id: string; question: string; kind: string; options: string[] | null; is_required: boolean }[];

  return (
    <div className="space-y-6">
      <PageHeader back={{ href: "/staff/surveys", label: "Surveys" }} title={s.title} description={s.description ?? undefined} />
      <Alert tone="info">
        {s.is_anonymous
          ? "This survey is anonymous. Your company sees your answers, but never your name."
          : "Your name is shown with your answers in this survey."}
      </Alert>
      <SurveyForm
        surveyId={id}
        questions={questions.map((q) => ({ id: q.id, question: q.question, kind: q.kind as "scale", options: (q.options ?? []) as string[], required: q.is_required }))}
      />
    </div>
  );
}
