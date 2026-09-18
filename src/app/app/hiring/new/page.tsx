import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadOrgOptions } from "@/lib/people/org-options";
import { can } from "@/modules/access";
import { VacancyForm } from "../vacancy-form";

export const metadata: Metadata = { title: "New role" };

export default async function NewVacancyPage() {
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "recruitment", "create")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to add roles.
      </Alert>
    );
  }
  const org = await loadOrgOptions(await createClient(), active.business_id);
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/app/hiring", label: "Hiring" }} title="New role" description="Describe the job. If it's open and on your careers page, people can apply straight away." />
      <VacancyForm org={org} currency={active.currency} />
    </div>
  );
}
