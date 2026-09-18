import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyBusinesses, requireUser } from "@/lib/auth/session";
import { SETUP_ORDER } from "@/modules/setup-defaults";
import type { ModuleKey } from "@/modules/types";

export const WIZARD_STEPS = [
  { n: 1, key: "account", label: "Account", href: "/signup" },
  { n: 2, key: "business", label: "Business", href: "/onboarding/business" },
  { n: 3, key: "modules", label: "Modules", href: "/onboarding/modules" },
  { n: 4, key: "setup", label: "Quick setup", href: "/onboarding/setup" },
  { n: 5, key: "team", label: "Team", href: "/onboarding/team" },
  { n: 6, key: "done", label: "Done", href: "/onboarding/done" },
] as const;

export type WizardStepKey = (typeof WIZARD_STEPS)[number]["key"];

export interface DraftData {
  /** Furthest step reached (so the progress bar lets you jump back). */
  furthest?: number;
  /** Setup screens the user chose to skip. */
  skipped?: string[];
}

export interface OnboardingState {
  userId: string;
  businessId: string | null;
  business: {
    id: string;
    name: string;
    industry: string;
    country: string;
    currency: string;
    timezone: string;
    date_format: string;
    employee_count_range: string | null;
    address: string | null;
    registration_no: string | null;
    tin: string | null;
    phone: string | null;
    email: string | null;
    logo_path: string | null;
    onboarding_completed_at: string | null;
  } | null;
  modules: ModuleKey[];
  setupDone: ModuleKey[];
  draft: DraftData;
  currentStep: number;
}

/**
 * Everything the wizard needs: which business is being set up, how far the
 * user got, and what they've already filled in. Progress is saved in the
 * database, so they can close the browser and carry on later.
 */
export const getOnboardingState = cache(async (): Promise<OnboardingState> => {
  const user = await requireUser("/onboarding");
  const supabase = await createClient();
  const { data: draftRow } = await supabase.from("onboarding_drafts").select("*").eq("user_id", user.id).maybeSingle();

  const draftActive = !!draftRow && !draftRow.completed_at;
  let businessId: string | null = draftActive ? (draftRow.business_id ?? null) : null;
  if (!draftActive) {
    // Resume a business the user owns that never finished setup.
    const mine = await getMyBusinesses();
    businessId = mine.find((b) => b.is_owner && !b.onboarding_completed_at)?.business_id ?? null;
  }

  let business: OnboardingState["business"] = null;
  let modules: ModuleKey[] = [];
  let setupDone: ModuleKey[] = [];
  if (businessId) {
    const [{ data: b }, { data: mods }] = await Promise.all([
      supabase
        .from("businesses")
        .select(
          "id, name, industry, country, currency, timezone, date_format, employee_count_range, address, registration_no, tin, phone, email, logo_path, onboarding_completed_at",
        )
        .eq("id", businessId)
        .maybeSingle(),
      supabase.from("business_modules").select("module_key, enabled, setup_completed_at").eq("business_id", businessId),
    ]);
    business = b;
    if (!b) businessId = null;
    modules = (mods ?? []).filter((m) => m.enabled).map((m) => m.module_key as ModuleKey);
    setupDone = (mods ?? []).filter((m) => m.setup_completed_at).map((m) => m.module_key as ModuleKey);
  }

  const draft = (draftRow && !draftRow.completed_at ? (draftRow.data as DraftData) : {}) ?? {};
  return {
    userId: user.id,
    businessId,
    business,
    modules,
    setupDone,
    draft,
    currentStep: businessId ? Math.max(3, draftRow?.current_step ?? 3) : 2,
  };
});

/** Setup screens to show, in order: only for modules that are switched on. */
export function setupModulesFor(modules: ModuleKey[]): ModuleKey[] {
  return SETUP_ORDER.filter((m) => modules.includes(m));
}

/** Pages after step 2 need a business; send people back if there isn't one yet. */
export async function requireOnboardingBusiness() {
  const state = await getOnboardingState();
  if (!state.businessId || !state.business) redirect("/onboarding/business");
  return state as OnboardingState & { businessId: string; business: NonNullable<OnboardingState["business"]> };
}

export async function saveDraft(userId: string, patch: { business_id?: string | null; step?: number; data?: DraftData; completed?: boolean }) {
  const supabase = await createClient();
  const { data: existing } = await supabase.from("onboarding_drafts").select("*").eq("user_id", userId).maybeSingle();
  const prev = (existing && !existing.completed_at ? existing.data : {}) as DraftData;
  const step = patch.step ?? existing?.current_step ?? 2;
  const data: DraftData = { ...prev, ...patch.data, furthest: Math.max(prev.furthest ?? 2, step, patch.data?.furthest ?? 0) };
  const { error } = await supabase.from("onboarding_drafts").upsert({
    user_id: userId,
    business_id: patch.business_id === undefined ? (existing?.completed_at ? null : existing?.business_id ?? null) : patch.business_id,
    current_step: step,
    data,
    completed_at: patch.completed ? new Date().toISOString() : null,
  });
  if (error) throw new Error(`Couldn't save your progress: ${error.message}`);
}
