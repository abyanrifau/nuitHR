import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { ADMIN_ACTION_LABEL, monthlyPrice, PLAN_LABEL, PLAN_TONE, type PlanState } from "@/lib/platform/data";
import { adminTitle, requirePlatformAdmin } from "@/lib/platform/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { MODULE_MAP } from "@/modules/registry";
import { BusinessActions, ReceiptButton } from "./actions-client";

export async function generateMetadata() {
  return adminTitle("Company");
}

interface Detail {
  business: Record<string, unknown> & {
    id: string;
    name: string;
    slug: string;
    industry: string;
    country: string;
    timezone: string;
    address: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    registration_no: string | null;
    tin: string | null;
    created_at: string;
    onboarding_completed_at: string | null;
    plan_status: string;
    status: PlanState;
    trial_ends_at: string | null;
    paid_until: string | null;
    custom_monthly_price: number | null;
    discount_percent: number | null;
    price_override_until: string | null;
  };
  admins: { name: string | null; email: string; phone: string | null; role: string; is_owner: boolean; last_sign_in: string | null }[];
  locations: string[];
  staff_count: number;
  logins: number;
  modules: string[];
  last_active: string | null;
  payroll_runs: number;
  requests_this_month: number;
  support_until: string | null;
}

const METHOD: Record<string, string> = { bank_transfer: "Bank transfer", mobile_payment: "Mobile payment", cash: "Cash", other: "Other" };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h2 className="mb-2 text-base">{title}</h2>
      <div className="rounded-xl border border-border px-4 py-3">{children}</div>
    </section>
  );
}

