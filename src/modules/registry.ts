/**
 * MODULE REGISTRY — the single source of truth for every module.
 *
 * The onboarding wizard, Settings → Modules, the sidebar, dashboard
 * widgets, staff portal, notifications, permissions and the pricing
 * calculator all read from this list.
 *
 * To add a new module: add its key to ModuleKey in ./types.ts, add a
 * definition below, (optionally) add its price in src/config/app.config.ts,
 * and create its database tables in a new migration using
 * private.std_rls(...). See README → "Adding a new module".
 */
import type { ModuleCategory, ModuleDefinition, ModuleKey } from "./types";

const ALL: ("view" | "create" | "edit" | "approve" | "delete" | "export")[] = [
  "view",
  "create",
  "edit",
  "approve",
  "delete",
  "export",
];
const CRUD: ("view" | "create" | "edit" | "delete" | "export")[] = ["view", "create", "edit", "delete", "export"];

export const MODULE_CATEGORIES: { key: ModuleCategory; label: string; description: string }[] = [
  { key: "core", label: "Core", description: "The foundation every business needs." },
  { key: "workforce", label: "Workforce", description: "Track time and manage leave." },
  { key: "hiring", label: "Hiring & compliance", description: "Hire, welcome, and keep paperwork up to date." },
  { key: "pay", label: "Pay", description: "Run payroll and reimburse staff." },
  { key: "development", label: "Development", description: "Train your people and help them grow." },
];

