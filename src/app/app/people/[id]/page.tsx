import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DetailList, EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { actionVerb, describeChanges, entityLabel } from "@/lib/audit";
import { formatDate, formatDateTime, formatMoney, fullName, initials, titleCase, today } from "@/lib/format";
import { CONTRACT_TYPES, GENDERS, NATIONALITIES, statusMeta } from "@/lib/people/constants";
import { loadOrgOptions } from "@/lib/people/org-options";
import { can } from "@/modules/access";
import { cn } from "@/lib/utils";
import {
  BankPanel,
  CompensationPanel,
  DocumentsPanel,
  EditableSection,
  EmergencyContactsPanel,
  LoginPanel,
  StatusPanel,
} from "./profile-panels";

export const metadata: Metadata = { title: "Profile" };

const TABS = [
  { key: "personal", label: "Personal" },
  { key: "job", label: "Job" },
  { key: "emergency", label: "Emergency" },
  { key: "id", label: "ID" },
  { key: "pay", label: "Salary & bank", needs: "compensation" },
  { key: "files", label: "Files", needs: "documents" },
  { key: "login", label: "Login", needs: "users" },
  { key: "history", label: "History" },
] as const;

const label = (list: readonly { value: string; label: string }[], v: string | null) => list.find((o) => o.value === v)?.label ?? v ?? "";

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
  const canSeePay = can(ctx, "compensation", "view");
  const tabs = TABS.filter((t) => !("needs" in t) || can(ctx, t.needs, "view") || (t.needs === "documents" && isSelf));
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "personal";
  const status = statusMeta(e.status);

  return (
    <div>
      <PageHeader
        back={{ href: "/app/people", label: "People" }}
        title={
          <span className="flex items-center gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-full border border-border text-base text-muted-foreground">{initials(e)}</span>
            <span className="min-w-0">
              {fullName(e)}
              <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-sm text-muted-foreground">
                <span>{(e.position as { title: string } | null)?.title ?? "No job title"}</span>
                <span className="tabular">{e.employee_code}</span>
                <StatusDot tone={status.tone}>{status.label}</StatusDot>
              </span>
            </span>
          </span>
        }
      />
      {sp.added && (
        <Alert tone="success" className="mb-6" title="Person added">
          Next, add their ID and bank details, upload their contract, or invite them to sign in from the Login tab.
        </Alert>
      )}

      <nav aria-label="Profile sections" className="-mx-4 mb-8 overflow-x-auto border-b border-border px-4 [scrollbar-width:none]">
        <ul className="flex gap-6">
          {tabs.map((t) => (
            <li key={t.key}>
              <Link
                href={`/app/people/${id}?tab=${t.key}`}
                aria-current={t.key === tab ? "page" : undefined}
                className={cn(
                  "-mb-px block border-b py-3 text-sm whitespace-nowrap",
                  t.key === tab ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

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
                  { label: "Job title", value: (e.position as { title: string } | null)?.title },
                  { label: "Department", value: (e.department as { name: string } | null)?.name },
                  { label: "Location", value: (e.branch as { name: string } | null)?.name },
                  {
                    label: "Reports to",
                    value: manager ? (
                      <Link href={`/app/people/${manager.id}`} className="underline underline-offset-4">
                        {fullName(manager)}
                      </Link>
                    ) : null,
                  },
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
        </div>
      )}

      {tab === "emergency" && <EmergencyTab id={id} canEdit={canEdit} />}

      {tab === "id" && (
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
      )}

      {tab === "pay" && canSeePay && <PayTab id={id} currency={active.currency} dateFormat={active.date_format} canEdit={can(ctx, "compensation", "edit")} canCreate={can(ctx, "compensation", "create")} />}

      {tab === "files" && (
        <FilesTab
          id={id}
          businessId={active.business_id}
          dateFormat={active.date_format}
          timezone={active.timezone}
          canCreate={can(ctx, "documents", "create")}
          canDelete={can(ctx, "documents", "delete")}
        />
      )}

      {tab === "login" && <LoginTab id={id} businessId={active.business_id} canInvite={can(ctx, "users", "create")} isOwner={active.is_owner} email={e.work_email ?? e.personal_email ?? ""} />}

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
  const [{ data: comp }, { data: bank }] = await Promise.all([
    supabase.from("employee_compensation").select("*").eq("employee_id", id).order("effective_date", { ascending: false }),
    supabase.from("employee_bank_accounts").select("*").eq("employee_id", id).order("is_primary", { ascending: false }).limit(1),
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
