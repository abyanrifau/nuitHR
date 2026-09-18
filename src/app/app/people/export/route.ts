import { NextResponse, type NextRequest } from "next/server";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";
import { formatDate, today } from "@/lib/format";
import { statusMeta } from "@/lib/people/constants";
import { peopleQuery } from "@/lib/people/query";
import { can } from "@/modules/access";

interface Row {
  employee_code: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  status: string;
  work_email: string | null;
  phone: string | null;
  nationality: string | null;
  join_date: string | null;
  contract_type: string;
  exit_date: string | null;
  manager_id: string | null;
  id: string;
  department: { name: string } | null;
  position: { title: string } | null;
  branch: { name: string } | null;
}

/** Downloads the people list (with the same filters as the page) as a spreadsheet file. */
export async function GET(req: NextRequest) {
  const active = await getActiveBusiness();
  if (!active) return new NextResponse("Sign in first.", { status: 401 });
  if (!can(toAccessContext(active), "employees", "export")) return new NextResponse("You don't have permission to export people.", { status: 403 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const supabase = await createClient();
  const { data, error } = await peopleQuery(
    supabase,
    active.business_id,
    sp,
    "id, employee_code, first_name, last_name, preferred_name, status, work_email, phone, nationality, join_date, contract_type, exit_date, manager_id, department:departments!employees_business_id_department_id_fkey(name), position:positions(title), branch:branches(name)",
  ).limit(5000);
  if (error) return new NextResponse(error.message, { status: 500 });
  const rows = (data ?? []) as unknown as Row[];
  // Managers may be outside the filtered list, so look their names up separately.
  const { data: all } = await supabase.from("employees").select("id, first_name, last_name").eq("business_id", active.business_id).limit(5000);
  const names = new Map((all ?? []).map((r) => [r.id, `${r.first_name} ${r.last_name}`.trim()]));
  const csv = toCsv([
    ["Employee no.", "First name", "Last name", "Preferred name", "Status", "Job title", "Department", "Location", "Manager", "Work email", "Phone", "Nationality", "Contract", "Joined", "Left"],
    ...rows.map((r) => [
      r.employee_code,
      r.first_name,
      r.last_name,
      r.preferred_name,
      statusMeta(r.status).label,
      r.position?.title,
      r.department?.name,
      r.branch?.name,
      r.manager_id ? (names.get(r.manager_id) ?? "") : "",
      r.work_email,
      r.phone,
      r.nationality,
      r.contract_type,
      formatDate(r.join_date, active.date_format),
      formatDate(r.exit_date, active.date_format),
    ]),
  ]);
  const date = today(active.timezone);
  return new NextResponse("﻿" + csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="people-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}
