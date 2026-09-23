import type { Metadata } from "next";
import Link from "next/link";
import { FileUp } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { buttonClasses } from "@/components/ui/button";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Pagination, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, fullName, localDay, titleCase } from "@/lib/format";
import { peopleQuery } from "@/lib/people/query";
import { can } from "@/modules/access";
import { BulkSalaryButton, EditSalaryButton } from "./salaries-client";

export const metadata: Metadata = { title: "Salaries" };

const PAGE = 50;

type Row = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  employee_code: string | null;
  photo_path: string | null;
  pay_schedule_id: string | null;
  department: { name: string } | null;
  position: { title: string } | null;
};

type Comp = { employee_id: string; basic_salary: number; currency: string; pay_basis: string; effective_date: string };

/** Everyone's basic salary, pay schedule and the date it started. Only the owner and payroll by default. */
export default async function SalariesPage(props: PageProps<"/app/payroll/salaries">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "compensation", "view", "all")) {
    return (
      <Alert tone="warning" title="No access">
        Salaries are only shown to the owner and payroll, or people the owner has given pay access to.
      </Alert>
    );
  }
  const canEdit = can(ctx, "compensation", "edit", "all");
  const today = localDay(new Date(), active.timezone);
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const b = active.business_id;

  // People with a salary (for the "no salary yet" filter).
  let withSalary: string[] | null = null;
  if (sp.salary) {
    const { data } = await supabase.from("employee_compensation").select("employee_id").eq("business_id", b).lte("effective_date", today).limit(10000);
    withSalary = [...new Set((data ?? []).map((r) => r.employee_id))];
  }
  const filtered = (select: string, count = false) => {
    let q = peopleQuery(supabase, b, { ...sp, status: "current" }, select, { count });
    if (sp.schedule) q = sp.schedule === "none" ? q.is("pay_schedule_id", null) : q.eq("pay_schedule_id", sp.schedule);
    if (withSalary) q = sp.salary === "missing" ? (withSalary.length ? q.not("id", "in", `(${withSalary.join(",")})`) : q) : q.in("id", withSalary.length ? withSalary : ["00000000-0000-0000-0000-000000000000"]);
    return q;
  };

  const [{ data, count }, { data: allMatching }, { data: everyone }, { data: departments }, { data: branches }, { data: schedules }] = await Promise.all([
    filtered(
      "id, first_name, last_name, preferred_name, employee_code, photo_path, pay_schedule_id, department:departments!employees_business_id_department_id_fkey(name), position:positions(title)",
      true,
    ).range((page - 1) * PAGE, page * PAGE - 1),
    canEdit ? filtered("id").limit(3000) : Promise.resolve({ data: [] as { id: string }[] }),
    canEdit
      ? supabase.from("employees").select("id, department_id, branch_id").eq("business_id", b).in("status", ["active", "probation", "on_leave", "suspended"]).limit(3000)
      : Promise.resolve({ data: [] as { id: string; department_id: string | null; branch_id: string | null }[] }),
    supabase.from("departments").select("id, name").eq("business_id", b).eq("is_active", true).order("name"),
    supabase.from("branches").select("id, name").eq("business_id", b).order("name"),
    supabase.from("pay_schedules").select("id, name, is_default").eq("business_id", b).eq("is_active", true).order("name"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const { data: comps } = rows.length
    ? await supabase
        .from("employee_compensation")
        .select("employee_id, basic_salary, currency, pay_basis, effective_date")
        .eq("business_id", b)
        .in("employee_id", rows.map((r) => r.id))
        .order("effective_date", { ascending: false })
    : { data: [] as Comp[] };
  const current = new Map<string, Comp>();
  const next = new Map<string, Comp>();
  for (const c of (comps ?? []) as Comp[]) {
    if (c.effective_date <= today) {
      if (!current.has(c.employee_id)) current.set(c.employee_id, c);
    } else next.set(c.employee_id, c); // ordered newest first, so the soonest future change wins
  }
  const defaultSchedule = (schedules ?? []).find((s) => s.is_default);
  const scheduleName = new Map((schedules ?? []).map((s) => [s.id, s.name]));
  const scheduleOpts = (schedules ?? []).map((s) => ({ value: s.id, label: s.name }));

  return (
    <div>
      <PageHeader
        label="pay"
        title="Salaries"
        description="Each person's basic salary, pay schedule and the date it started. A change starts on its own date and the earlier salaries are kept, so payroll always uses the right one."
        actions={
          canEdit ? (
            <>
              <Link href="/app/payroll/salaries/import" className={buttonClasses({ variant: "secondary" })}>
                <FileUp className="size-4" aria-hidden /> Import from a file
              </Link>
              <BulkSalaryButton
                today={today}
                currency={active.currency}
                matching={((allMatching ?? []) as unknown as { id: string }[]).map((r) => r.id)}
                everyone={everyone ?? []}
                departments={(departments ?? []).map((d) => ({ value: d.id, label: d.name }))}
                branches={(branches ?? []).map((x) => ({ value: x.id, label: x.name }))}
              />
            </>
          ) : undefined
        }
      />
      <ListToolbar
        placeholder="Search by name or staff number"
        filters={[
          ...(departments?.length ? [{ name: "department", label: "All departments", options: departments.map((d) => ({ value: d.id, label: d.name })) }] : []),
          ...(branches && branches.length > 1 ? [{ name: "branch", label: "All locations", options: branches.map((x) => ({ value: x.id, label: x.name })) }] : []),
          ...(schedules && schedules.length ? [{ name: "schedule", label: "Any pay schedule", options: [...scheduleOpts, { value: "none", label: "No schedule set" }] }] : []),
          {
            name: "salary",
            label: "With or without salary",
            options: [
              { value: "set", label: "Salary added" },
              { value: "missing", label: "No salary yet" },
            ],
          },
        ]}
      />
      {rows.length ? (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th className="text-right">Basic salary</Th>
                <Th className="hidden md:table-cell">Pay schedule</Th>
                <Th className="hidden sm:table-cell">Since</Th>
                {canEdit && (
                  <Th>
                    <span className="sr-only">Change</span>
                  </Th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pay = current.get(r.id);
                const upcoming = next.get(r.id);
                const name = fullName(r);
                return (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/app/people/${r.id}?tab=pay`} className="flex items-center gap-3 hover:underline">
                        <Avatar name={name} path={r.photo_path} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">{name}</span>
                          <span className="block truncate text-[13px] text-subtle-foreground">
                            {[r.employee_code, r.department?.name ?? r.position?.title].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                      </Link>
                    </Td>
                    <Td className="text-right tabular">
                      {pay ? (
                        <>
                          {formatMoney(pay.basic_salary, pay.currency)}
                          {pay.pay_basis !== "monthly" && <span className="block text-[12px] text-subtle-foreground">{titleCase(pay.pay_basis)}</span>}
                        </>
                      ) : (
                        <span className="text-subtle-foreground">Not added</span>
                      )}
                      {upcoming && (
                        <span className="block text-[12px] text-info">
                          {formatMoney(upcoming.basic_salary, upcoming.currency)} from {formatDate(upcoming.effective_date, active.date_format)}
                        </span>
                      )}
                    </Td>
                    <Td className="hidden text-muted-foreground md:table-cell">
                      {r.pay_schedule_id ? scheduleName.get(r.pay_schedule_id) : defaultSchedule ? `${defaultSchedule.name} (default)` : "–"}
                    </Td>
                    <Td className="hidden text-muted-foreground tabular sm:table-cell">{pay ? formatDate(pay.effective_date, active.date_format) : ""}</Td>
                    {canEdit && (
                      <Td className="text-right">
                        <EditSalaryButton
                          employeeId={r.id}
                          name={name}
                          today={today}
                          currency={active.currency}
                          current={pay ? { basic_salary: pay.basic_salary, pay_basis: pay.pay_basis } : null}
                          scheduleId={r.pay_schedule_id}
                          schedules={scheduleOpts}
                          dateFormat={active.date_format}
                        />
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE} total={count ?? rows.length} params={sp} basePath="/app/payroll/salaries" />
        </>
      ) : (
        <EmptyState
          title={sp.q || sp.department || sp.branch || sp.schedule || sp.salary ? "No one matches" : "No one here yet"}
          description={sp.q || sp.department || sp.branch || sp.schedule || sp.salary ? "Try a different search or filter." : "Add people first, then their salaries here."}
        />
      )}
      <p className="mt-3 text-[12px] text-subtle-foreground">
        Allowances and deductions are set up in Pay, Allowances &amp; deductions. Claims people send in are kept separately, in Claims.
      </p>
    </div>
  );
}
