import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadOrgOptions } from "@/lib/people/org-options";
import { can } from "@/modules/access";
import { NewPersonForm } from "./new-person-form";

export const metadata: Metadata = { title: "Add person" };

export default async function NewPersonPage() {
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "employees", "create")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to add people.
      </Alert>
    );
  }
  const supabase = await createClient();
  const [org, { data: code }] = await Promise.all([
    loadOrgOptions(supabase, active.business_id),
    supabase.rpc("suggest_employee_code", { p_business: active.business_id }),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader
        back={{ href: "/app/people", label: "People" }}
        title="Add person"
        description="Start with the basics. You can add ID, bank details and files on their profile afterwards."
      />
      <NewPersonForm org={org} suggestedCode={(code as string | null) ?? ""} />
    </div>
  );
}
