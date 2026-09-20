import Link from "next/link";
import { Download } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { StatusDot, Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { listBusinesses, PLAN_LABEL, PLAN_TONE, type PlanState } from "@/lib/platform/data";
import { filterBusinesses, type BusinessFilter } from "@/lib/platform/filter";
import { adminTitle, requirePlatformAdmin } from "@/lib/platform/guard";
import { MODULE_MAP } from "@/modules/registry";
import { cn } from "@/lib/utils";

export async function generateMetadata() {
  return adminTitle("Companies");
}

export default async function AdminBusinesses(props: PageProps<"/admin/businesses">) {
  await requirePlatformAdmin();
  const sp = (await props.searchParams) as Record<string, string | undefined>;
  const f: BusinessFilter = { q: sp.q, status: sp.status, industry: sp.industry, tool: sp.tool, expiring: sp.expiring, sort: sp.sort, dir: sp.dir };
  const all = await listBusinesses();
  const rows = filterBusinesses(all, f);
  const industries = [...new Set(all.map((b) => b.industry))].sort();
  const tools = Object.values(MODULE_MAP).filter((m) => !m.core && !m.builtIn);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...f, ...patch }).filter(([, v]) => v) as [string, string][]);
    return p.toString() ? `?${p}` : "";
  };
  const sortLink = (key: string) => qs({ sort: key, dir: f.sort === key && f.dir !== "asc" ? "asc" : "desc" });
  const select = "h-9 rounded-lg border border-border-strong bg-surface px-2 text-sm";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="section-label mb-1">platform admin</p>
          <h1 className="text-2xl">Companies</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} of {all.length}
          </p>
        </div>
        <a href={`/admin/businesses/export${qs({})}`} className={buttonClasses({ variant: "secondary" })}>
          <Download className="size-4" aria-hidden /> Export CSV
        </a>
      </div>

      {/* Filters: one row, applied by the server. */}
      <form className="flex flex-wrap items-center gap-2" action="/admin/businesses">
        <input
          name="q"
          defaultValue={f.q}
          placeholder="Search name, owner, email, phone"
          aria-label="Search"
          className="h-9 min-w-56 flex-1 rounded-lg border border-border-strong bg-surface px-3 text-sm"
        />
        <select name="status" defaultValue={f.status ?? ""} aria-label="Status" className={select}>
          <option value="">Any status</option>
          {(Object.keys(PLAN_LABEL) as PlanState[]).map((s) => (
            <option key={s} value={s}>
              {PLAN_LABEL[s]}
            </option>
          ))}
        </select>
        <select name="industry" defaultValue={f.industry ?? ""} aria-label="Industry" className={select}>
          <option value="">Any industry</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <select name="tool" defaultValue={f.tool ?? ""} aria-label="Tool" className={select}>
          <option value="">Any tools</option>
          {tools.map((t) => (
            <option key={t.key} value={t.key}>
              Uses {t.name}
            </option>
          ))}
        </select>
        <select name="expiring" defaultValue={f.expiring ?? ""} aria-label="Ending soon" className={select}>
          <option value="">Any end date</option>
          <option value="7">Ends within 7 days</option>
          <option value="30">Ends within 30 days</option>
        </select>
        {f.sort && <input type="hidden" name="sort" value={f.sort} />}
        {f.dir && <input type="hidden" name="dir" value={f.dir} />}
        <button type="submit" className={buttonClasses({ size: "sm" })}>
          Apply
        </button>
        {(f.q || f.status || f.industry || f.tool || f.expiring) && (
          <Link href="/admin/businesses" className="text-sm text-muted-foreground underline underline-offset-4">
            Clear
          </Link>
        )}
      </form>

      <Table>
        <thead>
          <tr>
            {[
              ["name", "Company"],
              ["", "Owner"],
              ["staff", "Staff"],
              ["", "Tools"],
              ["status", "Status"],
              ["ends", "Trial / paid until"],
              ["price", "Monthly"],
              ["created_at", "Signed up"],
              ["active", "Last active"],
            ].map(([key, label]) => (
              <Th key={label} className={cn(key === "price" && "text-right")}>
                {key ? (
                  <Link href={`/admin/businesses${sortLink(key)}`} className={cn("hover:text-foreground", (f.sort ?? "created_at") === key && "text-foreground")}>
                    {label}
                    {(f.sort ?? "created_at") === key ? (f.dir === "asc" ? " ↑" : " ↓") : ""}
                  </Link>
                ) : (
                  label
                )}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => {
            const addOns = b.modules.filter((m) => MODULE_MAP[m as keyof typeof MODULE_MAP] && !MODULE_MAP[m as keyof typeof MODULE_MAP].core);
            return (
              <Tr key={b.id}>
                <Td>
                  <Link href={`/admin/businesses/${b.id}`} className="text-foreground underline-offset-4 hover:underline">
                    {b.name}
                  </Link>
                  <span className="block text-[12px] text-subtle-foreground">{b.industry.replace(/_/g, " ")}</span>
                </Td>
                <Td>
                  {b.owner?.name || "—"}
                  <span className="block text-[12px] text-subtle-foreground">{[b.owner?.email, b.owner?.phone].filter(Boolean).join(" · ")}</span>
                </Td>
                <Td className="tabular">{b.staff_count}</Td>
                <Td className="text-[12px] text-muted-foreground" title={addOns.map((m) => MODULE_MAP[m as keyof typeof MODULE_MAP].name).join(", ")}>
                  {addOns.length ? `${addOns.length} add-on${addOns.length === 1 ? "" : "s"}` : "Foundation only"}
                </Td>
                <Td>
                  <StatusDot tone={PLAN_TONE[b.status]}>{PLAN_LABEL[b.status]}</StatusDot>
                </Td>
                <Td className="tabular">{formatDate(b.ends_at, "DD/MM/YYYY")}</Td>
                <Td className="text-right tabular">
                  {formatMoney(b.monthly_price, "MVR")}
                  {(b.custom_monthly_price != null || b.discount_percent != null) && <span className="block text-[11px] text-subtle-foreground">custom</span>}
                </Td>
                <Td className="tabular">{formatDate(b.created_at, "DD/MM/YYYY")}</Td>
                <Td className="tabular">{b.last_active ? formatDate(b.last_active, "DD/MM/YYYY") : "—"}</Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {!rows.length && <p className="text-center text-sm text-muted-foreground">No companies match.</p>}
    </div>
  );
}
