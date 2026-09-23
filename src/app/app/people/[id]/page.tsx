import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PictureUpload } from "@/components/people/picture-upload";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DetailList, EmptyState } from "@/components/ui/page";
import { TabNav } from "@/components/ui/tab-nav";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext, type BusinessAccess } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { actionVerb, describeChanges, entityLabel } from "@/lib/audit";
import { formatDate, formatDateTime, formatMoney, fullName, lengthOfService, nextPayDay, titleCase, today } from "@/lib/format";
import { CONTRACT_TYPES, GENDERS, NATIONALITIES, statusMeta } from "@/lib/people/constants";
import { loadOrgOptions } from "@/lib/people/org-options";
import { can, isEnabled } from "@/modules/access";
import {
  BankPanel,
  CompensationPanel,
  DocumentsPanel,
  EditableSection,
  EmergencyContactsPanel,
  LoginPanel,
  StatusPanel,
} from "./profile-panels";
import { PayExtrasPanel } from "./pay-extras";
import { TimeTab } from "./time-tab";

export const metadata: Metadata = { title: "Profile" };

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "personal", label: "Personal" },
  { key: "job", label: "Job" },
  { key: "pay", label: "Pay" },
  { key: "time", label: "Time & attendance" },
  { key: "leave", label: "Time off" },
  { key: "claims", label: "Claims" },
  { key: "documents", label: "Documents" },
  { key: "history", label: "History" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
/** Links to the old tab names keep working. */
const OLD_TABS: Record<string, TabKey> = { emergency: "personal", id: "personal", files: "documents", login: "job", pay: "pay" };

const label = (list: readonly { value: string; label: string }[], v: string | null) => list.find((o) => o.value === v)?.label ?? titleCase(v);

export default async function ProfilePage(props: PageProps<"/app/people/[id]">) {
  const { id } = await props.params;
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  const supabase = await createClient();

  const { data: e } = await supabase
    .from("employees")
    .select("*, department:departments!employees_business_id_department_id_fkey(name), position:positions(title), branch:branches(name)")
    .eq("id", id)
    .eq("business_id", active.business_id)
    .maybeSingle();
  if (!e) notFound();
  // Looked up separately: the database can't join a table to itself through the company-scoped link.
  const { data: manager } = e.manager_id
    ? await supabase.from("employees").select("id, first_name, last_name").eq("id", e.manager_id).maybeSingle()
    : { data: null };

  const isSelf = active.employee_id === id;
  const canEdit = can(ctx, "employees", "edit");
  // Pay is shown for people whose pay you can see: your own, or your team or company if the owner allowed it.
  const canSeePay = isSelf ? can(ctx, "compensation", "view") : can(ctx, "compensation", "view", "team");
  // Only tabs for switched-on tools and things this person is allowed to see.
  const show: Record<TabKey, boolean> = {
    overview: true,
    personal: true,
    job: true,
    pay: canSeePay,
    time: isEnabled(ctx, "attendance") && can(ctx, "attendance", "view"),
    leave: isEnabled(ctx, "leave") && can(ctx, "leave", "view"),
    claims: isEnabled(ctx, "claims") && can(ctx, "claims", "view"),
    documents: can(ctx, "documents", "view") || isSelf,
    history: true,
  };
  const tabs = TABS.filter((t) => show[t.key]);
  const wanted = (sp.tab && (OLD_TABS[sp.tab] ?? sp.tab)) as TabKey | undefined;
  const tab = tabs.find((t) => t.key === wanted)?.key ?? "overview";
  const status = statusMeta(e.status);
  const day = today(active.timezone);
  const position = (e.position as { title: string } | null)?.title;
  const department = (e.department as { name: string } | null)?.name;
  const branch = (e.branch as { name: string } | null)?.name;
  const service = lengthOfService(e.join_date, e.exit_date && e.exit_date < day ? e.exit_date : day);
  const name = fullName(e);
  const reportsTo = manager ? (
    <Link href={`/app/people/${manager.id}`} className="underline underline-offset-4">
      {fullName(manager)}
    </Link>
  ) : null;

  return (
    <div>
      <Link href="/app/people" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> People
      </Link>
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center">
        {canEdit ? (
          <PictureUpload target={id} name={name} path={e.photo_path} size="xl" />
        ) : (
          <Avatar name={name} path={e.photo_path} size="xl" />
        )}
        <div className="min-w-0">
          <h1 className="text-3xl sm:text-4xl">{name}</h1>
          <p className="mt-1 text-muted-foreground">{[position, department, branch].filter(Boolean).join(" · ") || "No job title yet"}</p>
          <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
            <StatusDot tone={status.tone}>{status.label}</StatusDot>
            {e.join_date && <span>Joined {formatDate(e.join_date, active.date_format)}</span>}
            {service && <span>{service} of service</span>}
            <span className="tabular">{e.employee_code}</span>
          </p>
        </div>
      </header>
      {sp.added && (
        <Alert tone="success" className="mb-6" title="Person added">
          Next, add their ID and bank details, upload their contract, or invite them to sign in from the Job tab.
        </Alert>
      )}

      <TabNav label="Profile sections" current={tab} tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: `/app/people/${id}?tab=${t.key}` }))} />

      {tab === "overview" && (
        <OverviewTab
          id={id}
          active={active}
          day={day}
          showTime={show.time}
          showLeave={show.leave}
          showPayDay={isEnabled(ctx, "payroll")}
          payScheduleId={e.pay_schedule_id}
          facts={[
            { label: "Reports to", value: reportsTo },
            { label: "Work email", value: e.work_email },
            { label: "Phone", value: e.phone },
            { label: "Contract", value: label(CONTRACT_TYPES, e.contract_type) },
            { label: "Probation ends", value: formatDate(e.probation_end_date, active.date_format) },
          ]}
        />
      )}

      {tab === "personal" && (
        <div className="space-y-10">
          <EditableSection
            title="About them"
            employeeId={id}
            section="personal"
            values={e}
            canEdit={canEdit}
            view={
              <DetailList
                items={[
                  { label: "First name", value: e.first_name },
                  { label: "Last name", value: e.last_name },
                  { label: "Goes by", value: e.preferred_name },
                  { label: "Gender", value: label(GENDERS, e.gender) },
                  { label: "Date of birth", value: formatDate(e.date_of_birth, active.date_format) },
                  { label: "Marital status", value: e.marital_status },
                  { label: "Nationality", value: label(NATIONALITIES, e.nationality) },
                  { label: "Works here on a permit", value: e.is_expatriate ? "Yes" : "No" },
                ]}
              />
            }
          />
          <EditableSection
            title="Contact"
            employeeId={id}
            section="contact"
            values={e}
            canEdit={canEdit}
            view={
              <DetailList
                items={[
                  { label: "Work email", value: e.work_email },
                  { label: "Personal email", value: e.personal_email },
                  { label: "Phone", value: e.phone },
                  { label: "Current address", value: e.current_address },
                  { label: "Home address", value: e.permanent_address },
                ]}
              />
            }
          />
          <EmergencyTab id={id} canEdit={canEdit} />
          <EditableSection
            title="ID and passport"
            employeeId={id}
            section="id"
            values={e}
            canEdit={canEdit}
            view={
              <DetailList
                items={[
                  { label: "National ID card no.", value: e.national_id },
                  { label: "Passport no.", value: e.passport_no },
                  { label: "Passport expires", value: formatDate(e.passport_expiry, active.date_format) },
                ]}
              />
            }
          />
        </div>
      )}

      {tab === "job" && (
        <div className="space-y-10">
          <EditableSection
            title="Job"
            employeeId={id}
            section="employment"
            values={e}
            canEdit={canEdit}
            org={canEdit ? await loadOrgOptions(supabase, active.business_id, id) : undefined}
            view={
              <DetailList
                items={[
                  { label: "Employee number", value: e.employee_code },
                  { label: "Contract", value: label(CONTRACT_TYPES, e.contract_type) },
                  { label: "Job title", value: position },
                  { label: "Department", value: department },
                  { label: "Location", value: branch },
                  { label: "Reports to", value: reportsTo },
                  { label: "Joined on", value: formatDate(e.join_date, active.date_format) },
                  { label: "Probation ends", value: formatDate(e.probation_end_date, active.date_format) },
                  { label: "Confirmed on", value: formatDate(e.confirmation_date, active.date_format) },
                  { label: "Contract ends", value: formatDate(e.contract_end_date, active.date_format) },
                  { label: "Notes", value: e.notes },
                ]}
              />
            }
          />
          <StatusPanel
            employeeId={id}
            canEdit={canEdit}
            status={e.status}
            exit={{ date: e.exit_date, reason: e.exit_reason, notes: e.exit_notes }}
            exitDateText={formatDate(e.exit_date, active.date_format)}
          />
          {can(ctx, "users", "view") && (
            <LoginTab id={id} businessId={active.business_id} canInvite={can(ctx, "users", "create")} isOwner={active.is_owner} email={e.work_email ?? e.personal_email ?? ""} />
          )}
        </div>
      )}

      {tab === "pay" && canSeePay && <PayTab id={id} currency={active.currency} dateFormat={active.date_format} canEdit={can(ctx, "compensation", "edit")} canCreate={can(ctx, "compensation", "create")} />}

      {tab === "time" && <TimeTab id={id} active={active} day={day} month={sp.month} />}

      {tab === "leave" && <LeaveTab id={id} active={active} />}

      {tab === "claims" && <ClaimsTab id={id} active={active} />}

      {tab === "documents" && (
        <FilesTab
          id={id}
          businessId={active.business_id}
          dateFormat={active.date_format}
          timezone={active.timezone}
          canCreate={can(ctx, "documents", "create")}
          canDelete={can(ctx, "documents", "delete")}
        />
      )}

      {tab === "history" && <HistoryTab id={id} dateFormat={active.date_format} timezone={active.timezone} showSensitive={canSeePay} />}
    </div>
  );
}

