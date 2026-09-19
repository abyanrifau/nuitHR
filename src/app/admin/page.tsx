import type { Metadata } from "next";
import Link from "next/link";
import { StatusDot } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/format";
import { listBusinesses, PLAN_LABEL, PLAN_TONE, type AdminBusiness } from "@/lib/platform/data";
import { adminTitle, requirePlatformAdmin } from "@/lib/platform/guard";

export async function generateMetadata() {
  return adminTitle("Overview");
}

const DAY = 86_400_000;
/** The current time, read once per request (kept out of the components so they stay pure). */
const clock = () => Date.now();

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-[12px] text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl tabular text-foreground">{value}</p>
      {note && <p className="mt-0.5 text-[12px] text-subtle-foreground">{note}</p>}
    </div>
  );
}

/** Signups per week for the last 90 days: one series, so no legend; each bar has a hover label and there's a table for screen readers. */
function SignupChart({ businesses }: { businesses: AdminBusiness[] }) {
  const now = clock();
  const weeks = Array.from({ length: 13 }, (_, i) => {
    const end = now - (12 - i) * 7 * DAY;
    const start = end - 7 * DAY;
    return { start, end, n: businesses.filter((b) => { const t = new Date(b.created_at).getTime(); return t > start && t <= end; }).length };
  });
  const max = Math.max(1, ...weeks.map((w) => w.n));
  const total = weeks.reduce((s, w) => s + w.n, 0);
  const W = 640, H = 160, pad = 24, gap = 2;
  const bw = (W - pad) / weeks.length - gap;
  const label = (w: (typeof weeks)[number]) => `${formatDate(new Date(w.start + DAY).toISOString(), "DD/MM/YYYY")} to ${formatDate(new Date(w.end).toISOString(), "DD/MM/YYYY")}`;
  return (
    <section className="rounded-xl border border-border p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-base">New signups, last 90 days</h2>
        <p className="text-[12px] text-muted-foreground">
          <span className="tabular text-foreground">{total}</span> in total, by week
        </p>
      </div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} className="h-auto w-full" role="img" aria-label={`New signups per week, last 90 days: ${total} in total`}>
        <line x1={pad} x2={W} y1={H} y2={H} stroke="var(--color-border)" strokeWidth="1" />
        <text x={pad - 6} y={12} textAnchor="end" fontSize="10" fill="var(--color-subtle-foreground)">
          {max}
        </text>
        <text x={pad - 6} y={H} textAnchor="end" fontSize="10" fill="var(--color-subtle-foreground)">
          0
        </text>
        {weeks.map((w, i) => {
          const h = w.n ? Math.max(3, ((H - 8) * w.n) / max) : 0;
          const x = pad + i * (bw + gap) + gap;
          return (
            <g key={i}>
              {/* Bigger invisible hover target than the bar itself. */}
              <rect x={x} y={0} width={bw} height={H} fill="transparent">
                <title>{`${label(w)}: ${w.n} ${w.n === 1 ? "signup" : "signups"}`}</title>
              </rect>
              {h > 0 && <path d={`M${x},${H} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`} fill="var(--color-foreground)" pointerEvents="none" />}
              {w.n > 0 && w.n === max && (
                <text x={x + bw / 2} y={H - h - 4} textAnchor="middle" fontSize="10" fill="var(--color-muted-foreground)">
                  {w.n}
                </text>
              )}
            </g>
          );
        })}
        <text x={pad + gap} y={H + 14} fontSize="10" fill="var(--color-subtle-foreground)">
          {formatDate(new Date(weeks[0].start + DAY).toISOString(), "DD/MM/YYYY")}
        </text>
        <text x={W} y={H + 14} textAnchor="end" fontSize="10" fill="var(--color-subtle-foreground)">
          This week
        </text>
      </svg>
      <table className="sr-only">
        <caption>New signups per week</caption>
        <thead>
          <tr>
            <th>Week</th>
            <th>Signups</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={i}>
              <td>{label(w)}</td>
              <td>{w.n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function AdminOverview() {
  await requirePlatformAdmin();
  const all = await listBusinesses();
  const now = clock();
  const soon = (b: AdminBusiness) => b.ends_at && new Date(b.ends_at).getTime() > now && new Date(b.ends_at).getTime() <= now + 7 * DAY;
  const count = (s: string) => all.filter((b) => b.status === s).length;
  const revenue = all.filter((b) => b.status === "active" || b.status === "grace").reduce((s, b) => s + b.monthly_price, 0);

  const attention: { b: AdminBusiness; why: string }[] = [
    ...all.filter((b) => b.status === "trial" && soon(b)).map((b) => ({ b, why: `Trial ends ${formatDate(b.ends_at, "DD/MM/YYYY")}` })),
    ...all.filter((b) => b.status === "active" && soon(b)).map((b) => ({ b, why: `Paid until ${formatDate(b.ends_at, "DD/MM/YYYY")}` })),
    ...all.filter((b) => b.status === "grace").map((b) => ({ b, why: `Payment overdue since ${formatDate(b.ends_at, "DD/MM/YYYY")}` })),
    ...all
      .filter((b) => !b.onboarding_completed_at && new Date(b.created_at).getTime() < now - DAY)
      .map((b) => ({ b, why: `Signed up ${formatDate(b.created_at, "DD/MM/YYYY")}, never finished setup` })),
  ];

  return (
    <div className="space-y-8">
      <div>
        <p className="section-label mb-1">platform admin</p>
        <h1 className="text-2xl">Overview</h1>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Companies" value={String(all.length)} />
        <Stat label="Active, paying" value={String(count("active"))} />
        <Stat label="On trial" value={String(count("trial"))} />
        <Stat label="Ending in 7 days" value={String(all.filter(soon).length)} note="Trials and paid periods" />
        <Stat label="Suspended" value={String(count("suspended"))} note={`${count("grace")} in grace period, ${count("cancelled")} cancelled`} />
        <Stat label="Staff across all companies" value={all.reduce((s, b) => s + b.staff_count, 0).toLocaleString("en-US")} />
        <Stat label="Monthly revenue (estimate)" value={formatMoney(revenue, "MVR")} note="Active and grace-period companies" />
        <Stat label="Signed up this month" value={String(all.filter((b) => b.created_at.slice(0, 7) === new Date().toISOString().slice(0, 7)).length)} />
      </div>
      <SignupChart businesses={all} />
      <section>
        <h2 className="mb-3 text-lg">Needs attention</h2>
        {attention.length ? (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {attention.map(({ b, why }, i) => (
              <li key={`${b.id}-${i}`}>
                <Link href={`/admin/businesses/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-accent-soft">
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground">{b.name}</span>
                    <span className="block text-[12px] text-subtle-foreground">
                      {why}
                      {b.owner?.email && ` · ${b.owner.email}`}
                    </span>
                  </span>
                  <StatusDot tone={PLAN_TONE[b.status]}>{PLAN_LABEL[b.status]}</StatusDot>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">Nothing needs attention.</p>
        )}
      </section>
    </div>
  );
}
