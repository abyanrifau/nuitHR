import { createClient } from "@/lib/supabase/server";
import { getOnboardingState } from "@/lib/onboarding/state";
import { countryOptions, currencyOptions, timezoneOptions } from "@/lib/geo";
import { appConfig } from "@/config/app.config";
import { StepHeader } from "../step-header";
import { BusinessForm } from "./business-form";

export default async function BusinessStep() {
  const state = await getOnboardingState();
  const supabase = await createClient();
  const b = state.business;

  let branches: { id?: string; name: string; atoll_island?: string }[] = [{ name: "" }];
  let logoUrl: string | null = null;
  if (b) {
    const { data } = await supabase
      .from("branches")
      .select("id, name, atoll_island")
      .eq("business_id", b.id)
      .eq("is_active", true)
      .order("created_at");
    if (data?.length) branches = data.map((x) => ({ id: x.id, name: x.name, atoll_island: x.atoll_island ?? "" }));
    if (b.logo_path) {
      const { data: signed } = await supabase.storage.from("tenant-files").createSignedUrl(b.logo_path, 3600);
      logoUrl = signed?.signedUrl ?? null;
    }
  }

  return (
    <>
      <StepHeader title="About your company" description="This creates your company space. Everything here can be changed later." />
      <BusinessForm
        initial={{
          name: b?.name ?? "",
          industry: b?.industry ?? "",
          country: b?.country ?? appConfig.defaults.country,
          currency: b?.currency ?? appConfig.defaults.currency,
          timezone: b?.timezone ?? appConfig.defaults.timezone,
          date_format: b?.date_format ?? appConfig.defaults.dateFormat,
          employee_count_range: b?.employee_count_range ?? "",
          address: b?.address ?? "",
          registration_no: b?.registration_no ?? "",
          tin: b?.tin ?? "",
          phone: b?.phone ?? "",
          email: b?.email ?? "",
        }}
        branches={branches}
        logoUrl={logoUrl}
        options={{ countries: countryOptions(), currencies: currencyOptions(), timezones: timezoneOptions() }}
        isNew={!b}
      />
    </>
  );
}
