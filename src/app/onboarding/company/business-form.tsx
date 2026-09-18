"use client";

import { useActionState, useState } from "react";
import { ImagePlus, MapPin, Plus, Trash2 } from "lucide-react";
import { saveBusinessStep, type ActionState } from "@/lib/onboarding/actions";
import { COUNTRY_DEFAULTS, DATE_FORMATS } from "@/lib/geo";
import { INDUSTRIES } from "@/modules/selection";
import { EMPLOYEE_COUNT_RANGES } from "@/modules/pricing";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SubmitButton } from "@/components/ui/submit-button";

type Opt = { value: string; label: string };
type Values = Record<
  | "name"
  | "industry"
  | "country"
  | "currency"
  | "timezone"
  | "date_format"
  | "employee_count_range"
  | "address"
  | "registration_no"
  | "tin"
  | "phone"
  | "email",
  string
>;

export function BusinessForm({
  initial,
  branches: initialBranches,
  logoUrl,
  options,
  isNew,
}: {
  initial: Values;
  branches: { id?: string; name: string; atoll_island?: string }[];
  logoUrl: string | null;
  options: { countries: Opt[]; currencies: Opt[]; timezones: Opt[] };
  isNew: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(saveBusinessStep, {});
  // Controlled values survive a failed save (React resets uncontrolled forms after an action).
  const [v, setV] = useState<Values>(initial);
  const [branches, setBranches] = useState(initialBranches);
  const [preview, setPreview] = useState<string | null>(logoUrl);
  const err = state.fieldErrors ?? {};
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));

  const onCountry = (country: string) => {
    const d = COUNTRY_DEFAULTS[country];
    setV((p) => ({ ...p, country, ...(d ? { currency: d.currency, timezone: d.timezone } : {}) }));
  };

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[1fr_20rem]" noValidate>
      <div className="space-y-6">
        {state.error && <Alert tone="danger">{state.error}</Alert>}

        <Card>
          <CardHeader>
            <CardTitle>Company details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Company name" htmlFor="name" error={err.name} className="sm:col-span-2">
              <Input id="name" name="name" value={v.name} onChange={set("name")} required aria-invalid={!!err.name} autoFocus={isNew} />
            </Field>
            <Field label="Industry" htmlFor="industry" error={err.industry} hint="Helps us word things for your kind of business.">
              <Select
                id="industry"
                name="industry"
                value={v.industry}
                onChange={set("industry")}
                options={INDUSTRIES}
                placeholder="Choose…"
                aria-invalid={!!err.industry}
              />
            </Field>
            <Field label="Number of staff (roughly)" htmlFor="employee_count_range" error={err.employee_count_range}>
              <Select
                id="employee_count_range"
                name="employee_count_range"
                value={v.employee_count_range}
                onChange={set("employee_count_range")}
                options={EMPLOYEE_COUNT_RANGES.map((r) => ({ value: r, label: r }))}
                placeholder="Choose…"
                aria-invalid={!!err.employee_count_range}
              />
            </Field>
            <Field label="Country" htmlFor="country" error={err.country}>
              <Select id="country" name="country" value={v.country} onChange={(e) => onCountry(e.target.value)} options={options.countries} />
            </Field>
            <Field label="Currency" htmlFor="currency" error={err.currency}>
              <Select id="currency" name="currency" value={v.currency} onChange={set("currency")} options={options.currencies} />
            </Field>
            <Field label="Time zone" htmlFor="timezone" error={err.timezone}>
              <Select id="timezone" name="timezone" value={v.timezone} onChange={set("timezone")} options={options.timezones} />
            </Field>
            <Field label="Date format" htmlFor="date_format">
              <Select id="date_format" name="date_format" value={v.date_format} onChange={set("date_format")} options={DATE_FORMATS} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Locations</CardTitle>
            <CardDescription>Every place your staff work, like a Malé office or an island property.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input type="hidden" name="branches" value={JSON.stringify(branches)} />
            {branches.map((b, i) => (
              <div key={b.id ?? `new-${i}`} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <Input
                  aria-label={`Location ${i + 1} name`}
                  placeholder="Location name"
                  value={b.name}
                  onChange={(e) => setBranches((list) => list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                />
                <Input
                  aria-label={`Location ${i + 1} island or area`}
                  placeholder="Island / atoll / area (optional)"
                  value={b.atoll_island ?? ""}
                  onChange={(e) => setBranches((list) => list.map((x, j) => (j === i ? { ...x, atoll_island: e.target.value } : x)))}
                />
                <Button
                  variant="ghost"
                  aria-label={`Remove location ${i + 1}`}
                  disabled={branches.length === 1}
                  onClick={() => setBranches((list) => list.filter((_, j) => j !== i))}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            {err.branches && (
              <p className="text-sm text-danger" role="alert">
                {err.branches[0]}
              </p>
            )}
            <Button variant="secondary" size="sm" onClick={() => setBranches((l) => [...l, { name: "" }])}>
              <Plus className="size-4" aria-hidden /> Add a location
            </Button>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <MapPin className="size-3.5" aria-hidden /> You can pin each location on a map later, for clock-in by location.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registration &amp; contact</CardTitle>
            <CardDescription>Printed on letters and payslips. You can fill this in later.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Registered address" htmlFor="address" optional className="sm:col-span-2">
              <Input id="address" name="address" value={v.address} onChange={set("address")} autoComplete="street-address" />
            </Field>
            <Field label="Business registration number" htmlFor="registration_no" optional>
              <Input id="registration_no" name="registration_no" value={v.registration_no} onChange={set("registration_no")} />
            </Field>
            <Field label="TIN (tax ID)" htmlFor="tin" optional>
              <Input id="tin" name="tin" value={v.tin} onChange={set("tin")} />
            </Field>
            <Field label="Phone" htmlFor="phone" optional>
              <Input id="phone" name="phone" type="tel" value={v.phone} onChange={set("phone")} />
            </Field>
            <Field label="Company email" htmlFor="email" optional error={err.email}>
              <Input id="email" name="email" type="email" value={v.email} onChange={set("email")} aria-invalid={!!err.email} />
            </Field>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Logo</CardTitle>
            <CardDescription>Appears on letters, payslips and the staff app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label
              htmlFor="logo"
              className="flex aspect-[3/2] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-muted text-sm text-muted-foreground hover:border-accent"
            >
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- local preview / signed URL
                <img src={preview} alt="Your logo" className="max-h-full max-w-full object-contain p-3" />
              ) : (
                <>
                  <ImagePlus className="size-6" aria-hidden />
                  Click to upload
                </>
              )}
            </label>
            <input
              id="logo"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setPreview(URL.createObjectURL(file));
              }}
            />
            {err.logo ? (
              <p className="text-sm text-danger" role="alert">
                {err.logo[0]}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">PNG, JPG or WebP, up to 2 MB. Optional.</p>
            )}
          </CardContent>
        </Card>

        <div className="lg:sticky lg:top-6">
          <SubmitButton size="lg" className="w-full" pendingText="Saving…">
            {isNew ? "Create my company space" : "Save and continue"}
          </SubmitButton>
          <p className="mt-2 text-xs text-subtle-foreground">Next: a few questions about how you work</p>
        </div>
      </div>
    </form>
  );
}
