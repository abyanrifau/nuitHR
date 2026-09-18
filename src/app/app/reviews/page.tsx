import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/access";
import { NewRoundButton } from "./reviews-client";

export const metadata: Metadata = { title: "Reviews" };

const CYCLE = {
  draft: { label: "Not opened yet", tone: "neutral" },
  open: { label: "Open", tone: "info" },
  closed: { label: "Closed", tone: "success" },
} as const;

export default async function ReviewsPage() {
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "reviews", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see reviews. Your own review is in the staff app.
      </Alert>
    );
  }
  const supabase = await createClient();
  const [{ data: cycles }, { data: templates }, { data: departments }] = await Promise.all([
    supabase
      .from("review_cycles")
      .select("id, name, status, period_start, period_end, self_review_due, manager_review_due, reviews(status)")
      .eq("business_id", active.business_id)
      .order("period_start", { ascending: false }),
    supabase.from("review_templates").select("id, name, is_default").eq("business_id", active.business_id).order("is_default", { ascending: false }),
    supabase.from("departments").select("id, name").eq("business_id", active.business_id).eq("is_active", true).order("name"),
  ]);
  const canRun = can(ctx, "reviews", "edit");

  return (
    <div>
      <PageHeader
        label="grow"
        title="Reviews"
        description="Run a review round: everyone rates themselves, their manager adds their view, then you share it with them."
        actions={
          canRun && templates?.length ? (
            <NewRoundButton templates={(templates ?? []).map((t) => ({ value: t.id, label: t.name }))} departments={(departments ?? []).map((d) => ({ value: d.id, label: d.name }))} />
          ) : undefined
        }
      />
      {!templates?.length && (
        <Alert tone="info" className="mb-6">
          Switch on Reviews &amp; goals in Workspace → Tools to get the starter review questions.
        </Alert>
      )}
      {cycles?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Round</Th>
              <Th>Period</Th>
              <Th>Finished</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((c) => {
              const rv = (c.reviews ?? []) as { status: string }[];
              const done = rv.filter((r) => ["finalized", "shared", "acknowledged"].includes(r.status)).length;
              const s = CYCLE[c.status as keyof typeof CYCLE];
              return (
                <Tr key={c.id}>
                  <Td>
                    <Link href={`/app/reviews/${c.id}`} className="text-foreground underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                  </Td>
                  <Td className="tabular">
                    {formatDate(c.period_start, active.date_format)} to {formatDate(c.period_end, active.date_format)}
                  </Td>
                  <Td className="tabular">{rv.length ? `${done} of ${rv.length}` : "—"}</Td>
                  <Td>
                    <StatusDot tone={s.tone}>{s.label}</StatusDot>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <EmptyState title="No review rounds yet" description="Start with one round a year. You choose who is in it and when each part is due." />
      )}
    </div>
  );
}
