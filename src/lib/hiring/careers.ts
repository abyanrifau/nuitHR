import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export interface PublicVacancy {
  id: string;
  slug: string;
  title: string;
  employment_type: string;
  description: string;
  requirements: string;
  deadline: string | null;
  department: string | null;
  branch: string | null;
  salary_min: number | null;
  salary_max: number | null;
  currency: string;
}

export interface Careers {
  business: { name: string; logo_path: string | null; intro: string | null; country: string };
  vacancies: PublicVacancy[];
  logoUrl: string | null;
}

/** A company's public careers page, or null if it's switched off. Only shows what the database function allows. */
export const getCareers = cache(async (slug: string): Promise<Careers | null> => {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_careers", { p_slug: slug });
  if (!data) return null;
  const c = data as Omit<Careers, "logoUrl">;
  let logoUrl: string | null = null;
  // The logo is private storage; a short-lived link is made just for this page.
  if (c.business.logo_path && isAdminConfigured()) {
    const { data: signed } = await createAdminClient().storage.from("tenant-files").createSignedUrl(c.business.logo_path, 3600);
    logoUrl = signed?.signedUrl ?? null;
  }
  return { ...c, logoUrl };
});

export const EMPLOYMENT: Record<string, string> = {
  permanent: "Permanent",
  fixed_term: "Fixed term",
  part_time: "Part time",
  casual: "Casual",
  intern: "Internship",
  consultant: "Consultant",
};
