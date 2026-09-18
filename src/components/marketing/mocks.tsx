/**
 * Product previews drawn in HTML/CSS (not screenshots), so they stay
 * sharp, follow light/dark mode and never go out of date with the brand.
 * The names and numbers are made up.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ModuleKey } from "@/modules/types";

function Frame({ children, className, label }: { children: ReactNode; className?: string; label: string }) {
  return (
    <div role="img" aria-label={label} className={cn("overflow-hidden rounded-xl border border-border-strong bg-surface text-left", className)}>
      {children}
    </div>
  );
}

function Row({ left, right, sub, dot }: { left: string; right?: ReactNode; sub?: string; dot?: "success" | "warning" | "danger" | "info" }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
      <div className="min-w-0">
        <p className="truncate text-[13px] text-foreground">{left}</p>
        {sub && <p className="truncate text-[11px] text-subtle-foreground">{sub}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
        {dot && (
          <span
            className={cn("size-1.5 rounded-full", { success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info" }[dot])}
          />
        )}
        {right}
      </div>
    </div>
  );
}

function Head({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
      <p className="font-display text-sm">{title}</p>
      {meta && <p className="text-[11px] text-subtle-foreground">{meta}</p>}
    </div>
  );
}

/** Staff app: the clock-in screen. */
export function ClockInMock({ className }: { className?: string }) {
  return (
    <Frame label="Staff app showing a large clock-in button" className={cn("w-[15.5rem] rounded-[1.75rem] p-3", className)}>
      <div className="rounded-[1.25rem] border border-border bg-background px-4 pt-4 pb-3">
        <p className="text-[11px] text-subtle-foreground">Tuesday · Morning shift 08:00</p>
        <p className="font-display mt-1 text-lg">Good morning, Aisha</p>
        <div className="mx-auto mt-6 flex size-32 flex-col items-center justify-center rounded-full bg-foreground text-background">
          <span className="font-display text-xl">Clock in</span>
          <span className="text-[11px] opacity-70">07:56</span>
        </div>
        <p className="mt-4 text-center text-[11px] text-subtle-foreground">Inside Malé office · location on</p>
        <div className="mt-5 grid grid-cols-5 border-t border-border pt-2 text-center text-[10px] text-subtle-foreground">
          {["Home", "Time", "Requests", "Pay", "Me"].map((t) => (
            <span key={t} className={t === "Time" ? "text-foreground" : undefined}>
              {t}
            </span>
          ))}
        </div>
      </div>
    </Frame>
  );
}

/** Manager view: Requests waiting for a decision. */
export function RequestsMock({ className }: { className?: string }) {
  return (
    <Frame label="Manager's Requests list with time off and claims waiting" className={cn("w-[20rem]", className)}>
      <Head title="Requests" meta="4 waiting" />
      <Row left="Ibrahim Rasheed" sub="Time off · 12 to 14 Nov" right={<Btns />} />
      <Row left="Mariyam Shifa" sub="Claim · Ferry, MVR 60" right={<Btns />} />
      <Row left="Rahul Nair" sub="Time fix · clock-out 22:10" right={<Btns />} />
      <Row left="Hassan Ali" sub="Letter · Salary certificate" right={<Btns />} />
    </Frame>
  );
}

function Btns() {
  return (
    <span className="flex gap-1.5">
      <span className="rounded-md border border-border-strong px-2 py-0.5 text-[11px] text-muted-foreground">No</span>
      <span className="rounded-md bg-foreground px-2 py-0.5 text-[11px] text-background">Yes</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-[11px] text-subtle-foreground">{label}</p>
      <p className="font-display mt-1 text-2xl tabular">{value}</p>
    </div>
  );
}

export function OwnerMock() {
  return (
    <Frame label="Owner's Home screen with headcount, payroll cost and items needing attention">
      <Head title="Home" meta="This month" />
      <div className="grid grid-cols-3 divide-x divide-border">
        <Stat label="People" value="42" />
        <Stat label="Payroll cost" value="MVR 612k" />
        <Stat label="Waiting" value="3" />
      </div>
      <Row left="Work permit renewal" sub="Rahul Nair · 21 days left" dot="warning" right="Renew" />
      <Row left="Pay day" sub="28 Nov · run not started" dot="info" right="5 days" />
    </Frame>
  );
}

export function HrMock() {
  return (
    <Frame label="People directory list">
      <Head title="People" meta="42 people" />
      <Row left="Aishath Rasheed" sub="Front office · Receptionist" right="Active" dot="success" />
      <Row left="Rahul Nair" sub="Kitchen · Cook" right="Probation" dot="warning" />
      <Row left="Mariyam Shifa" sub="Housekeeping · Room attendant" right="Active" dot="success" />
      <Row left="Hassan Ali" sub="Engineering · Technician" right="On leave" dot="info" />
    </Frame>
  );
}

export function ManagerMock() {
  return (
    <Frame label="Manager's view of the team today">
      <Head title="Today · Kitchen" meta="6 on the roster" />
      <Row left="Rahul Nair" sub="Morning 07:00" right="In 06:52" dot="success" />
      <Row left="Ahmed Zaki" sub="Morning 07:00" right="Late 07:14" dot="warning" />
      <Row left="Shifana Moosa" sub="Evening 15:00" right="Later" />
      <Row left="Ali Waheed" sub="Time off" right="Off" dot="info" />
    </Frame>
  );
}