export default async function AdminBusinessPage(props: PageProps<"/admin/businesses/[id]">) {
  await requirePlatformAdmin();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = createAdminClient();
  const { data } = await db.rpc("admin_business_detail", { p_business: id });
  const d = data as Detail | null;
  if (!d?.business) notFound();
  const [{ data: payments }, { data: notes }, { data: log }] = await Promise.all([
    db.from("platform_payments").select("id, amount, currency, paid_on, method, reference, receipt_path, period_start, period_end, notes, recorded_by").eq("business_id", id).order("paid_on", { ascending: false }),
    db.from("platform_admin_notes").select("id, author, body, created_at").eq("business_id", id).order("created_at", { ascending: false }),
    db.from("platform_audit_log").select("id, admin_email, action, reason, before, after, created_at").eq("business_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  const b = d.business;
  const tz = b.timezone;
  const price = monthlyPrice({
    modules: d.modules,
    staff_count: Number(d.staff_count),
    custom_monthly_price: b.custom_monthly_price == null ? null : Number(b.custom_monthly_price),
    discount_percent: b.discount_percent == null ? null : Number(b.discount_percent),
    price_override_until: b.price_override_until,
  });
  const endsAt = b.plan_status === "trial" ? b.trial_ends_at : b.paid_until;
  const addOns = Object.values(MODULE_MAP).filter((m) => !m.core && !m.builtIn);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/businesses" className="text-sm text-muted-foreground hover:text-foreground">
            ← Companies
          </Link>
          <h1 className="mt-2 text-2xl">{b.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <StatusDot tone={PLAN_TONE[b.status]}>{PLAN_LABEL[b.status]}</StatusDot>
            <span>
              {b.plan_status === "trial" ? "Trial ends" : "Paid until"} {formatDate(endsAt, "DD/MM/YYYY", tz)}
            </span>
            <span>{formatMoney(price, "MVR")} a month</span>
          </p>
        </div>
      </div>

      <BusinessActions
        business={{
          id: b.id,
          name: b.name,
          timezone: tz,
          planStatus: b.plan_status,
          status: b.status,
          trialEndsAt: b.trial_ends_at,
          paidUntil: b.paid_until,
          customPrice: b.custom_monthly_price == null ? null : Number(b.custom_monthly_price),
          discount: b.discount_percent == null ? null : Number(b.discount_percent),
          priceUntil: b.price_override_until,
          monthlyPrice: price,
          modules: d.modules,
          supportUntil: d.support_until,
        }}
        tools={addOns.map((m) => ({ key: m.key, name: m.name, requires: m.requires }))}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Company">
          <dl>
            <Row label="Signed up">{formatDate(b.created_at, "DD/MM/YYYY", tz)}</Row>
            <Row label="Setup">{b.onboarding_completed_at ? `Finished ${formatDate(b.onboarding_completed_at, "DD/MM/YYYY", tz)}` : "Not finished"}</Row>
            <Row label="Industry">{b.industry.replace(/_/g, " ")}</Row>
            <Row label="Address">{b.address || "—"}</Row>
            <Row label="Phone / email">{[b.phone, b.email].filter(Boolean).join(" · ") || "—"}</Row>
            <Row label="Registration / TIN">{[b.registration_no, b.tin].filter(Boolean).join(" · ") || "—"}</Row>
            <Row label="Locations">{d.locations.length ? d.locations.join(", ") : "—"}</Row>
            <Row label="Careers page">/careers/{b.slug}</Row>
          </dl>
        </Section>

        <Section title="Usage">
          <dl>
            <Row label="Staff">{d.staff_count}</Row>
            <Row label="Logins">{d.logins}</Row>
            <Row label="Last active">{d.last_active ? formatDateTime(d.last_active, "DD/MM/YYYY", tz) : "—"}</Row>
            <Row label="Payroll runs">{d.payroll_runs}</Row>
            <Row label="Requests this month">{d.requests_this_month}</Row>
            <Row label="Tools">
              {d.modules
                .map((m) => MODULE_MAP[m as keyof typeof MODULE_MAP])
                .filter((m) => m && !m.core)
                .map((m) => m!.name)
                .join(", ") || "Foundation only"}
            </Row>
            <Row label="Support access">{d.support_until ? `On until ${formatDateTime(d.support_until, "DD/MM/YYYY", tz)}` : "Off"}</Row>
          </dl>
        </Section>

        <Section title="Owner and admins">
          <ul className="divide-y divide-border">
            {d.admins.map((a) => (
              <li key={a.email} className="py-2 text-sm">
                <span className="text-foreground">{a.name || a.email}</span> <span className="text-subtle-foreground">· {a.is_owner ? "Owner" : a.role}</span>
                <span className="block text-[12px] text-muted-foreground">
                  {[a.email, a.phone].filter(Boolean).join(" · ")}
                  {a.last_sign_in && ` · last signed in ${formatDate(a.last_sign_in, "DD/MM/YYYY", tz)}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Subscription">
          <dl>
            <Row label="Status">{PLAN_LABEL[b.status]}</Row>
            <Row label="Trial ends">{formatDate(b.trial_ends_at, "DD/MM/YYYY", tz)}</Row>
            <Row label="Paid until">{formatDate(b.paid_until, "DD/MM/YYYY", tz)}</Row>
            <Row label="Monthly price">
              {formatMoney(price, "MVR")}
              {b.custom_monthly_price != null && " (custom price)"}
              {b.discount_percent != null && ` (${Number(b.discount_percent)}% off)`}
              {b.price_override_until && ` until ${formatDate(b.price_override_until, "DD/MM/YYYY")}`}
            </Row>
          </dl>
        </Section>
      </div>

      <section>
        <h2 className="mb-2 text-base">Payments</h2>
        {payments?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>Paid on</Th>
                <Th className="text-right">Amount</Th>
                <Th>Method</Th>
                <Th>Reference</Th>
                <Th>Covers</Th>
                <Th>Recorded by</Th>
                <Th>Receipt</Th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <Tr key={p.id}>
                  <Td className="tabular">{formatDate(p.paid_on, "DD/MM/YYYY")}</Td>
                  <Td className="text-right tabular">{formatMoney(p.amount, p.currency)}</Td>
                  <Td>{METHOD[p.method] ?? p.method}</Td>
                  <Td>{p.reference || "—"}</Td>
                  <Td className="tabular">
                    {p.period_start ? `${formatDate(p.period_start, "DD/MM/YYYY")} to ${formatDate(p.period_end, "DD/MM/YYYY")}` : "—"}
                  </Td>
                  <Td className="text-[12px] text-muted-foreground">{p.recorded_by}</Td>
                  <Td>{p.receipt_path ? <ReceiptButton paymentId={p.id} /> : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <p className="rounded-xl border border-dashed border-border-strong p-4 text-sm text-muted-foreground">No payments recorded yet.</p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-base">Admin notes</h2>
          <p className="mb-2 text-[12px] text-subtle-foreground">Private to Harbor admins. The company never sees these.</p>
          {notes?.length ? (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-xl border border-border p-3 text-sm">
                  <p className="whitespace-pre-line text-foreground">{n.body}</p>
                  <p className="mt-1 text-[12px] text-subtle-foreground">
                    {n.author} · {formatDateTime(n.created_at, "DD/MM/YYYY", tz)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-base">Admin log for this company</h2>
          {log?.length ? (
            <ul className="divide-y divide-border rounded-xl border border-border">
              {log.map((l) => (
                <li key={l.id} className="px-3 py-2 text-sm">
                  <p className="text-foreground">{ADMIN_ACTION_LABEL[l.action] ?? l.action}</p>
                  <p className="text-[12px] text-subtle-foreground">
                    {l.admin_email} · {formatDateTime(l.created_at, "DD/MM/YYYY", tz)}
                    {l.reason && ` · ${l.reason}`}
                  </p>
                  {(l.before || l.after) && (
                    <details className="mt-1 text-[12px] text-muted-foreground">
                      <summary className="cursor-pointer">Before and after</summary>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify({ before: l.before, after: l.after }, null, 1)}</pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
