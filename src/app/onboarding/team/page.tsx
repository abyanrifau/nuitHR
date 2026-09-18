import { createClient } from "@/lib/supabase/server";
import { requireOnboardingBusiness } from "@/lib/onboarding/state";
import { StepHeader } from "../step-header";
import { TeamStep } from "./team-step";

export default async function TeamPage() {
  const state = await requireOnboardingBusiness();
  const supabase = await createClient();
  const bid = state.businessId;
  const [{ data: roles }, { data: departments }, { data: branches }, { data: employees }, { count: invites }] = await Promise.all([
    supabase.from("roles").select("id, key, name, is_owner").eq("business_id", bid).order("name"),
    supabase.from("departments").select("name").eq("business_id", bid).order("name"),
    supabase.from("branches").select("name").eq("business_id", bid).eq("is_active", true).order("name"),
    supabase.from("employees").select("employee_code, work_email").eq("business_id", bid),
    supabase.from("invitations").select("id", { count: "exact", head: true }).eq("business_id", bid).is("revoked_at", null),
  ]);

  const order = ["employee", "manager", "hr_manager", "payroll_officer", "admin"];
  const roleOptions = (roles ?? [])
    .filter((r) => !r.is_owner)
    .sort((a, b) => order.indexOf(a.key ?? "") - order.indexOf(b.key ?? ""))
    .map((r) => ({ value: r.id, label: r.name, key: r.key }));

  return (
    <>
      <StepHeader
        title="Invite your team"
        description="Add your managers and staff now, or skip and do it later. Invited people get an email with a link to join."
      />
      <TeamStep
        businessId={bid}
        roles={roleOptions}
        departments={(departments ?? []).map((d) => d.name)}
        importContext={{
          branches: (branches ?? []).map((b) => b.name),
          existingCodes: (employees ?? []).map((e) => e.employee_code),
          existingEmails: (employees ?? []).map((e) => e.work_email).filter(Boolean) as string[],
          businessCountry: state.business.country,
        }}
        alreadyAdded={{ employees: employees?.length ?? 0, invites: invites ?? 0 }}
      />
    </>
  );
}