export function StaffMock() {
  return (
    <Frame label="Staff member's time off balance and payslip">
      <Head title="Me" />
      <div className="grid grid-cols-2 divide-x divide-border">
        <Stat label="Annual leave left" value="18.5" />
        <Stat label="Sick days used" value="2" />
      </div>
      <Row left="October payslip" sub="Paid 28 Oct" right="Open" />
      <Row left="Ferry claim · MVR 60" sub="Sent 2 Nov" right="Approved" dot="success" />
    </Frame>
  );
}

const TOOL_MOCKS: Partial<Record<ModuleKey, () => ReactNode>> = {
  employees: () => <HrMock />,
  approvals: () => <RequestsMock className="w-full" />,
  documents: () => (
    <Frame label="Letter being prepared">
      <Head title="Salary certificate" meta="Preview" />
      <div className="space-y-2 px-4 py-4 text-[12px] text-muted-foreground">
        <p>To whom it may concern,</p>
        <p>
          This is to confirm that <span className="text-foreground">Aishath Rasheed</span> works with us as{" "}
          <span className="text-foreground">Receptionist</span> since <span className="text-foreground">01/03/2024</span>, on a monthly salary of{" "}
          <span className="text-foreground">MVR 12,000</span>.
        </p>
      </div>
      <Row left="Download PDF" right="Save to her files" />
    </Frame>
  ),
  roles: () => (
    <Frame label="Permission grid for a role">
      <Head title="Manager role" />
      {[
        ["People", "Their team"],
        ["Time off", "Approve · their team"],
        ["Salaries", "Only their own"],
        ["Payroll", "No access"],
      ].map(([a, b]) => (
        <Row key={a} left={a} right={b} />
      ))}
    </Frame>
  ),
  portal: () => <ClockInMock className="mx-auto" />,
  recruitment: () => (
    <Frame label="Candidate board">
      <Head title="Chef de partie" meta="14 candidates" />
      <div className="grid grid-cols-3 gap-2 p-3 text-[11px]">
        {[
          ["New", ["Ravi K.", "Sara M."]],
          ["Interview", ["Ahmed S."]],
          ["Offer", ["Nimal P."]],
        ].map(([col, names]) => (
          <div key={col as string} className="space-y-1.5 rounded-lg border border-border p-2">
            <p className="text-subtle-foreground">{col as string}</p>
            {(names as string[]).map((n) => (
              <p key={n} className="rounded-md bg-accent-soft px-2 py-1 text-foreground">
                {n}
              </p>
            ))}
          </div>
        ))}
      </div>
    </Frame>
  ),
  onboarding: () => (
    <Frame label="Joiner checklist">
      <Head title="Rahul Nair joins Monday" meta="3 of 6 done" />
      <Row left="Contract signed" right="HR" dot="success" />
      <Row left="Uniform ready" right="Manager" dot="success" />
      <Row left="Bank details" right="Rahul" dot="warning" />
    </Frame>
  ),
  attendance: () => <ManagerMock />,
  leave: () => (
    <Frame label="Team time off calendar">
      <Head title="November · Kitchen" />
      <div className="grid grid-cols-7 gap-1 p-3 text-center text-[10px] text-subtle-foreground">
        {Array.from({ length: 21 }, (_, i) => (
          <span
            key={i}
            className={cn(
              "rounded py-1.5",
              [4, 5, 6].includes(i) ? "bg-foreground text-background" : [5, 6].includes(i - 7) ? "bg-warning-soft text-warning" : "bg-accent-soft",
            )}
          >
            {i + 1}
          </span>
        ))}
      </div>
      <Row left="Two people off on 13 Nov" dot="warning" right="Check" />
    </Frame>
  ),
  compliance: () => (
    <Frame label="Permits expiring soon">
      <Head title="Expiring" meta="Next 90 days" />
      <Row left="Rahul Nair · Work permit" sub="21 days" dot="danger" right="Renew" />
      <Row left="Nimal Perera · Passport" sub="54 days" dot="warning" right="Remind" />
      <Row left="Ravi Kumar · Medical" sub="80 days" dot="info" right="Later" />
    </Frame>
  ),
  payroll: () => (
    <Frame label="Payroll run review">
      <Head title="November payroll" meta="Checking" />
      <div className="grid grid-cols-3 divide-x divide-border">
        <Stat label="Gross" value="548k" />
        <Stat label="Net" value="501k" />
        <Stat label="People" value="42" />
      </div>
      <Row left="Missing bank account" sub="Ali Waheed" dot="warning" right="Fix" />
      <Row left="Lock and send payslips" right="Ready" />
    </Frame>
  ),
  claims: () => (
    <Frame label="Claims by type">
      <Head title="Claims" meta="Cut-off 20th" />
      <Row left="Transport · Ferry Malé to Hulhumalé" sub="Mariyam Shifa" right="MVR 60" dot="success" />
      <Row left="Meals · Late shift dinner" sub="Rahul Nair" right="MVR 85" dot="info" />
      <Row left="Supplies · Cleaning stock" sub="Hassan Ali" right="MVR 420" dot="warning" />
    </Frame>
  ),
  learning: () => (
    <Frame label="Course progress">
      <Head title="Food safety basics" meta="Required" />
      <Row left="Kitchen team" right="9 of 11 done" dot="success" />
      <Row left="Service team" right="4 of 8 done" dot="warning" />
    </Frame>
  ),
  performance: () => (
    <Frame label="Review round progress">
      <Head title="2026 review" meta="Open" />
      <Row left="Self reviews" right="31 of 42" dot="info" />
      <Row left="Manager reviews" right="12 of 42" dot="warning" />
      <Row left="Pulse survey" sub="Anonymous" right="68% replied" />
    </Frame>
  ),
};

export function ToolMock({ tool }: { tool: ModuleKey }) {
  return <>{TOOL_MOCKS[tool]?.() ?? null}</>;
}
