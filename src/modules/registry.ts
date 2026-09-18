/**
 * TOOL REGISTRY: the single source of truth for every tool.
 *
 * Setup, Workspace → Tools, the sidebar, "Jump to", Home widgets, the
 * staff app, notifications, permissions and pricing all read from this
 * list. Internal keys (e.g. "attendance") never change; `name` is what
 * people see.
 *
 * To add a new tool: add its key to ModuleKey in ./types.ts, add an
 * entry below, add its price in src/config/app.config.ts, and create its
 * tables in a new migration using private.std_rls(...). See README →
 * "Adding a new tool".
 */
import type { ModuleDefinition, ModuleKey, PermissionAction, PermissionScope, ToolStage } from "./types";

const ALL: ("view" | "create" | "edit" | "approve" | "delete" | "export")[] = ["view", "create", "edit", "approve", "delete", "export"];
const CRUD: ("view" | "create" | "edit" | "delete" | "export")[] = ["view", "create", "edit", "delete", "export"];

export const STAGES: { key: ToolStage; label: string; summary: string }[] = [
  { key: "foundation", label: "Foundation", summary: "Included in every plan." },
  { key: "hire", label: "Hire", summary: "Find people and give them a good first week." },
  { key: "run", label: "Run", summary: "Shifts, time off and the paperwork that expires." },
  { key: "pay", label: "Pay", summary: "Pay people correctly and pay them back." },
  { key: "grow", label: "Grow", summary: "Teach, review and listen." },
];