export const MODULES: ModuleDefinition[] = [
  // =================================================================
  // CORE
  // =================================================================
  {
    key: "employees",
    name: "Employee records & organization",
    category: "core",
    core: true,
    icon: "users",
    tagline: "Every employee's details in one secure place, with your company structure.",
    features: [
      "Branches, departments, positions and an org chart",
      "Complete employee profiles with a full change history",
      "Statuses from probation to exit, with reasons",
      "Search, filter and export to Excel",
    ],
    whoFor: "Owners and HR teams",
    requires: [],
    recommends: [],
    resources: [
      { key: "employees", label: "Employee profiles", description: "Personal, contact and job details.", actions: ALL, employeeScoped: true },
      { key: "org", label: "Company structure", description: "Branches, departments and positions.", actions: CRUD, employeeScoped: false },
      {
        key: "compensation",
        label: "Salary & bank details",
        description: "Salaries, allowances, loans and bank accounts.",
        actions: CRUD,
        employeeScoped: true,
        ownerGrantOnly: true,
      },
      { key: "users", label: "User accounts", description: "Invite people and link logins to employees.", actions: CRUD, employeeScoped: false },
    ],
    nav: [
      { label: "Employees", href: "/app/employees", icon: "users", requires: { resource: "employees", action: "view" } },
      { label: "Organization", href: "/app/organization", icon: "building", requires: { resource: "org", action: "view" } },
    ],
    portal: [
      { label: "Directory", href: "/portal/directory", icon: "users" },
      { label: "My profile", href: "/portal/profile", icon: "users" },
    ],
    widgets: [
      { key: "headcount", label: "Headcount", requires: { resource: "employees", action: "view" } },
      { key: "celebrations", label: "Birthdays & work anniversaries", requires: { resource: "employees", action: "view" } },
      { key: "probation_ending", label: "Probations ending soon", requires: { resource: "employees", action: "view" } },
    ],
    notifications: [
      { key: "employee.created", label: "New employee added", description: "When someone joins the company.", defaultChannels: ["in_app"] },
      { key: "employee.probation_ending", label: "Probation ending", description: "Two weeks before a probation period ends.", defaultChannels: ["in_app", "email"] },
    ],
    setup: { title: "Departments & positions", description: "Add the teams and job titles in your business." },
    checklist: [
      { key: "org.departments", label: "Add your departments", href: "/app/organization" },
      { key: "employees.first", label: "Add your first employee", href: "/app/employees/new" },
    ],
    approvalTypes: [],
  },
  {
    key: "approvals",
    name: "Approvals inbox",
    category: "core",
    core: true,
    icon: "inbox",
    tagline: "One inbox for every request that needs a decision.",
    features: [
      "Leave, timesheets, claims and letter requests in one place",
      "Approval chains by manager, role or amount",
      "Approve in bulk, or reject with a comment",
      "Delegate your approvals while you are away",
    ],
    whoFor: "Managers, HR and owners",
    requires: [],
    recommends: [],
    resources: [
      { key: "approvals", label: "Approvals", description: "See and decide requests; set up approval chains.", actions: ["view", "approve", "edit"], employeeScoped: true },
    ],
    nav: [{ label: "Approvals", href: "/app/approvals", icon: "inbox" }],
    portal: [],
    widgets: [{ key: "pending_approvals", label: "Waiting for your approval" }],
    notifications: [
      { key: "approval.requested", label: "New request to approve", description: "When a request is waiting for you.", defaultChannels: ["in_app", "email"] },
      { key: "approval.decided", label: "Your request was decided", description: "When your request is approved or rejected.", defaultChannels: ["in_app", "email"] },
    ],
    checklist: [{ key: "approvals.chains", label: "Review your approval chains", href: "/app/settings/approvals" }],
    approvalTypes: [],
  },
  {
    key: "documents",
    name: "Documents & staff letters",
    category: "core",
    core: true,
    icon: "file-text",
    tagline: "Store employee files and create branded letters in seconds.",
    features: [
      "Document storage per employee, sorted into categories",
      "Letter templates with automatic name, salary and date fields",
      "Salary certificates, NOCs, warnings and experience letters",
      "Your logo, letterhead, signature and stamp on every letter",
    ],
    whoFor: "HR teams",
    requires: [],
    recommends: [],
    resources: [
      { key: "documents", label: "Employee documents", description: "Upload and view employee files.", actions: CRUD, employeeScoped: true },
      { key: "letters", label: "Staff letters", description: "Create letters and handle letter requests.", actions: ALL, employeeScoped: true },
    ],
    nav: [
      { label: "Documents", href: "/app/documents", icon: "folder", requires: { resource: "documents", action: "view" } },
      { label: "Letters", href: "/app/letters", icon: "file-signature", requires: { resource: "letters", action: "view" } },
    ],
    portal: [
      { label: "My documents", href: "/portal/documents", icon: "folder", requires: { resource: "documents", action: "view" } },
      { label: "Request a letter", href: "/portal/letters", icon: "file-signature", requires: { resource: "letters", action: "create" } },
    ],
    widgets: [{ key: "expiring_documents", label: "Documents expiring soon", requires: { resource: "documents", action: "view" } }],
    notifications: [
      { key: "letter.requested", label: "Letter requested", description: "When a staff member asks for a letter.", defaultChannels: ["in_app"] },
      { key: "letter.ready", label: "Your letter is ready", description: "When a requested letter has been issued.", defaultChannels: ["in_app", "email"] },
    ],
    checklist: [{ key: "documents.branding", label: "Upload your logo and signature", href: "/app/settings/branding" }],
    approvalTypes: ["letter_request"],
  },
  {
    key: "roles",
    name: "Roles & permissions",
    category: "core",
    core: true,
    icon: "shield",
    tagline: "Decide exactly who can see and do what.",
    features: [
      "Ready-made roles from Owner to Employee",
      "A permission grid for every module",
      "Managers see only their own team",
      "Salary data locked to the people you choose",
    ],
    whoFor: "Owners and admins",
    requires: [],
    recommends: [],
    resources: [
      { key: "roles", label: "Roles & permissions", description: "Create roles and change what they can do.", actions: CRUD, employeeScoped: false, ownerGrantOnly: true },
    ],
    nav: [],
    portal: [],
    widgets: [],
    notifications: [],
    checklist: [{ key: "roles.invite", label: "Invite your managers", href: "/app/settings/users" }],
    approvalTypes: [],
  },
  {
    key: "dashboard",
    name: "Dashboard & quick menu",
    category: "core",
    core: true,
    icon: "layout-dashboard",
    tagline: "See what needs your attention today, and jump anywhere with Ctrl+K.",
    features: [
      "A dashboard that fits each person's role",
      "Who's in, who's on leave, and what's pending",
      "Birthdays, anniversaries and expiring documents",
      "Search anything with Ctrl+K",
    ],
    whoFor: "Everyone",
    requires: [],
    recommends: [],
    resources: [],
    nav: [{ label: "Dashboard", href: "/app", icon: "layout-dashboard" }],
    portal: [],
    widgets: [{ key: "getting_started", label: "Getting started checklist", requires: { resource: "settings", action: "edit" } }],
    notifications: [],
    checklist: [],
    approvalTypes: [],
  },
  {
    key: "notifications",
    name: "Notifications",
    category: "core",
    core: true,
    icon: "bell",
    tagline: "The right people hear about the right things, in-app and by email.",
    features: [
      "In-app notification bell",
      "Email notifications",
      "Each person chooses what they receive",
      "Ready for SMS and WhatsApp later",
    ],
    whoFor: "Everyone",
    requires: [],
    recommends: [],
    resources: [],
    nav: [],
    portal: [],
    widgets: [],
    notifications: [],
    checklist: [{ key: "notifications.test", label: "Send a test email", href: "/app/settings/notifications" }],
    approvalTypes: [],
  },
  {
    key: "portal",
    name: "Staff self-service portal",
    category: "core",
    core: true,
    icon: "smartphone",
    tagline: "A phone-friendly app for staff: install it from the browser in one tap.",
    features: [
      "Works on any phone, no app store needed",
      "Big buttons you can use with one hand",
      "Shows only the features your business uses",
      "Company announcements on the home screen",
    ],
    whoFor: "All staff",
    requires: [],
    recommends: [],
    resources: [
      { key: "announcements", label: "Announcements", description: "Post news to staff.", actions: CRUD, employeeScoped: false },
    ],
    nav: [{ label: "Announcements", href: "/app/announcements", icon: "megaphone", requires: { resource: "announcements", action: "create" } }],
    portal: [
      { label: "Home", href: "/portal", icon: "home", tab: true },
      { label: "Announcements", href: "/portal/announcements", icon: "megaphone" },
    ],
    widgets: [],
    notifications: [
      { key: "announcement.published", label: "New announcement", description: "When the company posts news.", defaultChannels: ["in_app"] },
    ],
    checklist: [{ key: "portal.announcement", label: "Post your first announcement", href: "/app/announcements" }],
    approvalTypes: [],
  },
  {
    key: "system",
    name: "System, security & data",
    category: "core",
    core: true,
    icon: "settings",
    tagline: "Backups, exports, audit trail and support, built in.",
    features: [
      "Automatic daily backups",
      "Export all of your data at any time",
      "Activity log of sensitive actions",
      "Optional two-step login",
    ],
    whoFor: "Owners and admins",
    requires: [],
    recommends: [],
    resources: [
      { key: "settings", label: "Business settings", description: "Company details, branding and preferences.", actions: ["view", "edit"], employeeScoped: false },
      { key: "modules", label: "Modules", description: "Turn modules on or off.", actions: ["view", "edit"], employeeScoped: false },
      { key: "audit", label: "Activity log", description: "See who did what, and when.", actions: ["view", "export"], employeeScoped: false },
      { key: "data_export", label: "Data export", description: "Download all business data.", actions: ["view", "create"], employeeScoped: false },
      { key: "support", label: "Support access", description: "Give our support team temporary access.", actions: ["view", "edit"], employeeScoped: false },
    ],
    nav: [
      { label: "Reports", href: "/app/reports", icon: "bar-chart" },
      { label: "Settings", href: "/app/settings", icon: "settings", requires: { resource: "settings", action: "view" } },
      { label: "Help & support", href: "/app/help", icon: "life-buoy" },
    ],
    portal: [],
    widgets: [],
    notifications: [
      { key: "security.sign_in", label: "New sign-in", description: "When your account signs in on a new device.", defaultChannels: ["email"] },
      { key: "export.ready", label: "Data export ready", description: "When your data export can be downloaded.", defaultChannels: ["in_app", "email"] },
    ],
    checklist: [{ key: "system.profile", label: "Complete your business profile", href: "/app/settings/business" }],
    approvalTypes: [],
  },

  // =================================================================
  // WORKFORCE
  // =================================================================
  {
    key: "attendance",
    name: "Attendance & time tracking",
    category: "workforce",
    core: false,
    icon: "clock",
    tagline: "Staff clock in from their phone; you get accurate hours and overtime.",
    features: [
      "Clock in and out on mobile, with optional GPS and selfie",
      "Drag-and-drop weekly rosters and shifts",
      "Late marks, half days and overtime rules",
      "Approved hours flow straight into payroll",
    ],
    whoFor: "Resorts, restaurants, retail and any shift-based team",
    requires: [],
    recommends: ["payroll"],
    resources: [
      { key: "attendance", label: "Attendance & timesheets", description: "Clock records, corrections and timesheets.", actions: ALL, employeeScoped: true },
      { key: "roster", label: "Shifts & roster", description: "Shift definitions and weekly rosters.", actions: CRUD, employeeScoped: true },
    ],
    nav: [
      { label: "Attendance", href: "/app/attendance", icon: "clock", requires: { resource: "attendance", action: "view" } },
      { label: "Roster", href: "/app/attendance/roster", icon: "calendar-range", requires: { resource: "roster", action: "view" } },
      { label: "Timesheets", href: "/app/attendance/timesheets", icon: "list-checks", requires: { resource: "attendance", action: "approve" } },
    ],
    portal: [
      { label: "Clock in", href: "/portal/clock", icon: "clock", tab: true, homeAction: true },
      { label: "My attendance", href: "/portal/attendance", icon: "calendar-range", requires: { resource: "attendance", action: "view" } },
    ],
    widgets: [
      { key: "whos_in", label: "Who's in today", requires: { resource: "attendance", action: "view" } },
      { key: "late_today", label: "Late today", requires: { resource: "attendance", action: "view" } },
    ],
    notifications: [
      { key: "attendance.correction_requested", label: "Attendance correction requested", description: "When staff ask to fix a clock time.", defaultChannels: ["in_app"] },
      { key: "attendance.missed_clock_out", label: "Missed clock-out", description: "When someone forgets to clock out.", defaultChannels: ["in_app"] },
    ],
    setup: { title: "Work schedule & shift rules", description: "Set your shifts, grace period and overtime rules." },
    checklist: [
      { key: "attendance.shifts", label: "Create your shifts", href: "/app/attendance/settings" },
      { key: "attendance.geofence", label: "Set branch locations for GPS clock-in", href: "/app/organization" },
    ],
    approvalTypes: ["attendance_correction", "timesheet"],
  },
  {
    key: "leave",
    name: "Leave management",
    category: "workforce",
    core: false,
    icon: "calendar",
    tagline: "Staff apply from their phone; managers approve in a tap; balances stay right.",
    features: [
      "Annual, sick, family, maternity, paternity and custom leave types",
      "Automatic accruals and carry-forward",
      "Team calendar that shows clashes",
      "Maldives public holidays loaded to start you off",
    ],
    whoFor: "Every business with employees",
    requires: [],
    recommends: ["payroll"],
    resources: [{ key: "leave", label: "Leave", description: "Leave requests, balances and adjustments.", actions: ALL, employeeScoped: true }],
    nav: [
      { label: "Leave", href: "/app/leave", icon: "calendar", requires: { resource: "leave", action: "view" } },
      { label: "Leave calendar", href: "/app/leave/calendar", icon: "calendar-range", requires: { resource: "leave", action: "view" } },
    ],
    portal: [{ label: "Leave", href: "/portal/leave", icon: "calendar", tab: true, homeAction: true, requires: { resource: "leave", action: "create" } }],
    widgets: [{ key: "on_leave_today", label: "On leave today", requires: { resource: "leave", action: "view" } }],
    notifications: [
      { key: "leave.requested", label: "Leave requested", description: "When someone in your team applies for leave.", defaultChannels: ["in_app", "email"] },
      { key: "leave.decided", label: "Leave approved or rejected", description: "When your leave request is decided.", defaultChannels: ["in_app", "email"] },
    ],
    setup: { title: "Leave types & entitlements", description: "Check the leave types and how many days staff get." },
    checklist: [
      { key: "leave.types", label: "Review leave types", href: "/app/leave/settings" },
      { key: "leave.holidays", label: "Check this year's public holidays", href: "/app/leave/holidays" },
    ],
    approvalTypes: ["leave"],
  },

  // =================================================================
  // HIRING & COMPLIANCE
  // =================================================================
  {
    key: "recruitment",
    name: "Recruitment",
    category: "hiring",
    core: false,
    icon: "briefcase",
    tagline: "Post jobs, track candidates on a board, and hire in one click.",
    features: [
      "Vacancies with an optional public careers page",
      "Drag-and-drop candidate pipeline",
      "Interview scheduling, notes and ratings",
      "Turn a hired candidate into an employee instantly",
    ],
    whoFor: "Growing teams that hire regularly",
    requires: [],
    recommends: ["onboarding"],
    resources: [{ key: "recruitment", label: "Recruitment", description: "Vacancies, candidates and offers.", actions: CRUD, employeeScoped: false }],
    nav: [{ label: "Recruitment", href: "/app/recruitment", icon: "briefcase", requires: { resource: "recruitment", action: "view" } }],
    portal: [],
    widgets: [{ key: "open_vacancies", label: "Open vacancies", requires: { resource: "recruitment", action: "view" } }],
    notifications: [
      { key: "recruitment.application", label: "New application", description: "When a candidate applies.", defaultChannels: ["in_app", "email"] },
      { key: "recruitment.interview", label: "Interview reminder", description: "Before a scheduled interview.", defaultChannels: ["in_app", "email"] },
    ],
    checklist: [{ key: "recruitment.vacancy", label: "Create your first vacancy", href: "/app/recruitment/vacancies/new" }],
    approvalTypes: [],
  },
  {
    key: "onboarding",
    name: "Onboarding & offboarding",
    category: "hiring",
    core: false,
    icon: "clipboard-check",
    tagline: "Checklists that make every first day and last day smooth.",
    features: [
      "Checklist templates per department or position",
      "Tasks for HR, the manager and the new employee",
      "Starts by itself when someone is hired",
      "Exit checklist: assets, settlement, exit interview",
    ],
    whoFor: "HR teams and managers",
    requires: [],
    recommends: ["recruitment"],
    resources: [{ key: "onboarding", label: "Onboarding & offboarding", description: "Checklists and tasks.", actions: CRUD, employeeScoped: true }],
    nav: [{ label: "Onboarding", href: "/app/onboarding", icon: "clipboard-check", requires: { resource: "onboarding", action: "view" } }],
    portal: [{ label: "My tasks", href: "/portal/tasks", icon: "list-checks" }],
    widgets: [{ key: "onboarding_progress", label: "Onboarding in progress", requires: { resource: "onboarding", action: "view" } }],
    notifications: [{ key: "onboarding.task_assigned", label: "Task assigned to you", description: "When a checklist task is given to you.", defaultChannels: ["in_app", "email"] }],
    checklist: [{ key: "onboarding.template", label: "Review the onboarding checklist", href: "/app/onboarding/templates" }],
    approvalTypes: [],
  },
  {
    key: "compliance",
    name: "Compliance & expiry tracking",
    category: "hiring",
    core: false,
    icon: "badge-alert",
    tagline: "Never miss a work permit, passport, visa or contract renewal again.",
    features: [
      "Work permits, passports, visas, medicals and licences",
      "Built for expatriate staff: permit numbers, deposits and insurance",
      "Colour-coded 30/60/90-day expiry board",
      "Automatic reminders to HR and the employee",
    ],
    whoFor: "Businesses with expatriate staff or licensed roles",
    requires: [],
    recommends: [],
    resources: [{ key: "compliance", label: "Compliance items", description: "Permits, passports, visas and other expiring documents.", actions: CRUD, employeeScoped: true }],
    nav: [{ label: "Compliance", href: "/app/compliance", icon: "badge-alert", requires: { resource: "compliance", action: "view" } }],
    portal: [],
    widgets: [{ key: "expiring_compliance", label: "Permits & documents expiring", requires: { resource: "compliance", action: "view" } }],
    notifications: [{ key: "compliance.expiring", label: "Document expiring", description: "Before a permit, passport or visa expires.", defaultChannels: ["in_app", "email"] }],
    checklist: [{ key: "compliance.items", label: "Add work permits and passports", href: "/app/compliance" }],
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
    tagline: "Calculate, check and finalize payroll, then send payslips and a ready-made journal.",
    features: [
      "Allowances, deductions, loans and advances",
      "Pulls in attendance, overtime, unpaid leave and claims",
      "Checks for problems before you finalize",
      "Branded payslips, bank transfer file and accounting journal",
    ],
    whoFor: "Owners and payroll officers",
    requires: [],
    recommends: ["attendance", "leave"],
    resources: [
      { key: "payroll", label: "Payroll", description: "Payroll runs, settings, statutory rates and reports.", actions: ALL, employeeScoped: false, ownerGrantOnly: true },
      { key: "payslips", label: "Payslips", description: "View and download payslips.", actions: ["view", "export"], employeeScoped: true, ownerGrantOnly: true },
    ],
    nav: [
      { label: "Payroll", href: "/app/payroll", icon: "wallet", requires: { resource: "payroll", action: "view" } },
    ],
    portal: [{ label: "Payslips", href: "/portal/payslips", icon: "wallet", tab: true, requires: { resource: "payslips", action: "view" } }],
    widgets: [{ key: "payroll_status", label: "Payroll status", requires: { resource: "payroll", action: "view" } }],
    notifications: [
      { key: "payroll.payslip_ready", label: "Payslip available", description: "When your payslip is published.", defaultChannels: ["in_app", "email"] },
      { key: "payroll.finalized", label: "Payroll finalized", description: "When a payroll run is locked.", defaultChannels: ["in_app"] },
    ],
    setup: { title: "Pay cycle & statutory settings", description: "Choose your pay day and check pension and tax rates." },
    checklist: [
      { key: "payroll.schedule", label: "Set your pay day", href: "/app/payroll/settings" },
      { key: "payroll.statutory", label: "Check pension & tax rates", href: "/app/payroll/settings/statutory" },
      { key: "payroll.salaries", label: "Enter employee salaries", href: "/app/employees" },
    ],
    approvalTypes: [],
  },
  {
    key: "transport",
    name: "Transport allowance claims",
    category: "pay",
    core: false,
    icon: "bus",
    tagline: "Staff claim ferry, speedboat and taxi fares from their phone; approved claims go into payroll.",
    features: [
      "Claim with a receipt photo from the staff app",
      "Manager approval through the Approvals Inbox",
      "Cut-off dates that follow your payroll calendar",
      "Approved claims added to the next payroll automatically",
    ],
    whoFor: "Businesses that reimburse staff travel",
    requires: ["payroll"],
    requiresReason: "Transport claims are paid through payroll",
    recommends: [],
    resources: [{ key: "transport_claims", label: "Transport claims", description: "Submit and approve transport claims.", actions: ALL, employeeScoped: true }],
    nav: [{ label: "Transport claims", href: "/app/claims/transport", icon: "bus", requires: { resource: "transport_claims", action: "view" } }],
    portal: [{ label: "Transport claim", href: "/portal/claims", icon: "bus", homeAction: true, requires: { resource: "transport_claims", action: "create" } }],
    widgets: [],
    notifications: [
      { key: "transport.cutoff_reminder", label: "Claim cut-off reminder", description: "A few days before the claim cut-off date.", defaultChannels: ["in_app", "email"] },
      { key: "transport.decided", label: "Claim approved or rejected", description: "When your claim is decided.", defaultChannels: ["in_app"] },
    ],
    setup: { title: "Claim cut-off date", description: "Choose the last day each month to claim for this payroll." },
    checklist: [{ key: "transport.cutoff", label: "Set the claim cut-off day", href: "/app/payroll/settings" }],
    approvalTypes: ["transport_claim"],
  },
  {
    key: "expenses",
    name: "Expense claims",
    category: "pay",
    core: false,
    icon: "receipt",
    tagline: "Reimburse work expenses with receipts, approvals and clean reports.",
    features: [
      "Snap a receipt and submit in seconds",
      "Categories and approval limits by amount",
      "Pay back through payroll or separately",
      "Expense reports ready to export",
    ],
    whoFor: "Teams that spend money on the company's behalf",
    requires: [],
    recommends: ["payroll"],
    resources: [{ key: "expenses", label: "Expense claims", description: "Submit, approve and reimburse expenses.", actions: ALL, employeeScoped: true }],
    nav: [{ label: "Expenses", href: "/app/expenses", icon: "receipt", requires: { resource: "expenses", action: "view" } }],
    portal: [{ label: "Expense claim", href: "/portal/expenses", icon: "receipt", homeAction: true, requires: { resource: "expenses", action: "create" } }],
    widgets: [],
    notifications: [{ key: "expense.decided", label: "Expense approved or rejected", description: "When your expense claim is decided.", defaultChannels: ["in_app"] }],
    checklist: [{ key: "expenses.categories", label: "Set up expense categories", href: "/app/expenses/settings" }],
    approvalTypes: ["expense_claim"],
  },

  // =================================================================
  // DEVELOPMENT
  // =================================================================
  {
    key: "learning",
    name: "Learning",
    category: "development",
    core: false,
    icon: "graduation-cap",
    tagline: "Build short courses, assign them, and see who has finished.",
    features: [
      "Courses with text, videos, PDFs and quizzes",
      "Assign to people, departments or positions",
      "Automatic completion certificates",
      "Track company-paid external training and bonds",
    ],
    whoFor: "Businesses that train staff regularly",
    requires: [],
    recommends: [],
    resources: [
      { key: "learning", label: "Course library", description: "Create courses and assign them.", actions: CRUD, employeeScoped: false },
      { key: "training", label: "Training progress", description: "Course enrolments and completion.", actions: ["view", "edit", "export"], employeeScoped: true },
      { key: "sponsorships", label: "Training sponsorships", description: "Company-paid external training.", actions: ALL, employeeScoped: true },
    ],
    nav: [{ label: "Learning", href: "/app/learning", icon: "graduation-cap", requires: { resource: "learning", action: "view" } }],
    portal: [{ label: "My courses", href: "/portal/learning", icon: "book-open", requires: { resource: "training", action: "view" } }],
    widgets: [{ key: "training_due", label: "Training due", requires: { resource: "training", action: "view" } }],
    notifications: [
      { key: "learning.assigned", label: "Course assigned", description: "When a course is assigned to you.", defaultChannels: ["in_app", "email"] },
      { key: "learning.due", label: "Course due soon", description: "Before a mandatory course is due.", defaultChannels: ["in_app", "email"] },
    ],
    checklist: [{ key: "learning.course", label: "Create your first course", href: "/app/learning/courses/new" }],
    approvalTypes: ["training_sponsorship"],
  },
  {
    key: "performance",
    name: "People development",
    category: "development",
    core: false,
    icon: "target",
    tagline: "Simple goals, fair reviews and honest feedback.",
    features: [
      "Company, team and personal goals",
      "Self and manager reviews, with optional peer reviews",
      "One-to-one meeting notes",
      "Engagement and pulse surveys, anonymous if you like",
    ],
    whoFor: "Businesses that want to grow their people",
    requires: [],
    recommends: ["learning"],
    resources: [
      { key: "goals", label: "Goals", description: "Set and update goals.", actions: CRUD, employeeScoped: true },
      { key: "reviews", label: "Performance reviews", description: "Review cycles and reviews.", actions: ALL, employeeScoped: true },
      { key: "surveys", label: "Surveys", description: "Engagement and pulse surveys.", actions: CRUD, employeeScoped: false },
    ],
    nav: [
      { label: "Goals", href: "/app/performance/goals", icon: "target", requires: { resource: "goals", action: "view" } },
      { label: "Reviews", href: "/app/performance/reviews", icon: "clipboard-check", requires: { resource: "reviews", action: "view" } },
      { label: "Surveys", href: "/app/performance/surveys", icon: "message-square", requires: { resource: "surveys", action: "create" } },
    ],
    portal: [
      { label: "My goals", href: "/portal/goals", icon: "target", requires: { resource: "goals", action: "view" } },
      { label: "My reviews", href: "/portal/reviews", icon: "clipboard-check", requires: { resource: "reviews", action: "view" } },
      { label: "Surveys", href: "/portal/surveys", icon: "message-square" },
    ],
    widgets: [{ key: "review_progress", label: "Review cycle progress", requires: { resource: "reviews", action: "view" } }],
    notifications: [
      { key: "review.opened", label: "Review cycle opened", description: "When it's time for your self-review.", defaultChannels: ["in_app", "email"] },
      { key: "review.shared", label: "Review shared with you", description: "When your manager shares your review.", defaultChannels: ["in_app", "email"] },
      { key: "survey.opened", label: "New survey", description: "When a survey is open for you.", defaultChannels: ["in_app"] },
    ],
    setup: { title: "First review cycle", description: "Pick when you'd like to run your first review." },
    checklist: [{ key: "performance.cycle", label: "Plan your first review cycle", href: "/app/performance/reviews" }],
    approvalTypes: [],
  },
];

// ---------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------
export const MODULE_MAP: Record<ModuleKey, ModuleDefinition> = Object.fromEntries(
  MODULES.map((m) => [m.key, m]),
) as Record<ModuleKey, ModuleDefinition>;

export const CORE_MODULE_KEYS: ModuleKey[] = MODULES.filter((m) => m.core).map((m) => m.key);
export const OPTIONAL_MODULES: ModuleDefinition[] = MODULES.filter((m) => !m.core);

export function getModule(key: string): ModuleDefinition | undefined {
  return MODULE_MAP[key as ModuleKey];
}

export function isModuleKey(key: string): key is ModuleKey {
  return key in MODULE_MAP;
}

/** All permission resources across every module (for the permission matrix). */
export function allResources() {
  return MODULES.flatMap((m) => m.resources.map((r) => ({ ...r, moduleKey: m.key, moduleName: m.name })));
}

/** The module a permission resource belongs to. */
export function moduleForResource(resource: string): ModuleDefinition | undefined {
  return MODULES.find((m) => m.resources.some((r) => r.key === resource));
}
