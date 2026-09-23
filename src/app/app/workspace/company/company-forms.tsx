"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";
import { ActionForm, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { getBrowserClient } from "@/lib/supabase/lazy-client";
import { saveCompanyDetails, saveLetterhead, setBrandingImage } from "@/lib/company/actions";

type Opt = { value: string; label: string };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function DetailsForm({
  canEdit,
  values,
  options,
}: {
  canEdit: boolean;
  values: Record<string, unknown>;
  options: { industries: Opt[]; countries: Opt[]; currencies: Opt[]; timezones: Opt[]; dateFormats: Opt[] };
}) {
  const v = (k: string) => (values[k] as string | null) ?? "";
  const working = (values.working_days as number[] | null) ?? [0, 1, 2, 3, 4];
  const fields = (
    <fieldset disabled={!canEdit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField name="name" label="Company name" defaultValue={v("name")} className="sm:col-span-2" />
        <SelectField name="industry" label="Industry" options={options.industries} defaultValue={v("industry")} />
        <SelectField name="country" label="Country" options={options.countries} defaultValue={v("country")} />
        <SelectField name="currency" label="Currency" options={options.currencies} defaultValue={v("currency")} />
        <SelectField name="timezone" label="Time zone" options={options.timezones} defaultValue={v("timezone")} />
        <SelectField name="date_format" label="Date format" options={options.dateFormats} defaultValue={v("date_format")} />
        <SelectField name="week_start" label="Week starts on" options={DAYS.map((d, i) => ({ value: String(i), label: d }))} defaultValue={String(values.week_start ?? 0)} />
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] text-muted-foreground">Working days</legend>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => (
            <label key={d} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm has-[:checked]:border-foreground">
              <input type="checkbox" name="working_days" value={i} defaultChecked={working.includes(i)} className="sr-only" />
              {d}
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-subtle-foreground">Used for time off and payroll day counts.</p>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextareaField name="address" label="Address" defaultValue={v("address")} className="sm:col-span-2" optional />
        <TextField name="phone" label="Phone" defaultValue={v("phone")} optional />
        <TextField name="email" label="Email" type="email" defaultValue={v("email")} optional />
        <TextField name="registration_no" label="Registration no." defaultValue={v("registration_no")} optional />
        <TextField name="tin" label="Tax number (TIN)" defaultValue={v("tin")} optional />
        <TextField name="website" label="Website" defaultValue={v("website")} optional />
      </div>
    </fieldset>
  );
  return canEdit ? <ActionForm action={saveCompanyDetails}>{fields}</ActionForm> : fields;
}

const IMAGES = [
  { kind: "logo", label: "Logo", hint: "Shown on letters, payslips and at the top of the app." },
  { kind: "signature", label: "Signature", hint: "A photo or scan of the signature on white or clear background." },
  { kind: "stamp", label: "Company stamp", hint: "Added to letters that need it." },
] as const;

export function BrandingPanel({
  canEdit,
  businessId,
  images,
  letterhead,
}: {
  canEdit: boolean;
  businessId: string;
  images: Record<"logo" | "signature" | "stamp", string | null>;
  letterhead: { signatory_name: string | null; signatory_title: string | null; letterhead_footer: string | null };
}) {
  return (
    <div className="space-y-10">
      <section className="grid gap-4 sm:grid-cols-3">
        {IMAGES.map((i) => (
          <ImageSlot key={i.kind} kind={i.kind} label={i.label} hint={i.hint} url={images[i.kind]} businessId={businessId} canEdit={canEdit} />
        ))}
      </section>
      <section>
        <h2 className="mb-1 text-lg">Who signs letters</h2>
        <p className="mb-5 text-sm text-muted-foreground">Printed under the signature on every letter.</p>
        <fieldset disabled={!canEdit}>
          <ActionForm action={saveLetterhead} hideSubmit={!canEdit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="signatory_name" label="Name" defaultValue={letterhead.signatory_name ?? ""} />
              <TextField name="signatory_title" label="Job title" defaultValue={letterhead.signatory_title ?? ""} placeholder="For example HR manager" />
              <TextField name="letterhead_footer" label="Footer line" defaultValue={letterhead.letterhead_footer ?? ""} className="sm:col-span-2" hint="Small text at the bottom of each page, for example your address and website." optional />
            </div>
          </ActionForm>
        </fieldset>
      </section>
    </div>
  );
}

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };

function ImageSlot({ kind, label, hint, url, businessId, canEdit }: { kind: "logo" | "signature" | "stamp"; label: string; hint: string; url: string | null; businessId: string; canEdit: boolean }) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function upload(file: File) {
    if (!TYPES[file.type]) return toast.error("Use a PNG or JPG image, so it can be printed on PDFs.");
    if (file.size > 2 * 1024 * 1024) return toast.error("The image must be smaller than 2 MB.");
    setBusy(true);
    const path = `${businessId}/branding/${kind}-${Date.now()}.${TYPES[file.type]}`;
    const { error } = await (await getBrowserClient()).storage.from("tenant-files").upload(path, file, { contentType: file.type });
    if (error) {
      setBusy(false);
      return toast.error("The upload didn't work. Check you can change company settings, then try again.");
    }
    const r = await setBrandingImage(kind, path);
    setBusy(false);
    if (r.error) toast.error(r.error);
    else {
      toast.success(`${label} saved.`);
      router.refresh();
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-border p-4">
      <p className="text-sm text-foreground">{label}</p>
      <p className="mb-3 text-[12px] text-subtle-foreground">{hint}</p>
      {/* White backing so dark logos stay visible in dark mode, like on paper. */}
      <div className="mb-3 grid h-28 place-items-center rounded-lg border border-border bg-white p-3">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived private link
          <img src={url} alt={label} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-[12px] text-neutral-500">None yet</span>
        )}
      </div>
      {canEdit && (
        <div className="mt-auto flex gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant="secondary" size="sm" loading={busy} onClick={() => input.current?.click()}>
            <Upload className="size-3.5" aria-hidden /> {url ? "Replace" : "Upload"}
          </Button>
          {url && (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove ${label}`}
              onClick={async () => {
                const r = await setBrandingImage(kind, null);
                if (r.error) toast.error(r.error);
                else {
                  toast.success(`${label} removed.`);
                  router.refresh();
                }
              }}
            >
              <X className="size-3.5" aria-hidden />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