export const MODULES: ModuleDefinition[] = [
  // =================================================================
  // FOUNDATION
  // =================================================================
  {
    key: "employees",
    name: "People directory",
    category: "foundation",
    core: true,
    icon: "users",
    tagline: "Everyone who works for you, with their details, role and reporting line.",
    features: ["Profiles with a full change history", "Branches, departments and job titles", "An org chart that draws itself", "Export to Excel"],
    outcomes: [
      "Find anyone's contract, ID or emergency contact in seconds",
      "See who reports to whom on a live org chart",
      "Track probation, resignations and exits with reasons",
      "Keep salary details visible only to the people you choose",
      "See every change to a profile, who made it and when",
    ],
    requires: [],
    recommends: [],
    resources: [
      { key: "employees", label: "People", description: "Personal, contact and job details.", actions: ALL, employeeScoped: true },
      { key: "org", label: "Company structure", description: "Branches, departments and job titles.", actions: CRUD, employeeScoped: false },
      {
        key: "compensation",
        label: "Salary & bank details",
        description: "Salaries, allowances, loans and bank accounts.",
        actions: CRUD,
        employeeScoped: true,
        ownerGrantOnly: true,
      },
      { key: "users", label: "Logins", description: "Invite people and link logins to profiles.", actions: CRUD, employeeScoped: false },
    ],
    nav: [
      { label: "People", href: "/app/people", icon: "users", requires: { resource: "employees", action: "view" } },
      { label: "Org chart", href: "/app/people/org-chart", icon: "network", requires: { resource: "org", action: "view" } },
    ],
    portal: [
      { label: "Me", href: "/staff/me", icon: "user", tab: true },
      { label: "Directory", href: "/staff/directory", icon: "users" },
    ],
    widgets: [
      { key: "headcount", label: "Headcount", section: "month", requires: { resource: "employees", action: "view" } },
      { key: "probation_ending", label: "Probations ending", section: "attention", requires: { resource: "employees", action: "view" } },
    ],
    notifications: [
      { key: "employee.created", label: "Someone new was added", description: "When a person joins the directory.", defaultChannels: ["in_app"] },
      {
        key: "employee.probation_ending",
        label: "Probation ending",
        description: "Two weeks before a probation ends.",
        defaultChannels: ["in_app", "email"],
      },
    ],
    setup: { title: "Departments & job titles", description: "The teams and roles in your company." },
    checklist: [
      { key: "org.departments", label: "Add your departments", href: "/app/workspace/tools/employees" },
      { key: "employees.first", label: "Add your first person", href: "/app/people/new" },
    ],
    approvalTypes: [],
  },
  {
    key: "approvals",
    name: "Requests",
    category: "foundation",
    core: true,
    icon: "inbox",
    tagline: "Every time off, claim and letter request lands in one place to decide.",
    features: ["One list for everything waiting on you", "Chains by manager, role or amount", "Approve many at once", "Hand over while you're away"],
    outcomes: [
      "Clear the day's requests in one sitting",
      "Send large claims to a second approver automatically",
      "Leave a note when you say no, so nobody has to ask why",
      "Let a deputy decide while you're on leave",
    ],
    requires: [],
    recommends: [],
    resources: [
      {
        key: "approvals",
        label: "Requests",
        description: "See and decide requests; set approval chains.",
        actions: ["view", "approve", "edit"],
        employeeScoped: true,
      },
    ],
    nav: [{ label: "Requests", href: "/app/requests", icon: "inbox" }],
    portal: [{ label: "Requests", href: "/staff/requests", icon: "inbox", tab: true }],
    widgets: [{ key: "pending_requests", label: "Requests waiting for you", section: "attention" }],
    notifications: [
      {
        key: "approval.requested",
        label: "A request needs you",
        description: "When something is waiting for your decision.",
        defaultChannels: ["in_app", "email"],
      },
      {
        key: "approval.decided",
        label: "Your request was decided",
        description: "When your request is approved or declined.",
        defaultChannels: ["in_app", "email"],
      },
    ],
    checklist: [{ key: "approvals.chains", label: "Decide who approves what", href: "/app/workspace/requests" }],
    approvalTypes: [],
  },
  {
    key: "documents",
    name: "Letters & files",
    category: "foundation",
    core: true,
    icon: "file-text",
    tagline: "Keep each person's files in one folder and produce letters on your letterhead.",
    features: [
      "A folder for every person",
      "Letter templates that fill themselves in",
      "Your logo, signature and stamp",
      "Staff can ask for letters",
    ],
    outcomes: [
      "Produce a salary certificate in under a minute",
      "Stop retyping names, dates and salaries into letters",
      "Keep contracts and ID copies where the right people can find them",
      "Let staff request an NOC or experience letter from their phone",
    ],
    requires: [],
    recommends: [],
    resources: [
      { key: "documents", label: "Files", description: "Upload and view people's files.", actions: CRUD, employeeScoped: true },
      { key: "letters", label: "Letters", description: "Create letters and handle letter requests.", actions: ALL, employeeScoped: true },
    ],
    nav: [{ label: "Letters & files", href: "/app/letters", icon: "file-signature", requires: { resource: "letters", action: "view" } }],
    portal: [
      { label: "My files", href: "/staff/files", icon: "folder", requires: { resource: "documents", action: "view" } },
      { label: "Ask for a letter", href: "/staff/letters", icon: "file-signature", requires: { resource: "letters", action: "create" } },
    ],
    widgets: [{ key: "expiring_documents", label: "Files expiring soon", section: "attention", requires: { resource: "documents", action: "view" } }],
    notifications: [
      { key: "letter.requested", label: "A letter was requested", description: "When someone asks for a letter.", defaultChannels: ["in_app"] },
      { key: "letter.ready", label: "Your letter is ready", description: "When a requested letter is issued.", defaultChannels: ["in_app", "email"] },
    ],
    checklist: [{ key: "documents.branding", label: "Add your logo", href: "/app/workspace/company" }],
    approvalTypes: ["letter_request"],
  },
  {
    key: "roles",
    name: "Access & roles",
    category: "foundation",
    core: true,
    icon: "shield",
    tagline: "Decide who sees what. Managers see their team; staff see themselves.",
    features: ["Six ready-made roles", "A permission grid per tool", "Team-only access for managers", "Salary locked by default"],
    outcomes: [
      "Give a supervisor their team and nothing else",
      "Keep salaries between you and your payroll officer",
      "Make a custom role in a few clicks",
      "Add an outside accountant without handing over the keys",
    ],
    requires: [],
    recommends: [],
    resources: [
      {
        key: "roles",
        label: "Access & roles",
        description: "Create roles and change what they can do.",
        actions: CRUD,
        employeeScoped: false,
        ownerGrantOnly: true,
      },
    ],
    nav: [],
    portal: [],
    widgets: [],
    notifications: [],
    checklist: [{ key: "roles.invite", label: "Invite your managers", href: "/app/workspace/people" }],
    approvalTypes: [],
  },
  {
    key: "portal",
    name: "Staff app",
    category: "foundation",
    core: true,
    icon: "smartphone",
    tagline: "A phone app for your staff, added to the home screen from the browser.",
    features: ["No app store needed", "Large buttons for one hand", "Only shows what you use", "Company news on the first screen"],
    outcomes: [
      "Let staff check their own leave balance instead of asking HR",
      "Put news where people actually look: their phone",
      "Keep working on slow island mobile data",
      "Show each person only the tools your company uses",
    ],
    requires: [],
    recommends: [],
    resources: [{ key: "announcements", label: "News", description: "Post news to staff.", actions: CRUD, employeeScoped: false }],
    nav: [{ label: "News", href: "/app/news", icon: "megaphone", requires: { resource: "announcements", action: "create" } }],
    portal: [{ label: "Home", href: "/staff", icon: "home", tab: true }],
    widgets: [],
    notifications: [{ key: "announcement.published", label: "Company news", description: "When news is posted.", defaultChannels: ["in_app"] }],
    checklist: [{ key: "portal.announcement", label: "Post your first news item", href: "/app/news" }],
    approvalTypes: [],
  },
  // Built-in features: always there, never listed as tools.
  {
    key: "dashboard",
    name: "Home",
    category: "foundation",
    core: true,
    builtIn: true,
    icon: "layout-dashboard",
    tagline: "What needs you today.",
    features: ["Needs your attention", "Today", "This month"],
    outcomes: [],
    requires: [],
    recommends: [],
    resources: [],
    nav: [{ label: "Home", href: "/app", icon: "home" }],
    portal: [],
    widgets: [{ key: "setup_checklist", label: "Setup checklist", section: "attention", requires: { resource: "settings", action: "edit" } }],
    notifications: [],
    checklist: [],
    approvalTypes: [],
  },
  {
    key: "notifications",
    name: "Notifications",
    category: "foundation",
    core: true,
    builtIn: true,
    icon: "bell",
    tagline: "In-app and email alerts, chosen by each person.",
    features: ["In-app bell", "Email", "Personal preferences"],
    outcomes: [],
    requires: [],
    recommends: [],
    resources: [],
    nav: [],
    portal: [],
    widgets: [],
    notifications: [],
    checklist: [{ key: "notifications.test", label: "Send yourself a test email", href: "/app/workspace/notifications" }],
    approvalTypes: [],
  },
  {
    key: "system",
    name: "Workspace",
    category: "foundation",
    core: true,
    builtIn: true,
    icon: "settings",
    tagline: "Company settings, security and data export.",
    features: ["Export everything", "Activity log", "Two-step sign-in", "Support access you control"],
    outcomes: [],
    requires: [],
    recommends: [],
    resources: [
      {
        key: "settings",
        label: "Company settings",
        description: "Company details, branding and preferences.",
        actions: ["view", "edit"],
        employeeScoped: false,
      },
      { key: "modules", label: "Tools", description: "Switch tools on or off.", actions: ["view", "edit"], employeeScoped: false },
      { key: "audit", label: "Activity log", description: "Who did what, and when.", actions: ["view", "export"], employeeScoped: false },
      { key: "data_export", label: "Data export", description: "Download all company data.", actions: ["view", "create"], employeeScoped: false },
      {
        key: "support",
        label: "Support access",
        description: "Let our support team in for a limited time.",
        actions: ["view", "edit"],
        employeeScoped: false,
      },
    ],
    nav: [
      { label: "Tools", href: "/app/workspace/tools", icon: "sliders", requires: { resource: "modules", action: "view" } },
      { label: "People & access", href: "/app/workspace/people", icon: "shield", requires: { resource: "users", action: "view" } },
      { label: "Who approves what", href: "/app/workspace/requests", icon: "inbox", requires: { resource: "approvals", action: "edit" } },
      { label: "Company settings", href: "/app/workspace/company", icon: "settings", requires: { resource: "settings", action: "view" } },
      { label: "Notification settings", href: "/app/workspace/notifications", icon: "bell", requires: { resource: "settings", action: "view" } },
      { label: "Activity log", href: "/app/workspace/activity", icon: "history", requires: { resource: "audit", action: "view" } },
      { label: "Your data", href: "/app/workspace/data", icon: "download", requires: { resource: "data_export", action: "view" } },
      { label: "Reports", href: "/app/reports", icon: "bar-chart" },
      { label: "Help & support", href: "/app/workspace/support", icon: "life-buoy" },
    ],
    portal: [],
    widgets: [],
    notifications: [
      { key: "security.sign_in", label: "New sign-in", description: "When your account signs in somewhere new.", defaultChannels: ["email"] },
      { key: "export.ready", label: "Export ready", description: "When your data export can be downloaded.", defaultChannels: ["in_app", "email"] },
    ],
    checklist: [{ key: "system.profile", label: "Add your company address and phone", href: "/app/workspace/company" }],
    approvalTypes: [],
  },

  // =================================================================
  // HIRE
  // =================================================================
  {
    key: "recruitment",
    name: "Hiring",
    category: "hire",
    core: false,
    icon: "briefcase",
    tagline: "Post a role, move candidates along a board, and turn the right one into a new starter.",
    features: ["Your own careers page", "A board of candidates by stage", "Interview notes and ratings", "Hire straight into the directory"],
    outcomes: [
      "Collect CVs in one place instead of your inbox",
      "See at a glance who is waiting for an interview",
      "Compare notes from everyone who met a candidate",
      "Send an offer letter from a template",
      "Create the new starter's profile without retyping anything",
    ],
    requires: [],
    recommends: ["onboarding"],
    resources: [{ key: "recruitment", label: "Hiring", description: "Roles, candidates and offers.", actions: CRUD, employeeScoped: false }],
    nav: [{ label: "Hiring", href: "/app/hiring", icon: "briefcase", requires: { resource: "recruitment", action: "view" } }],
    portal: [],
    widgets: [{ key: "open_roles", label: "Open roles", section: "month", requires: { resource: "recruitment", action: "view" } }],
    notifications: [
      { key: "recruitment.application", label: "New candidate", description: "When someone applies.", defaultChannels: ["in_app", "email"] },
      { key: "recruitment.interview", label: "Interview coming up", description: "Before an interview.", defaultChannels: ["in_app", "email"] },
    ],
    checklist: [{ key: "recruitment.vacancy", label: "Post your first role", href: "/app/hiring/new" }],
    approvalTypes: [],
  },
  {
    key: "onboarding",
    name: "Joiners & leavers",
    category: "hire",
    core: false,
    icon: "clipboard-check",
    tagline: "Checklists for someone's first days and last days, shared between HR, the manager and the person.",
    features: ["Checklists per team or job", "Tasks for HR, managers and staff", "Starts when someone joins", "Exit steps when someone leaves"],
    outcomes: [
      "Have the uniform, contract and ID copy ready before day one",
      "Know which new starter is still missing paperwork",
      "Collect keys and devices before the last day",
      "Hold an exit interview every time, not just sometimes",
    ],
    requires: [],
    recommends: ["recruitment"],
    resources: [{ key: "onboarding", label: "Joiners & leavers", description: "Checklists and tasks.", actions: CRUD, employeeScoped: true }],
    nav: [
      { label: "Joiners & leavers", href: "/app/joiners-leavers", icon: "clipboard-check", requires: { resource: "onboarding", action: "view" } },
    ],
    portal: [{ label: "My tasks", href: "/staff/tasks", icon: "list-checks" }],
    widgets: [{ key: "joiners_in_progress", label: "Joiners in progress", section: "month", requires: { resource: "onboarding", action: "view" } }],
    notifications: [
      {
        key: "onboarding.task_assigned",
        label: "A task was given to you",
        description: "When a checklist task is yours.",
        defaultChannels: ["in_app", "email"],
      },
    ],
    checklist: [{ key: "onboarding.template", label: "Check the joiner checklist", href: "/app/joiners-leavers/checklists" }],
    approvalTypes: [],
  },

  // =================================================================
  // RUN
  // =================================================================
  {
    key: "attendance",
    name: "Time & shifts",
    category: "run",
    core: false,
    icon: "clock",
    tagline: "Staff clock in on their phone. You plan the week's shifts and see real hours.",
    features: [
      "Clock in with location or a selfie",
      "A weekly roster you drag into shape",
      "Late, half-day and overtime rules",
      "Hours go straight to payroll",
    ],
    outcomes: [
      "Know who's late before the shift starts",
      "Plan next week's roster in a few minutes",
      "Stop clock-ins from the wrong island with a location fence",
      "Fix a forgotten clock-out with a request, not a phone call",
      "Send approved overtime to payroll without a spreadsheet",
    ],
    requires: [],
    recommends: ["payroll"],
    resources: [
      { key: "attendance", label: "Time records", description: "Clock-ins, corrections and timesheets.", actions: ALL, employeeScoped: true },
      { key: "roster", label: "Shifts & roster", description: "Shift times and weekly rosters.", actions: CRUD, employeeScoped: true },
    ],
    nav: [
      { label: "Time", href: "/app/time", icon: "clock", requires: { resource: "attendance", action: "view" } },
      { label: "Roster", href: "/app/time/roster", icon: "calendar-range", requires: { resource: "roster", action: "view" } },
      { label: "Timesheets", href: "/app/time/timesheets", icon: "list-checks", requires: { resource: "attendance", action: "approve" } },
    ],
    portal: [{ label: "Time", href: "/staff/time", icon: "clock", tab: true, homeAction: true }],
    widgets: [
      { key: "whos_in", label: "Who's in", section: "today", requires: { resource: "attendance", action: "view" } },
      { key: "shifts_today", label: "Shifts today", section: "today", requires: { resource: "roster", action: "view" } },
    ],
    notifications: [
      {
        key: "attendance.correction_requested",
        label: "Time fix requested",
        description: "When someone asks to fix a clock time.",
        defaultChannels: ["in_app"],
      },
      {
        key: "attendance.missed_clock_out",
        label: "Missed clock-out",
        description: "When someone forgets to clock out.",
        defaultChannels: ["in_app"],
      },
    ],
    setup: { title: "Shifts & rules", description: "Your usual shifts, grace period and overtime rates." },
    checklist: [
      { key: "attendance.shifts", label: "Check your shifts and rules", href: "/app/workspace/tools/attendance" },
      { key: "attendance.geofence", label: "Pin your locations for location clock-in", href: "/app/workspace/company" },
    ],
    approvalTypes: ["attendance_correction", "timesheet"],
  },
  {
    key: "leave",
    name: "Time off",
    category: "run",
    core: false,
    icon: "calendar",
    tagline: "People ask for time off on their phone, managers answer in a tap, balances stay right.",
    features: [
      "Annual, sick, family and your own types",
      "Balances that build up by themselves",
      "A team calendar that shows clashes",
      "Public holidays loaded for you",
    ],
    outcomes: [
      "Answer a leave request from anywhere in one tap",
      "Spot two chefs off in the same week before you approve",
      "Stop keeping balances in a spreadsheet",
      "Send unpaid days to payroll automatically",
      "Ask for a medical certificate only when your rules need one",
    ],
    requires: [],
    recommends: ["payroll"],
    resources: [{ key: "leave", label: "Time off", description: "Requests, balances and adjustments.", actions: ALL, employeeScoped: true }],
    nav: [
      { label: "Time off", href: "/app/time-off", icon: "calendar", requires: { resource: "leave", action: "view" } },
      { label: "Time off calendar", href: "/app/time-off/calendar", icon: "calendar-range", requires: { resource: "leave", action: "view" } },
    ],
    portal: [{ label: "Time off", href: "/staff/time-off", icon: "calendar", homeAction: true }],
    widgets: [{ key: "off_today", label: "Who's off", section: "today", requires: { resource: "leave", action: "view" } }],
    notifications: [
      {
        key: "leave.requested",
        label: "Time off requested",
        description: "When someone in your team asks for time off.",
        defaultChannels: ["in_app", "email"],
      },
      {
        key: "leave.decided",
        label: "Time off answered",
        description: "When your request is approved or declined.",
        defaultChannels: ["in_app", "email"],
      },
    ],
    setup: { title: "Time off types", description: "Which kinds of leave you give and how many days." },
    checklist: [
      { key: "leave.types", label: "Check your time off types", href: "/app/workspace/tools/leave" },
      { key: "leave.holidays", label: "Check this year's public holidays", href: "/app/workspace/tools/leave" },
    ],
    approvalTypes: ["leave"],
  },
  {
    key: "compliance",
    name: "Permits & renewals",
    category: "run",
    core: false,
    icon: "badge-alert",
    tagline: "Work permits, passports, visas and contracts, with reminders before anything runs out.",
    features: [
      "Permits, passports, visas, medicals",
      "Permit numbers, deposits and insurance",
      "A 30, 60 and 90 day view",
      "Reminders to HR and the person",
    ],
    outcomes: [
      "Renew a work permit before it lapses, not after",
      "See every expatriate's permit, deposit and insurance on one page",
      "Get reminded three months, then one month, before an expiry",
      "Know which contracts and probations end this quarter",
    ],
    requires: [],
    recommends: [],
    resources: [
      {
        key: "compliance",
        label: "Permits & renewals",
        description: "Permits, passports, visas and other expiring papers.",
        actions: CRUD,
        employeeScoped: true,
      },
    ],
    nav: [{ label: "Permits & renewals", href: "/app/permits", icon: "badge-alert", requires: { resource: "compliance", action: "view" } }],
    portal: [],
    widgets: [{ key: "expiring_permits", label: "Permits expiring", section: "attention", requires: { resource: "compliance", action: "view" } }],
    notifications: [
      {
        key: "compliance.expiring",
        label: "Something is expiring",
        description: "Before a permit, passport or visa runs out.",
        defaultChannels: ["in_app", "email"],
      },
    ],
    checklist: [{ key: "compliance.items", label: "Add work permits and passports", href: "/app/permits" }],
    approvalTypes: [],
  },

  // =================================================================
  // PAY
  // =================================================================
  {
    key: "payroll",
    name: "Payroll",
    category: "pay",
    core: false,
    icon: "wallet",
    tagline: "Work out pay from hours, time off and claims, check it, lock it, and send payslips.",
    features: [
      "Allowances, deductions and loans",
      "Pulls in hours, unpaid days and claims",
      "Warns you before you lock a run",
      "Payslips, bank file and journal",
    ],
    outcomes: [
      "Run the month's payroll in an afternoon",
      "Catch a missing bank account before pay day, not after",
      "Hand your accountant a journal they can post straight away",
      "Upload one bank file instead of typing every transfer",
      "Have pension and tax figures ready for filing",
      "Recover salary advances in instalments automatically",
    ],
    requires: [],
    recommends: ["attendance", "leave", "claims"],
    resources: [
      { key: "payroll", label: "Payroll", description: "Pay runs, rates and reports.", actions: ALL, employeeScoped: false, ownerGrantOnly: true },
      {
        key: "payslips",
        label: "Payslips",
        description: "View and download payslips.",
        actions: ["view", "export"],
        employeeScoped: true,
        ownerGrantOnly: true,
      },
    ],
    nav: [{ label: "Payroll", href: "/app/payroll", icon: "wallet", requires: { resource: "payroll", action: "view" } }],
    portal: [{ label: "Pay", href: "/staff/pay", icon: "wallet", tab: true, requires: { resource: "payslips", action: "view" } }],
    widgets: [
      { key: "payroll_due", label: "Next pay day", section: "attention", requires: { resource: "payroll", action: "view" } },
      { key: "payroll_cost", label: "Payroll cost", section: "month", requires: { resource: "payroll", action: "view" } },
    ],
    notifications: [
      {
        key: "payroll.payslip_ready",
        label: "Your payslip is here",
        description: "When your payslip is published.",
        defaultChannels: ["in_app", "email"],
      },
      { key: "payroll.finalized", label: "Payroll locked", description: "When a pay run is finalised.", defaultChannels: ["in_app"] },
    ],
    setup: { title: "Pay day, pension & tax", description: "When you pay, and the rates payroll uses." },
    checklist: [
      { key: "payroll.statutory", label: "Check pay day, pension and tax rates", href: "/app/workspace/tools/payroll" },
      { key: "payroll.salaries", label: "Add salaries to people's profiles", href: "/app/people" },
    ],
    approvalTypes: [],
  },
  {
    key: "claims",
    name: "Claims",
    category: "pay",
    core: false,
    icon: "receipt",
    tagline: "Pay staff back for transport, meals, travel and supplies, each with its own rules.",
    features: [
      "Transport, meals, travel, supplies or your own",
      "A photo of the receipt from the phone",
      "Cut-off days and limits per type",
      "Paid in payroll or separately",
    ],
    outcomes: [
      "Pay ferry and taxi fares back without paper forms",
      "Set a monthly cut-off so late claims roll to next month",
      "Cap meal claims and require a receipt for supplies",
      "Send approved claims into the next payroll, or pay them separately",
      "Export what's owed when payroll is done elsewhere",
    ],
    requires: [],
    recommends: ["payroll"],
    resources: [{ key: "claims", label: "Claims", description: "Submit, approve and pay back claims.", actions: ALL, employeeScoped: true }],
    nav: [{ label: "Claims", href: "/app/claims", icon: "receipt", requires: { resource: "claims", action: "view" } }],
    portal: [
      { label: "Claims", href: "/staff/claims", icon: "receipt", homeAction: true, requires: { resource: "claims", action: "create" } },
    ],
    widgets: [{ key: "claims_to_pay", label: "Claims to be paid", section: "attention", requires: { resource: "claims", action: "view" } }],
    notifications: [
      {
        key: "claims.cutoff_reminder",
        label: "Claim cut-off coming up",
        description: "A few days before a claim type's cut-off.",
        defaultChannels: ["in_app", "email"],
      },
      { key: "claims.decided", label: "Claim answered", description: "When your claim is approved or declined.", defaultChannels: ["in_app"] },
    ],
    setup: { title: "Claim types", description: "What people can claim for, and the rules for each." },
    checklist: [{ key: "claims.types", label: "Check your claim types and cut-offs", href: "/app/workspace/tools/claims" }],
    approvalTypes: ["claim"],
  },

  // =================================================================
  // GROW
  // =================================================================
  {
    key: "learning",
    name: "Training",
    category: "grow",
    core: false,
    icon: "graduation-cap",
    tagline: "Short courses people take on their phone, with certificates and paid training on record.",
    features: [
      "Lessons, videos, PDFs and quizzes",
      "Assign by person, team or job",
      "Certificates on completion",
      "Paid courses and bonds on record",
    ],
    outcomes: [
      "Get every new server through food safety in their first week",
      "See who hasn't finished a required course",
      "Issue a certificate the moment someone passes",
      "Keep a record of courses you paid for and any bond period",
    ],
    requires: [],
    recommends: [],
    resources: [
      { key: "learning", label: "Course library", description: "Create and assign courses.", actions: CRUD, employeeScoped: false },
      {
        key: "training",
        label: "Training progress",
        description: "Who took what, and how they did.",
        actions: ["view", "edit", "export"],
        employeeScoped: true,
      },
      { key: "sponsorships", label: "Paid training", description: "External courses the company pays for.", actions: ALL, employeeScoped: true },
    ],
    nav: [{ label: "Training", href: "/app/training", icon: "graduation-cap", requires: { resource: "learning", action: "view" } }],
    portal: [{ label: "My courses", href: "/staff/courses", icon: "book-open", requires: { resource: "training", action: "view" } }],
    widgets: [{ key: "training_due", label: "Training due", section: "month", requires: { resource: "training", action: "view" } }],
    notifications: [
      {
        key: "learning.assigned",
        label: "New course for you",
        description: "When a course is assigned to you.",
        defaultChannels: ["in_app", "email"],
      },
      { key: "learning.due", label: "Course due soon", description: "Before a required course is due.", defaultChannels: ["in_app", "email"] },
    ],
    checklist: [{ key: "learning.course", label: "Make your first course", href: "/app/training/new" }],
    approvalTypes: ["training_sponsorship"],
  },
  {
    key: "performance",
    name: "Reviews & goals",
    category: "grow",
    core: false,
    icon: "target",
    tagline: "Clear goals, fair reviews and quick surveys, kept simple.",
    features: ["Company, team and personal goals", "Self and manager reviews", "Notes from one-to-ones", "Surveys, anonymous if you like"],
    outcomes: [
      "Agree three goals per person and see progress",
      "Run a yearly review without chasing paper forms",
      "Keep one-to-one notes next to the review",
      "Hear from staff honestly with anonymous surveys",
    ],
    requires: [],
    recommends: ["learning"],
    resources: [
      { key: "goals", label: "Goals", description: "Set and update goals.", actions: CRUD, employeeScoped: true },
      { key: "reviews", label: "Reviews", description: "Review rounds and reviews.", actions: ALL, employeeScoped: true },
      { key: "surveys", label: "Surveys", description: "Staff surveys.", actions: CRUD, employeeScoped: false },
    ],
    nav: [
      { label: "Reviews", href: "/app/reviews", icon: "clipboard-check", requires: { resource: "reviews", action: "view" } },
      { label: "Goals", href: "/app/reviews/goals", icon: "target", requires: { resource: "goals", action: "view" } },
      { label: "Surveys", href: "/app/reviews/surveys", icon: "message-square", requires: { resource: "surveys", action: "create" } },
    ],
    portal: [
      { label: "My goals", href: "/staff/goals", icon: "target", requires: { resource: "goals", action: "view" } },
      { label: "My reviews", href: "/staff/reviews", icon: "clipboard-check", requires: { resource: "reviews", action: "view" } },
    ],
    widgets: [{ key: "review_progress", label: "Review progress", section: "month", requires: { resource: "reviews", action: "view" } }],
    notifications: [
      { key: "review.opened", label: "Time for your review", description: "When a review round opens.", defaultChannels: ["in_app", "email"] },
      {
        key: "review.shared",
        label: "Your review is ready",
        description: "When your manager shares your review.",
        defaultChannels: ["in_app", "email"],
      },
      { key: "survey.opened", label: "New survey", description: "When a survey opens for you.", defaultChannels: ["in_app"] },
    ],
    setup: { title: "First review round", description: "When you'd like to run your first review." },
    checklist: [{ key: "performance.cycle", label: "Plan your first review round", href: "/app/workspace/tools/performance" }],
    approvalTypes: [],
  },
];

