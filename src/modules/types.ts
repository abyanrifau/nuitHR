/**
 * "Tools" in the product. Internally they are still called modules and
 * keep their original keys (so existing data and settings stay put);
 * only the names people see changed.
 */

/** foundation = always included; hire / run / pay / grow = the four stages. */
export type ToolStage = "foundation" | "hire" | "run" | "pay" | "grow";
/** @deprecated kept as an alias while older code is updated */
export type ModuleCategory = ToolStage;

export type ModuleKey =
  // foundation (always on)
  | "employees" // People directory
  | "approvals" // Requests
  | "documents" // Letters & files
  | "roles" // Access & roles
  | "portal" // Staff app
  // built-in features (always on, not listed as tools)
  | "dashboard" // Home
  | "notifications"
  | "system" // security, backups, data export, workspace settings
  // selectable tools
  | "recruitment" // Hiring
  | "onboarding" // Joiners & leavers
  | "attendance" // Time & shifts
  | "leave" // Time off
  | "compliance" // Permits & renewals
  | "payroll" // Payroll
  | "claims" // Claims (transport is a claim type)
  | "learning" // Training
  | "performance"; // Reviews & goals

/** Permission actions, mirrored by the database check constraint on role_permissions.action. */
export type PermissionAction = "view" | "create" | "edit" | "approve" | "delete" | "export";

/** all = every record; team = own + reports; own = only the person's own records. */
export type PermissionScope = "all" | "team" | "own";

/** Icon names map to components in src/modules/icons.tsx. */
export type IconName =
  | "users"
  | "inbox"
  | "file-text"
  | "shield"
  | "layout-dashboard"
  | "bell"
  | "smartphone"
  | "settings"
  | "clock"
  | "calendar"
  | "briefcase"
  | "clipboard-check"
  | "badge-alert"
  | "wallet"
  | "bus"
  | "receipt"
  | "graduation-cap"
  | "target"
  | "building"
  | "megaphone"
  | "calendar-range"
  | "list-checks"
  | "bar-chart"
  | "file-signature"
  | "user-plus"
  | "folder"
  | "book-open"
  | "message-square"
  | "home"
  | "life-buoy"
  | "network"
  | "user"
  | "sliders"
  | "download"
  | "history";

export interface ResourceDefinition {
  /** Resource key used in role_permissions.resource and in the database policies. */
  key: string;
  label: string;
  description: string;
  /** Actions that make sense for this resource (shown as columns in the permission matrix). */
  actions: PermissionAction[];
  /** true when records belong to one person, so "team" and "own" scopes apply. */
  employeeScoped: boolean;
  /** Sensitive resources can only be granted by the Owner (salary & payroll). */
  ownerGrantOnly?: boolean;
}

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Shown only if the user has this permission (any scope, unless a minimum scope is given). */
  requires?: { resource: string; action: PermissionAction; scope?: PermissionScope };
  /** Shown only to the company's owners. */
  ownerOnly?: boolean;
}

export interface PortalItem {
  label: string;
  href: string;
  icon: IconName;
  /** One of the staff app's bottom tabs (Home, Time, Requests, Pay, Me). */
  tab?: boolean;
  /** Big button on the staff app home screen. */
  homeAction?: boolean;
  requires?: { resource: string; action: PermissionAction };
}

export type WidgetSection = "attention" | "today" | "month";

export interface WidgetDefinition {
  key: string;
  label: string;
  /** Home is organised into: Needs your attention, Today, This month. */
  section: WidgetSection;
  requires?: { resource: string; action: PermissionAction };
}

export interface NotificationEvent {
  key: string;
  label: string;
  description: string;
  defaultChannels: Array<"in_app" | "email">;
}

export interface ChecklistItem {
  key: string;
  label: string;
  href: string;
}

export interface ModuleDefinition {
  key: ModuleKey;
  /** Name people see (e.g. "Time off"). */
  name: string;
  category: ToolStage;
  /** Always on and can't be switched off. */
  core: boolean;
  /** Built-in features (Home, notifications, security) that aren't listed as tools. */
  builtIn?: boolean;
  icon: IconName;
  /** One plain-language line. */
  tagline: string;
  /** 3–4 short points for the tool toggle cards. */
  features: string[];
  /** 4–6 outcomes for the product page ("Know who's late before the shift starts"). */
  outcomes: string[];
  /** Tools that MUST be on for this one to work (auto-enabled). */
  requires: ModuleKey[];
  /** Tools that work well together (suggested, never forced). */
  recommends: ModuleKey[];
  /** Friendly explanation shown when a requirement is auto-enabled. */
  requiresReason?: string;
  resources: ResourceDefinition[];
  nav: NavItem[];
  portal: PortalItem[];
  widgets: WidgetDefinition[];
  notifications: NotificationEvent[];
  /** Has a settings screen at Workspace → Tools → (tool). */
  setup?: { title: string; description: string };
  /** Setup checklist entries on Home. */
  checklist: ChecklistItem[];
  /** Request types this tool sends to Requests. */
  approvalTypes: string[];
}