async function EmergencyTab({ id, canEdit }: { id: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("employee_emergency_contacts").select("*").eq("employee_id", id).order("is_primary", { ascending: false }).order("name");
  return <EmergencyContactsPanel employeeId={id} contacts={data ?? []} canEdit={canEdit} />;
}

async function PayTab({ id, currency, dateFormat, canEdit, canCreate }: { id: string; currency: string; dateFormat: string; canEdit: boolean; canCreate: boolean }) {
  const supabase = await createClient();
  const [{ data: comp }, { data: bank }, { data: extras }, { data: components }, { data: loans }] = await Promise.all([
    supabase.from("employee_compensation").select("*").eq("employee_id", id).order("effective_date", { ascending: false }),
    supabase.from("employee_bank_accounts").select("*").eq("employee_id", id).order("is_primary", { ascending: false }).limit(1),
    supabase.from("employee_pay_components").select("id, amount, start_date, end_date, component:pay_components(name, kind, calc_type, default_amount, default_percent)").eq("employee_id", id).order("start_date", { ascending: false }),
    supabase.from("pay_components").select("id, name, kind, calc_type, default_amount").eq("is_active", true).order("kind").order("sort").order("name"),
    supabase.from("loans").select("id, kind, principal, installment_amount, outstanding, start_date, status, reason").eq("employee_id", id).order("start_date", { ascending: false }),
  ]);
  return (
    <div className="space-y-10">
      <CompensationPanel
        employeeId={id}
        canCreate={canCreate}
        defaultCurrency={currency}
        rows={(comp ?? []).map((c) => ({
          id: c.id,
          when: formatDate(c.effective_date, dateFormat),
          amount: formatMoney(c.basic_salary, c.currency),
          basis: titleCase(c.pay_basis),
          reason: c.reason,
        }))}
      />
      <BankPanel employeeId={id} account={bank?.[0] ?? null} canEdit={canEdit || canCreate} />
      <PayExtrasPanel
        employeeId={id}
        canEdit={canEdit || canCreate}
        currency={currency}
        components={(components ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.kind === "earning" ? "added" : "taken off"})`, kind: c.kind, calc: c.calc_type, amount: Number(c.default_amount) }))}
        rows={(extras ?? []).map((x) => {
          const c = x.component as unknown as { name: string; kind: string; calc_type: string; default_amount: number; default_percent: number | null };
          return {
            id: x.id,
            name: c.name,
            kind: c.kind,
            amount:
              c.calc_type === "percent_of_basic"
                ? `${c.default_percent ?? 0}% of basic`
                : `${formatMoney(x.amount ?? c.default_amount, currency)}${c.calc_type === "per_day_present" ? " a day" : c.calc_type === "per_hour_worked" ? " an hour" : ""}`,
            from: formatDate(x.start_date, dateFormat),
            to: x.end_date ? formatDate(x.end_date, dateFormat) : null,
          };
        })}
        loans={(loans ?? []).map((l) => ({
          id: l.id,
          kind: l.kind,
          principal: formatMoney(l.principal, currency),
          installment: formatMoney(l.installment_amount, currency),
          outstanding: formatMoney(l.outstanding, currency),
          from: formatDate(l.start_date, dateFormat),
          status: l.status,
          reason: l.reason,
        }))}
      />
    </div>
  );
}

async function FilesTab({ id, businessId, dateFormat, timezone, canCreate, canDelete }: { id: string; businessId: string; dateFormat: string; timezone: string; canCreate: boolean; canDelete: boolean }) {
  const supabase = await createClient();
  const [{ data: docs }, { data: categories }] = await Promise.all([
    supabase.from("employee_documents").select("id, title, file_path, file_name, size_bytes, expiry_date, created_at, visible_to_employee, category:document_categories(name)").eq("employee_id", id).order("created_at", { ascending: false }),
    supabase.from("document_categories").select("id, name").eq("business_id", businessId).order("name"),
  ]);
  return (
    <DocumentsPanel
      employeeId={id}
      businessId={businessId}
      canCreate={canCreate}
      canDelete={canDelete}
      categories={(categories ?? []).map((c) => ({ value: c.id, label: c.name }))}
      docs={(docs ?? []).map((d) => ({
        id: d.id,
        title: d.title,
        path: d.file_path,
        fileName: d.file_name,
        size: d.size_bytes,
        category: (d.category as unknown as { name: string } | null)?.name ?? null,
        expiry: formatDate(d.expiry_date, dateFormat),
        expired: Boolean(d.expiry_date && d.expiry_date < today(timezone)),
        added: formatDate(d.created_at, dateFormat),
        hidden: !d.visible_to_employee,
      }))}
    />
  );
}

async function LoginTab({ id, businessId, canInvite, isOwner, email }: { id: string; businessId: string; canInvite: boolean; isOwner: boolean; email: string }) {
  const supabase = await createClient();
  const [{ data: member }, { data: invites }, { data: roles }] = await Promise.all([
    supabase.from("business_members").select("id, status, created_at, role:roles(name), user_id").eq("business_id", businessId).eq("employee_id", id).maybeSingle(),
    supabase.from("invitations").select("id, email, expires_at, created_at").eq("business_id", businessId).eq("employee_id", id).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()),
    supabase.from("roles").select("id, name, key, is_owner").eq("business_id", businessId).order("name"),
  ]);
  return (
    <LoginPanel
      employeeId={id}
      canInvite={canInvite}
      defaultEmail={email}
      member={member ? { role: (member.role as unknown as { name: string } | null)?.name ?? "", status: member.status } : null}
      pendingInvite={invites?.[0]?.email ?? null}
      roles={(roles ?? []).filter((r) => isOwner || !r.is_owner).map((r) => ({ value: r.id, label: r.name, isStaff: r.key === "employee" }))}
    />
  );
}

async function HistoryTab({ id, dateFormat, timezone, showSensitive }: { id: string; dateFormat: string; timezone: string; showSensitive: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.from("audit_log").select("id, action, entity_type, changes, created_at, actor_id").eq("subject_employee_id", id).order("created_at", { ascending: false }).limit(100);
  const rows = data ?? [];
  if (rows.length === 0) return <EmptyState title="No changes yet" description="Every change to this profile will be listed here with who made it and when." />;
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter(Boolean))] as string[];
  const { data: actors } = actorIds.length ? await supabase.from("profiles").select("id, full_name").in("id", actorIds) : { data: [] };
  const names = new Map((actors ?? []).map((a) => [a.id, a.full_name as string | null]));
  return (
    <ol className="space-y-0">
      {rows.map((r) => {
        const lines = r.action === "update" ? describeChanges(r.changes as Record<string, { from: unknown; to: unknown }> | null, { showSensitive }) : [];
        return (
          <li key={r.id} className="grid gap-1 border-b border-border py-4 sm:grid-cols-[11rem_1fr]">
            <span className="text-[13px] text-subtle-foreground tabular">{formatDateTime(r.created_at, dateFormat, timezone)}</span>
            <div>
              <p className="text-sm">
                <span className="text-foreground">{(r.actor_id && names.get(r.actor_id)) || "System"}</span>{" "}
                <span className="text-muted-foreground">
                  {actionVerb(r.action)} {entityLabel(r.entity_type)}
                </span>
              </p>
              {lines.length > 0 && (
                <ul className="mt-1 flex min-w-0 flex-wrap gap-1.5">
                  {lines.slice(0, 8).map((l) => (
                    <li key={l} className="max-w-full">
                      <Badge className="max-w-full whitespace-normal break-words">{l}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const LEAVE_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  pending: { label: "Waiting", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
const CLAIM_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  pending: { label: "Waiting", tone: "warning" },
  approved: { label: "Approved", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
const days = (v: number | string) => {
  const x = Number(v);
  return Number.isInteger(x) ? String(x) : x.toFixed(1);
};

function Figure({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="font-display mt-3 text-3xl tabular">{value}</p>
      {caption && <p className="mt-1 text-[13px] text-subtle-foreground">{caption}</p>}
    </div>
  );
}

/** Key numbers at a glance: this month's attendance, time off left, next pay day. */
async function OverviewTab({
  id,
  active,
  day,
  showTime,
  showLeave,
  showPayDay,
  payScheduleId,
  facts,
}: {
  id: string;
  active: BusinessAccess;
  day: string;
  showTime: boolean;
  showLeave: boolean;
  showPayDay: boolean;
  payScheduleId: string | null;
  facts: { label: string; value: React.ReactNode }[];
}) {
  const supabase = await createClient();
  const monthStart = `${day.slice(0, 7)}-01`;
  const none = Promise.resolve({ data: null, count: null });
  const [month, balances, schedule] = await Promise.all([
    // This month's numbers, brought up to date first (the same numbers payroll uses).
    showTime
      ? supabase
          .rpc("refresh_attendance_month", { p_business: active.business_id, p_month: monthStart, p_employee: id })
          .then(() => supabase.from("attendance_months").select("days_present, half_days, late_count, unapproved_absences").eq("employee_id", id).eq("month", monthStart).maybeSingle())
      : none,
    showLeave ? supabase.rpc("employee_leave_balances", { p_business: active.business_id, p_employee: id }) : none,
    showPayDay
      ? payScheduleId
        ? supabase.from("pay_schedules").select("pay_day").eq("id", payScheduleId).maybeSingle()
        : supabase.from("pay_schedules").select("pay_day").eq("business_id", active.business_id).eq("is_default", true).maybeSingle()
      : none,
  ]);
  const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(`${monthStart}T00:00:00Z`));
  const leaveRows = ((balances.data ?? []) as { leave_type_id: string; name: string; color: string; accrual_method: string; balance: number; pending: number }[]).filter(
    (b) => b.accrual_method !== "none",
  );
  const payDay = (schedule.data as { pay_day: number } | null)?.pay_day;
  const m = month.data as { days_present: number; half_days: number; late_count: number; unapproved_absences: number } | null;
  const next = payDay ? nextPayDay(payDay, day) : null;

  return (
    <div className="space-y-10">
      {(showTime || next) && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {showTime && (
            <Figure
              label={`Days present in ${monthName}`}
              value={String(m?.days_present ?? 0)}
              caption={[m?.half_days ? `plus ${m.half_days} half ${m.half_days === 1 ? "day" : "days"}` : "", m?.unapproved_absences ? `${m.unapproved_absences} absent` : ""].filter(Boolean).join(" · ") || "So far this month"}
            />
          )}
          {showTime && <Figure label={`Late in ${monthName}`} value={String(m?.late_count ?? 0)} caption={m?.late_count ? "Days they arrived late" : "On time every day"} />}
          {next && (
            <Figure
              label="Next pay day"
              value={formatDate(next.date, active.date_format)}
              caption={next.days === 0 ? "Today" : `In ${next.days} ${next.days === 1 ? "day" : "days"}`}
            />
          )}
        </div>
      )}
      {showLeave && (
        <section>
          <h2 className="mb-3 text-lg">Time off left this year</h2>
          {leaveRows.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {leaveRows.map((b) => (
                <div key={b.leave_type_id} className="rounded-xl border border-border p-4">
                  <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <span className="size-2 rounded-full" style={{ background: b.color }} aria-hidden /> {b.name}
                  </p>
                  <p className="font-display mt-2 text-2xl tabular">
                    {days(b.balance)} <span className="text-sm text-subtle-foreground">days</span>
                  </p>
                  {Number(b.pending) > 0 && <p className="text-[12px] text-subtle-foreground">{days(b.pending)} waiting for approval</p>}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No time off types that build up yet.</p>
          )}
        </section>
      )}
      <section>
        <h2 className="mb-3 text-lg">At a glance</h2>
        <DetailList items={facts} />
      </section>
    </div>
  );
}

/** Balances and their time off requests. */
async function LeaveTab({ id, active }: { id: string; active: BusinessAccess }) {
  const supabase = await createClient();
  const [{ data: balances }, { data: requests }] = await Promise.all([
    supabase.rpc("employee_leave_balances", { p_business: active.business_id, p_employee: id }),
    supabase.from("leave_requests").select("id, start_date, end_date, days, status, reason, type:leave_types(name, color)").eq("employee_id", id).order("start_date", { ascending: false }).limit(30),
  ]);
  const rows = (balances ?? []) as { leave_type_id: string; name: string; color: string; accrual_method: string; balance: number; taken: number; pending: number }[];
  return (
    <div className="space-y-10">
      {rows.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Type</Th>
              <Th className="text-right">Left</Th>
              <Th className="text-right">Taken</Th>
              <Th className="text-right">Waiting</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <Tr key={b.leave_type_id}>
                <Td>
                  <span className="flex items-center gap-2">
                    <span className="size-2 rounded-full" style={{ background: b.color }} aria-hidden /> {b.name}
                  </span>
                </Td>
                <Td className="text-right tabular">{b.accrual_method === "none" ? "–" : days(b.balance)}</Td>
                <Td className="text-right tabular">{days(b.taken)}</Td>
                <Td className="text-right tabular">{days(b.pending)}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <section>
        <h2 className="mb-3 text-lg">Requests</h2>
        {requests?.length ? (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Type</Th>
                <Th className="text-right">Days</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const t = r.type as unknown as { name: string; color: string } | null;
                const s = LEAVE_STATUS[r.status] ?? LEAVE_STATUS.pending;
                return (
                  <Tr key={r.id}>
                    <Td className="tabular">
                      {formatDate(r.start_date, active.date_format)}
                      {r.end_date !== r.start_date && <span className="block text-[12px] text-subtle-foreground">to {formatDate(r.end_date, active.date_format)}</span>}
                    </Td>
                    <Td>
                      {t?.name}
                      {r.reason && <span className="block text-[12px] text-subtle-foreground">{r.reason}</span>}
                    </Td>
                    <Td className="text-right tabular">{days(r.days)}</Td>
                    <Td>
                      <StatusDot tone={s.tone}>{s.label}</StatusDot>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        ) : (
          <EmptyState title="No time off yet" description="Time off they ask for, or that you enter for them, shows here." />
        )}
      </section>
    </div>
  );
}

/** Their claims. */
async function ClaimsTab({ id, active }: { id: string; active: BusinessAccess }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("claims")
    .select("id, claim_date, amount, currency, status, description, route, type:claim_types(name)")
    .eq("employee_id", id)
    .order("claim_date", { ascending: false })
    .limit(30);
  if (!data?.length) return <EmptyState title="No claims yet" description="Claims they send from the staff app show here." />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Date</Th>
          <Th>What</Th>
          <Th className="text-right">Amount</Th>
          <Th>Status</Th>
        </tr>
      </thead>
      <tbody>
        {data.map((c) => {
          const s = CLAIM_STATUS[c.status] ?? CLAIM_STATUS.pending;
          return (
            <Tr key={c.id}>
              <Td className="tabular">{formatDate(c.claim_date, active.date_format)}</Td>
              <Td>
                {(c.type as unknown as { name: string } | null)?.name}
                {(c.route || c.description) && <span className="block text-[12px] text-subtle-foreground">{[c.route, c.description].filter(Boolean).join(" · ")}</span>}
              </Td>
              <Td className="text-right tabular">{formatMoney(c.amount, c.currency)}</Td>
              <Td>
                <StatusDot tone={s.tone}>{s.label}</StatusDot>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
