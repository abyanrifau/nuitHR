import { NextResponse } from "next/server";
import JSZip from "jszip";
import { getActiveBusiness, getSessionUser, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";
import { can } from "@/modules/access";
import { today } from "@/lib/format";

export const maxDuration = 60;

/**
 * Everything your company has stored, one spreadsheet (CSV) per table,
 * zipped. Read with your own login, so it contains exactly what you're
 * allowed to see (for example no salaries unless you can see salaries).
 */
const TABLES = [
  "businesses", "branches", "departments", "positions", "employees", "employee_emergency_contacts", "employee_bank_accounts",
  "employee_compensation", "custom_field_definitions", "roles", "role_permissions", "business_members", "business_modules",
  "approval_workflows", "approval_workflow_steps", "approval_requests", "approval_request_steps", "approval_delegations",
  "document_categories", "employee_documents", "letter_templates", "generated_letters", "letter_requests", "announcements", "audit_log",
  "shifts", "attendance_policies", "roster_entries", "timesheets", "attendance_records", "attendance_breaks", "attendance_corrections",
  "leave_types", "public_holidays", "leave_balances", "leave_requests", "leave_adjustments",
  "vacancies", "candidates", "applications", "candidate_notes", "interviews", "offers",
  "checklist_templates", "checklist_template_tasks", "employee_checklists", "employee_checklist_tasks",
  "compliance_types", "compliance_items",
  "pay_schedules", "pay_components", "employee_pay_components", "pension_schemes", "tax_tables", "tax_brackets",
  "payroll_runs", "payroll_run_employees", "payroll_run_lines", "loans", "loan_repayments", "final_settlements",
  "claim_types", "claims", "transport_claims", "expense_categories", "expense_claims",
  "courses", "course_lessons", "course_assignments", "course_enrollments", "training_sponsorships",
  "review_templates", "review_questions", "review_cycles", "goals", "goal_updates", "reviews",
];

function cell(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return JSON.stringify(v);
  return v as string | number;
}

export async function GET() {
  const user = await getSessionUser();
  const active = await getActiveBusiness();
  if (!user || !active) return new NextResponse("Sign in first.", { status: 401 });
  if (!can(toAccessContext(active), "data_export", "create")) return new NextResponse("You don't have permission to export company data.", { status: 403 });

  const supabase = await createClient();
  const { data: job } = await supabase.from("data_exports").insert({ business_id: active.business_id, kind: "full", status: "running" }).select("id").single();
  const zip = new JSZip();
  const summary: string[] = [];
  try {
    for (const table of TABLES) {
      const rows: Record<string, unknown>[] = [];
      const column = table === "businesses" ? "id" : "business_id";
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from(table).select("*").eq(column, active.business_id).range(from, from + 999);
        if (error || !data?.length) break;
        rows.push(...data);
        if (data.length < 1000) break;
      }
      summary.push(`${table}: ${rows.length} rows`);
      if (!rows.length) continue;
      const headers = Object.keys(rows[0]);
      zip.file(`${table}.csv`, "﻿" + toCsv([headers, ...rows.map((r) => headers.map((h) => cell(r[h])))]));
    }
    zip.file(
      "README.txt",
      `Data export for ${active.business_name}\nMade ${new Date().toISOString()} by ${user.email}\n\nEach file is one table, openable in Excel or Google Sheets.\nIt includes only what this login is allowed to see. Uploaded files (contracts, photos) are not included; download them from each person's profile.\n\n${summary.join("\n")}\n`,
    );
    const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    if (job) await supabase.from("data_exports").update({ status: "ready", completed_at: new Date().toISOString() }).eq("id", job.id);
    const date = today(active.timezone);
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="company-data-${date}.zip"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (job) await supabase.from("data_exports").update({ status: "failed", error: (e as Error).message }).eq("id", job.id);
    return new NextResponse("The export didn't finish. Please try again.", { status: 500 });
  }
}
