import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/access";
import { CareersSettings } from "./hiring-client";

export const metadata: Metadata = { title: "Hiring" };

const STATUS: Record<string, { label: string; tone: "success" | "warning" | "neutral" | "info" }> = {
  draft: { label: "Draft", tone: "neutral" },
  open: { label: "Open", tone: "success" },
  closed: { label: "Closed", tone: "neutral" },
  filled: { label: "Filled", tone: "info" },
};

export default async function HiringPage(props: PageProps<"/app/hiring">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "recruitment", "view")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to see hiring.
      </Alert>
    );
  }
  const supabase = await createClient();
  let q = supabase
    .from("vacancies")
    .select("id, title, status, is_public, deadline, openings, created_at, department:departments(name), branch:branches(name), applications(stage)")
    .eq("business_id", active.business_id)
    .order("created_at", { ascending: false });
  if (sp.show !== "all") q = q.in("status", ["draft", "open"]);
  const [{ data: roles }, { data: b }] = await Promise.all([q, supabase.from("businesses").select("slug, careers_page_enabled, careers_intro").eq("id", active.business_id).single()]);

  return (
    <div>
      <PageHeader
        label="hire"
        title="Hiring"
        description="Post roles, collect applications in one place, and move people through to an offer."
        actions={
          can(ctx, "recruitment", "create") ? (
            <Link href="/app/hiring/new" className={buttonClasses()}>
              <Plus className="size-4" aria-hidden /> New role
            </Link>
          ) : undefined
        }
      />

      <CareersSettings
        slug={b?.slug ?? ""}
        enabled={Boolean(b?.careers_page_enabled)}
        intro={b?.careers_intro ?? ""}
        canEdit={can(ctx, "settings", "edit")}
      />

      <div className="mb-4 flex items-center gap-2 text-[13px]">
        <Link href="/app/hiring" className={`rounded-full border px-3 py-1 ${sp.show !== "all" ? "border-foreground" : "border-border text-muted-foreground"}`}>
          Open and drafts
        </Link>
        <Link href="/app/hiring?show=all" className={`rounded-full border px-3 py-1 ${sp.show === "all" ? "border-foreground" : "border-border text-muted-foreground"}`}>
          All roles
        </Link>
      </div>

      {roles?.length ? (
        <Table>
          <thead>
            <tr>
              <Th>Role</Th>
              <Th className="text-right">New</Th>
              <Th className="hidden text-right sm:table-cell">In progress</Th>
              <Th className="hidden md:table-cell">Apply by</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const apps = (r.applications ?? []) as { stage: string }[];
              const s = STATUS[r.status];
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/app/hiring/${r.id}`} className="block text-foreground hover:underline">
                      {r.title}
                    </Link>
                    <span className="block text-[12px] text-subtle-foreground">
                      {[(r.department as unknown as { name: string } | null)?.name, (r.branch as unknown as { name: string } | null)?.name].filter(Boolean).join(" · ")}
                      {r.is_public && r.status === "open" && " · on careers page"}
                    </span>
                  </Td>
                  <Td className="text-right tabular">{apps.filter((a) => a.stage === "applied").length}</Td>
                  <Td className="hidden text-right text-muted-foreground tabular sm:table-cell">{apps.filter((a) => ["screening", "interview", "offer"].includes(a.stage)).length}</Td>
                  <Td className="hidden text-muted-foreground tabular md:table-cell">{formatDate(r.deadline, active.date_format)}</Td>
                  <Td>
                    <StatusDot tone={s.tone}>{s.label}</StatusDot>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      ) : (
        <EmptyState
          title={sp.show === "all" ? "No roles yet" : "No open roles"}
          description={sp.show === "all" ? "Add a role to start collecting applications." : "Filled and closed roles are under All roles."}
          action={
            can(ctx, "recruitment", "create") ? (
              <Link href="/app/hiring/new" className={buttonClasses()}>
                New role
              </Link>
            ) : undefined
          }
        />
      )}
      {b?.careers_page_enabled && (
        <p className="mt-4 text-[13px] text-subtle-foreground">
          Your careers page:{" "}
          <a href={`/careers/${b.slug}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 underline underline-offset-4">
            /careers/{b.slug} <ExternalLink className="size-3" aria-hidden />
          </a>
        </p>
      )}
    </div>
  );
}