// ---------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------
export const MODULE_MAP: Record<ModuleKey, ModuleDefinition> = Object.fromEntries(MODULES.map((m) => [m.key, m])) as Record<
  ModuleKey,
  ModuleDefinition
>;

export const CORE_MODULE_KEYS: ModuleKey[] = MODULES.filter((m) => m.core).map((m) => m.key);
export const OPTIONAL_MODULES: ModuleDefinition[] = MODULES.filter((m) => !m.core);
/** Foundation tools shown to people (excludes built-in features like Home). */
export const FOUNDATION_TOOLS: ModuleDefinition[] = MODULES.filter((m) => m.core && !m.builtIn);
/** The four stages people choose tools from. */
export const TOOL_STAGES = STAGES.filter((s) => s.key !== "foundation");

export function toolsInStage(stage: ToolStage): ModuleDefinition[] {
  return MODULES.filter((m) => m.category === stage && !m.builtIn);
}

export function getModule(key: string): ModuleDefinition | undefined {
  return MODULE_MAP[key as ModuleKey];
}

export function isModuleKey(key: string): key is ModuleKey {
  return key in MODULE_MAP;
}

/**
 * Notifications only offered to people who can act on them (for example
 * "a request needs you" only for approvers). Events not listed here are
 * about the person themselves, so everyone gets them.
 */
