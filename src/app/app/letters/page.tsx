import type { Metadata } from "next";
import Link from "next/link";
import { TabNav } from "@/components/ui/tab-nav";
import { Alert } from "@/components/ui/alert";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { getActiveBusiness, toAccessContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { can } from "@/modules/access";
import { LetterMaker, OpenLetterButton, RequestActions, TemplatesPanel } from "./letters-client";

export const metadata: Metadata = { title: "Letters & files" };

const REQ_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" | "info" }> = {
  pending: { label: "Waiting for approval", tone: "warning" },
  approved: { label: "Approved, ready to issue", tone: "info" },
  issued: { label: "Issued", tone: "success" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default async function LettersPage(props: PageProps<"/app/letters">) {
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const active = (await getActiveBusiness())!;
  const ctx = toAccessContext(active);
  if (!can(ctx, "letters", "view", "team")) {
    return (
      <Alert tone="warning" title="No access">
        Ask the owner or an admin if you need to make letters. To ask for a letter for yourself, use the staff app.
      </Alert>
    );
  }
  const supabase = await createClient();
  const canCreate = can(ctx, "letters", "create", "team");
  const canEditTemplates = can(ctx, "letters", "edit");
  const [{ count: openRequests }, { data: business }] = await Promise.all([
    supabase.from("letter_requests").select("id", { count: "exact", head: true }).eq("business_id", active.business_id).in("status", ["pending", "approved"]),
    supabase.from("businesses").select("logo_path, signature_path, stamp_path, signatory_name").eq("id", active.business_id).single(),
  ]);
  const tabs = [
    ...(canCreate ? [{ key: "make", label: "Make a letter" }] : []),
    { key: "requests", label: `Requests${openRequests ? ` (${openRequests})` : ""}` },
    { key: "sent", label: "Sent letters" },
    { key: "templates", label: "Templates" },
  ];
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0].key;
  const df = active.date_format;

  let body: React.ReactNode;
  if (tab === "make" || tab === "templates") {
    const [{ data: templates }, { data: people }] = await Promise.all([
      supabase.from("letter_templates").select("*").eq("business_id", active.business_id).order("name"),
      tab === "make"
        ? supabase.from("employees").select("id, first_name, last_name, employee_code").eq("business_id", active.business_id).order("first_name").limit(3000)
        : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string; employee_code: string }[] }),
    ]);
    if (tab === "make") {
      let prefill: { requestId: string; employeeId: string; templateId: string | null; purpose: string | null; addressedTo: string | null } | undefined;
      if (sp.request) {
        const { data: r } = await supabase.from("letter_requests").select("id, employee_id, template_id, purpose, addressed_to").eq("id", sp.request).maybeSingle();
        if (r) prefill = { requestId: r.id, employeeId: r.employee_id, templateId: r.template_id, purpose: r.purpose, addressedTo: r.addressed_to };
      }
      body = (
        <LetterMaker
          templates={(templates ?? []).filter((t) => t.is_active).map((t) => ({ value: t.id, label: t.name }))}
          people={(people ?? []).map((p) => ({ value: p.id, label: `${p.first_name} ${p.last_name}`.trim() + ` · ${p.employee_code}` }))}
          prefill={prefill ?? (sp.person ? { requestId: "", employeeId: sp.person, templateId: null, purpose: null, addressedTo: null } : undefined)}
          brandingMissing={!business?.logo_path || !business?.signatory_name}
        />
      );
    } else {
      body = <TemplatesPanel canEdit={canEditTemplates} templates={templates ?? []} />;
    }
  } else if (tab === "requests") {
    const { data } = await supabase
      .from("letter_requests")
      .select("id, status, purpose, addressed_to, created_at, decision_comment, generated_letter_id, employee:employees(id, first_name, last_name), template:letter_templates(name)")
      .eq("business_id", active.business_id)
      .order("created_at", { ascending: false })
      .limit(100);
    const rows = data ?? [];
    body =
      rows.length === 0 ? (
        <EmptyState title="No letter requests" description="When staff ask for a letter from the staff app, it appears here. Once it's approved you can issue it in one click." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Letter</Th>
              <Th className="hidden md:table-cell">Asked on</Th>
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = r.employee as unknown as { id: string; first_name: string; last_name: string } | null;
              const s = REQ_STATUS[r.status] ?? REQ_STATUS.pending;
              return (
                <Tr key={r.id}>
                  <Td>
                    <span className="block text-foreground">
                      {(r.template as unknown as { name: string } | null)?.name ?? "Letter"} for {e ? `${e.first_name} ${e.last_name}`.trim() : "someone"}
                    </span>
                    <span className="block text-[13px] text-subtle-foreground">
                      {[r.purpose, r.addressed_to].filter(Boolean).join(" · ")}
                      {r.decision_comment && ` · Note: ${r.decision_comment}`}
                    </span>
                  </Td>
                  <Td className="hidden text-muted-foreground tabular md:table-cell">{formatDate(r.created_at, df, active.timezone)}</Td>
                  <Td>
                    <StatusDot tone={s.tone}>{s.label}</StatusDot>
                  </Td>
                  <Td className="text-right whitespace-nowrap">
                    {r.status === "issued" && r.generated_letter_id ? (
                      <OpenLetterButton id={r.generated_letter_id} />
                    ) : canCreate && (r.status === "approved" || r.status === "pending") ? (
                      <RequestActions id={r.id} ready={r.status === "approved"} />
                    ) : null}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      );
  } else {
    const { data } = await supabase
      .from("generated_letters")
      .select("id, title, created_at, employee:employees(id, first_name, last_name)")
      .eq("business_id", active.business_id)
      .order("created_at", { ascending: false })
      .limit(100);
    const rows = data ?? [];
    body =
      rows.length === 0 ? (
        <EmptyState title="No letters yet" description="Letters you make are kept here and in each person's files." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Letter</Th>
              <Th>Person</Th>
              <Th className="hidden sm:table-cell">Made on</Th>
              <Th>
                <span className="sr-only">Open</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const e = r.employee as unknown as { id: string; first_name: string; last_name: string } | null;
              return (
                <Tr key={r.id}>
                  <Td className="text-foreground">{r.title}</Td>
                  <Td>
                    {e && (
                      <Link href={`/app/people/${e.id}?tab=files`} className="hover:underline">
                        {`${e.first_name} ${e.last_name}`.trim()}
                      </Link>
                    )}
                  </Td>
                  <Td className="hidden text-muted-foreground tabular sm:table-cell">{formatDate(r.created_at, df, active.timezone)}</Td>
                  <Td className="text-right">
                    <OpenLetterButton id={r.id} />
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      );
  }

  return (
    <div>
      <PageHeader label="foundation" title="Letters & files" description="Make certificates and letters on your letterhead, and handle letters staff ask for." />
      <TabNav label="Sections" current={tab} tabs={tabs.map((t) => ({ key: t.key, label: t.label, href: `/app/letters?tab=${t.key}` }))} />
      {body}
    </div>
  );
}
