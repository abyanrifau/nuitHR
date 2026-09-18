import type { Metadata } from "next";
import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Pagination, SortTh, StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate, fullName, initials } from "@/lib/format";
import { statusMeta } from "@/lib/people/constants";
import { PAGE_SIZE, peopleQuery } from "@/lib/people/query";
import { can } from "@/modules/access";

export const metadata: Metadata = { title: "People" };

interface Row {
  id: string;
  employee_code: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  status: string;
  join_date: string | null;
  department: { name: string } | null;
  position: { title: string } | null;
  branch: { name: string } | null;
}

export default async function PeoplePage(props: PageProps<"/app/people">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "employees", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see people&apos;s profiles.
      </Alert>
    );
  }
  const page = Math.max(1, Number(sp.page) || 1);
  const supabase = await createClient();
  const [{ data, count, error }, { data: departments }, { data: branches }] = await Promise.all([
    peopleQuery(
      supabase,
      active.business_id,
      sp,
      "id, employee_code, first_name, last_name, preferred_name, status, join_date, department:departments!employees_business_id_department_id_fkey(name), position:positions(title), branch:branches(name)",
      { count: true },
    ).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1),
    supabase.from("departments").select("id, name").eq("business_id", active.business_id).order("name"),
    supabase.from("branches").select("id, name").eq("business_id", active.business_id).order("name"),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const canAdd = can(ctx, "employees", "create");
  const canExport = can(ctx, "employees", "export");
  const filtered = Boolean(sp.q || sp.department || sp.branch || (sp.status && sp.status !== "current"));
  const exportQuery = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]);

  return (
    <div>
      <PageHeader
        label="foundation"
        title="People"
        description="Everyone who works for you. Search by name, number or email."
        actions={
          <>
            {canExport && (
              <a href={`/app/people/export?${exportQuery}`} className={buttonClasses({ variant: "secondary" })}>
                <Download className="size-4" aria-hidden /> Export CSV
              </a>
            )}
            {canAdd && (
              <Link href="/app/people/new" className={buttonClasses()}>
                <Plus className="size-4" aria-hidden /> Add person
              </Link>
            )}
          </>
        }
      />

      <ListToolbar
        placeholder="Search people"
        filters={[
          {
            name: "status",
            label: "Current staff",
            options: [
              { value: "all", label: "Everyone" },
              { value: "active", label: "Active" },
              { value: "probation", label: "On probation" },
              { value: "on_leave", label: "On leave" },
              { value: "suspended", label: "Suspended" },
              { value: "left", label: "Left the company" },
            ],
          },
          ...(departments?.length ? [{ name: "department", label: "All departments", options: departments.map((d) => ({ value: d.id, label: d.name })) }] : []),
          ...(branches && branches.length > 1 ? [{ name: "branch", label: "All locations", options: branches.map((b) => ({ value: b.id, label: b.name })) }] : []),
        ]}
      />

      {error ? (
        <Alert tone="danger" title="Couldn't load people">
          {error.message}
        </Alert>
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState title="Nobody matches" description="Try a different search or clear the filters." />
        ) : (
          <EmptyState
            title="No people yet"
            description="Add the people who work for you, one at a time here or all at once from a spreadsheet in Workspace → Tools → People directory."
            action={
              canAdd ? (
                <Link href="/app/people/new" className={buttonClasses()}>
                  Add your first person
                </Link>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <SortTh field="name" label="Name" params={sp} basePath="/app/people" />
                <SortTh field="code" label="No." params={sp} basePath="/app/people" className="hidden sm:table-cell" />
                <Th className="hidden md:table-cell">Job</Th>
                <Th className="hidden lg:table-cell">Location</Th>
                <SortTh field="joined" label="Joined" params={sp} basePath="/app/people" className="hidden md:table-cell" />
                <SortTh field="status" label="Status" params={sp} basePath="/app/people" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = statusMeta(r.status);
                return (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/app/people/${r.id}`} className="flex items-center gap-3 hover:underline">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-[11px] text-muted-foreground">
                          {initials(r)}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">{fullName(r)}</span>
                          <span className="block truncate text-[13px] text-subtle-foreground md:hidden">{r.position?.title ?? r.department?.name ?? ""}</span>
                        </span>
                      </Link>
                    </Td>
                    <Td className="hidden text-muted-foreground tabular sm:table-cell">{r.employee_code}</Td>
                    <Td className="hidden md:table-cell">
                      <span className="block text-foreground">{r.position?.title ?? "No job title"}</span>
                      <span className="block text-[13px] text-subtle-foreground">{r.department?.name}</span>
                    </Td>
                    <Td className="hidden text-muted-foreground lg:table-cell">{r.branch?.name}</Td>
                    <Td className="hidden text-muted-foreground tabular md:table-cell">{formatDate(r.join_date, active.date_format)}</Td>
                    <Td>
                      <StatusDot tone={s.tone}>{s.label}</StatusDot>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} params={sp} basePath="/app/people" />
        </>
      )}
    </div>
  );
}