export const NOTIFICATION_AUDIENCE: Record<string, { resource: string; action: PermissionAction; scope?: PermissionScope }> = {
  "employee.created": { resource: "employees", action: "view", scope: "all" },
  "employee.probation_ending": { resource: "employees", action: "view", scope: "team" },
  "approval.requested": { resource: "approvals", action: "approve" },
  "letter.requested": { resource: "letters", action: "approve" },
  "export.ready": { resource: "data_export", action: "create" },
  "recruitment.application": { resource: "recruitment", action: "view" },
  "recruitment.interview": { resource: "recruitment", action: "view" },
  "attendance.correction_requested": { resource: "attendance", action: "approve" },
  "leave.requested": { resource: "leave", action: "approve" },
  "compliance.expiring": { resource: "compliance", action: "view", scope: "team" },
  "payroll.finalized": { resource: "payroll", action: "view" },
};

/** Old tool keys that were merged into new ones. */
export const LEGACY_KEYS: Record<string, ModuleKey> = { transport: "claims", expenses: "claims" };

/** All permission resources across every tool (for the permission matrix). */
export function allResources() {
  return MODULES.flatMap((m) => m.resources.map((r) => ({ ...r, moduleKey: m.key, moduleName: m.name })));
}

/** The tool a permission resource belongs to. */
export function moduleForResource(resource: string): ModuleDefinition | undefined {
  return MODULES.find((m) => m.resources.some((r) => r.key === resource));
}
