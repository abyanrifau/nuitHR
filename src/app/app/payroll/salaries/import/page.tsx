import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { can } from "@/modules/access";
import { SalaryImport } from "./import-client";

export const metadata: Metadata = { title: "Import salaries" };

/** Salaries from a CSV or Excel file: staff number, salary and start date. Checked in full before anything is saved. */
export default async function SalaryImportPage() {
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "compensation", "edit", "all")) {
    return <Alert tone="warning" title="No access">Only the owner and payroll can change salaries.</Alert>;
  }
  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ href: "/app/payroll/salaries", label: "Salaries" }}
        title="Import salaries"
        description="Add or change many salaries from a file. Each row is a new salary from its date; earlier salaries are kept. Nothing is saved until every row is right."
      />
      <SalaryImport dayFirst={!active.date_format.startsWith("MM")} currency={active.currency} />
    </div>
  );
}
