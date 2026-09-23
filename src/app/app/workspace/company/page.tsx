import { NuitLink } from "@/components/brand/byline";
import { appConfig } from "@/config/app.config";
import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { countryOptions, currencyOptions, DATE_FORMATS, timezoneOptions } from "@/lib/geo";
import { INDUSTRIES } from "@/modules/selection";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import { CelebrationsSetting } from "@/components/people/celebrations-setting";
import { BrandingPanel, DetailsForm } from "./company-forms";

export const metadata: Metadata = { title: "Company settings" };

export default async function CompanySettingsPage(props: PageProps<"/app/workspace/company">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "settings", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin to change company settings.
      </Alert>
    );
  }
  const canEdit = can(ctx, "settings", "edit");
  const tab = sp.tab === "branding" ? "branding" : "details";
  const supabase = await createClient();
  const { data: b } = await supabase.from("businesses").select("*").eq("id", active.business_id).single();
  const paths = [b.logo_path, b.signature_path, b.stamp_path].filter(Boolean) as string[];
  const { data: signed } = paths.length ? await supabase.storage.from("tenant-files").createSignedUrls(paths, 600) : { data: [] };
  const url = (p: string | null) => (p ? (signed?.find((s) => s.path === p)?.signedUrl ?? null) : null);

  return (
    <div className="max-w-3xl">
      <PageHeader label="workspace" title="Company settings" description="Your company's details, and the letterhead used on letters and payslips." />
      <nav aria-label="Sections" className="mb-8 flex gap-6 border-b border-border">
        {[
          { key: "details", label: "Details" },
          { key: "branding", label: "Letterhead" },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/app/workspace/company${t.key === "details" ? "" : "?tab=branding"}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn("-mb-px border-b py-3 text-sm", t.key === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {!canEdit && (
        <Alert tone="info" className="mb-6">
          You can see these settings but not change them.
        </Alert>
      )}
      {tab === "details" ? (
        <DetailsForm
          canEdit={canEdit}
          values={b}
          options={{
            industries: INDUSTRIES,
            countries: countryOptions(),
            currencies: currencyOptions(),
            timezones: timezoneOptions(),
            dateFormats: DATE_FORMATS,
          }}
        />
      ) : null}
      {tab === "details" && (
        <section aria-labelledby="home-page" className="mt-12">
          <h2 id="home-page" className="mb-4 text-lg">
            Home page
          </h2>
          <CelebrationsSetting enabled={b.celebrations_enabled} canEdit={canEdit} />
        </section>
      )}
      {tab === "branding" ? (
        <BrandingPanel
          canEdit={canEdit}
          businessId={active.business_id}
          images={{ logo: url(b.logo_path), signature: url(b.signature_path), stamp: url(b.stamp_path) }}
          letterhead={{ signatory_name: b.signatory_name, signatory_title: b.signatory_title, letterhead_footer: b.letterhead_footer }}
        />
      ) : null}
      <section aria-labelledby="about-harbor" className="mt-12 border-t border-border pt-6">
        <h2 id="about-harbor" className="section-label mb-2">
          about {appConfig.brand.name.toLowerCase()}
        </h2>
        <p className="text-[13px] text-subtle-foreground">
          {appConfig.brand.name} is designed and built by <NuitLink location="settings" />.
        </p>
      </section>
    </div>
  );
}
