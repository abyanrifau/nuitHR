import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { can } from "@/modules/access";
import { ImportWizard } from "./import-client";

export const metadata: Metadata = { title: "Import from a clock machine" };

/** Import a fingerprint or face machine's file: match its columns, see every problem, then import. */
export default async function ImportPage() {
  const active = (await getActiveBusiness())!;
  if (!can(toAccessContext(active), "attendance", "edit")) {
    return <Alert tone="warning" title="No access">Ask the owner or an admin if you need to import time records.</Alert>;
  }
  return (
    <div className="max-w-4xl">
      <PageHeader
        back={{ href: "/app/time", label: "Time" }}
        title="Import from a clock machine"
        description="Bring in clock times from a fingerprint or face machine's file. Nothing is saved until you've checked it."
      />
      <ImportWizard dayFirst={!active.date_format.startsWith("MM")} />
    </div>
  );
}
