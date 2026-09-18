export type ModuleCategory = "core" | "workforce" | "hiring" | "pay" | "development";

export type ModuleKey =
  // core (always on)
  | "employees"
  | "approvals"
  | "documents"
  | "roles"
  | "dashboard"
  | "notifications"
  | "portal"
  | "system"
  // selectable
  | "attendance"
  | "leave"
  | "recruitment"
  | "onboarding"
  | "compliance"
  | "payroll"
  | "transport"
  | "expenses"
  | "learning"
  | "performance";

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
  | "life-buoy";

export interface ResourceDefinition {
  /** Resource key used in role_permissions.resource and in the database policies. */
  key: string;
  label: string;
  description: string;
  /** Actions that make sense for this resource (shown as columns in the permission matrix). */
  actions: PermissionAction[];
  /** true when records belong to one employee, so "team" and "own" scopes apply. */
  employeeScoped: boolean;
  /** Sensitive resources can only be granted by the Owner (salary & payroll). */
  ownerGrantOnly?: boolean;
}

export interface NavItem {
  label: string;
  href: string;
  icon: IconName;
  /** Shown only if the user has this permission (any scope). */
  requires?: { resource: string; action: PermissionAction };
}

export interface PortalItem {
  label: string;
  href: string;
  icon: IconName;
  /** Put on the bottom tab bar (max 4 + "More"). */
  tab?: boolean;
  /** Big button on the portal home screen. */
  homeAction?: boolean;
  requires?: { resource: string; action: PermissionAction };
}

export interface WidgetDefinition {
  key: string;
  label: string;
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
  name: string;
  category: ModuleCategory;
  /** Core modules are always on and cannot be turned off. */
  core: boolean;
  icon: IconName;
  /** One-line description for module cards. */
  tagline: string;
  /** 3–4 key features for module cards. */
  features: string[];
  whoFor: string;
  /** Modules that MUST be on for this one to work (auto-enabled). */
  requires: ModuleKey[];
  /** Modules that work well together (suggested, never forced). */
  recommends: ModuleKey[];
  /** Friendly explanation shown when a requirement is auto-enabled. */
  requiresReason?: string;
  resources: ResourceDefinition[];
  nav: NavItem[];
  portal: PortalItem[];
  widgets: WidgetDefinition[];
  notifications: NotificationEvent[];
  /** Onboarding wizard step 4: quick setup screen for this module. */
  setup?: { title: string; description: string };
  /** Getting-started checklist entries shown on the dashboard. */
  checklist: ChecklistItem[];
  /** Approval request types this module sends to the Approvals Inbox. */
  approvalTypes: string[];
}
