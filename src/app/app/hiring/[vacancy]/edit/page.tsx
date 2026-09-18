import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadOrgOptions } from "@/lib/people/org-options";
import { can } from "@/modules/access";
import { VacancyForm } from "../../vacancy-form";

export const metadata: Metadata = { title: "Edit role" };

export default async function EditVacancyPage(props: PageProps<"/app/hiring/[vacancy]/edit">) {
  const { vacancy: id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "recruitment", "edit")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to change roles.
      </Alert>
    );
  }
  const supabase = await createClient();
  const { data: v } = await supabase.from("vacancies").select("*").eq("id", id).eq("business_id", active.business_id).maybeSingle();
  if (!v) notFound();
  const org = await loadOrgOptions(supabase, active.business_id);
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: `/app/hiring/${id}`, label: v.title }} title="Edit role" />
      <VacancyForm values={{ ...v, salary_min: v.salary_min === null ? null : Number(v.salary_min), salary_max: v.salary_max === null ? null : Number(v.salary_max) }} org={org} currency={active.currency} />
    </div>
  );
}
