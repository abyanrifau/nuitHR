import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { can } from "@/modules/access";
import { CourseForm } from "../course-form";

export const metadata: Metadata = { title: "New course" };

export default async function NewCoursePage() {
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "learning", "create")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to add courses.
      </Alert>
    );
  }
  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: "/app/training", label: "Training" }}
        title="New course"
        description="Start with the name. Next you add lessons: text, a video link, a PDF or a quiz."
      />
      <CourseForm />
    </div>
  );
}
