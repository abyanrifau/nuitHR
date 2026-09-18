/**
 * Works out what a person can see, from the company's switched-on tools
 * and the person's role. The sidebar, "Jump to", Home, the staff app and
 * notification settings all use these helpers, so everything adapts when
 * tools are switched on or off.
 *
 * These checks decide what to SHOW. The database (Row Level Security)
 * separately decides what data can actually be read or changed.
 */
import { MODULES, STAGES } from "./registry";
import { isRouteAvailable } from "./routes";
import type {
  ModuleDefinition,
  ModuleKey,
  NavItem,
  NotificationEvent,
  PermissionAction,
  PermissionScope,
  PortalItem,
  ToolStage,
  WidgetDefinition,
  WidgetSection,
} from "./types";

export interface AccessContext {
  isOwner: boolean;
  modules: ModuleKey[];
  permissions: { resource: string; action: PermissionAction; scope: PermissionScope }[];
}

const RANK = { own: 1, team: 2, all: 3 } as const;

export function scopeFor(ctx: AccessContext, resource: string, action: PermissionAction): PermissionScope | null {
  if (ctx.isOwner) return "all";
  let best: PermissionScope | null = null;
  for (const p of ctx.permissions) {
    if (p.resource === resource && p.action === action && (!best || RANK[p.scope] > RANK[best])) best = p.scope;
  }
  return best;
}

export function can(ctx: AccessContext, resource: string, action: PermissionAction, scope?: PermissionScope): boolean {
  const s = scopeFor(ctx, resource, action);
  if (!s) return false;
  return !scope || RANK[s] >= RANK[scope];
}

export function isEnabled(ctx: Pick<AccessContext, "modules">, key: ModuleKey): boolean {
  return ctx.modules.includes(key);
}

export function enabledModules(ctx: Pick<AccessContext, "modules">): ModuleDefinition[] {
  return MODULES.filter((m) => m.core || ctx.modules.includes(m.key));
}

function allowed(ctx: AccessContext, item: { requires?: { resource: string; action: PermissionAction } }) {
  return !item.requires || can(ctx, item.requires.resource, item.requires.action);
}

export type NavItemWithTool = NavItem & { moduleKey: ModuleKey };

export interface NavSection {
  key: "home" | ToolStage | "workspace";
  label: string | null;
  items: NavItemWithTool[];
}

/**
 * Sidebar: Home and Requests first, then Hire / Run / Pay / Grow (only
 * switched-on tools), then Workspace at the bottom. Pass `onlyBuilt` to
 * hide pages that don't exist yet.
 */
export function adminNavigation(ctx: AccessContext, opts: { onlyBuilt?: boolean } = {}): NavSection[] {
  const mods = enabledModules(ctx);
  const items = (keys: ModuleKey[]) =>
    mods
      .filter((m) => keys.includes(m.key))
      .flatMap((m) => m.nav.filter((n) => allowed(ctx, n)).map((n) => ({ ...n, moduleKey: m.key })))
      .filter((n) => !opts.onlyBuilt || isRouteAvailable(n.href));

  const top: NavSection = {
    key: "home",
    label: null,
    items: [...items(["dashboard"]), ...items(["approvals"]), ...items(["employees", "documents", "portal"])],
  };
  const stages: NavSection[] = STAGES.filter((s) => s.key !== "foundation").map((s) => ({
    key: s.key,
    label: s.label,
    items: items(mods.filter((m) => m.category === s.key).map((m) => m.key)),
  }));
  const workspace: NavSection = { key: "workspace", label: "Workspace", items: items(["system"]) };
  return [top, ...stages, workspace].filter((s) => s.items.length > 0);
}

/** Staff app items (bottom tabs Home, Time, Requests, Pay, Me, plus extras). */
export function portalNavigation(ctx: AccessContext): (PortalItem & { moduleKey: ModuleKey })[] {
  return enabledModules(ctx).flatMap((m) => m.portal.filter((p) => allowed(ctx, p)).map((p) => ({ ...p, moduleKey: m.key })));
}

const TAB_ORDER = ["/staff", "/staff/time", "/staff/requests", "/staff/pay", "/staff/me"];

/** The staff app's bottom tabs, in order. */
export function portalTabs(ctx: AccessContext) {
  return portalNavigation(ctx)
    .filter((p) => p.tab)
    .sort((a, b) => TAB_ORDER.indexOf(a.href) - TAB_ORDER.indexOf(b.href));
}

export function dashboardWidgets(ctx: AccessContext, section?: WidgetSection): (WidgetDefinition & { moduleKey: ModuleKey })[] {
  return enabledModules(ctx)
    .flatMap((m) => m.widgets.filter((w) => allowed(ctx, w)).map((w) => ({ ...w, moduleKey: m.key })))
    .filter((w) => !section || w.section === section);
}

export function notificationEvents(ctx: Pick<AccessContext, "modules">): (NotificationEvent & { moduleKey: ModuleKey })[] {
  return enabledModules(ctx).flatMap((m) => m.notifications.map((n) => ({ ...n, moduleKey: m.key })));
}

/** Which tool a URL belongs to (used to block visits to switched-off tools). */
export function moduleForPath(pathname: string): ModuleDefinition | undefined {
  let best: { mod: ModuleDefinition; len: number } | undefined;
  for (const m of MODULES) {
    for (const href of [...m.nav.map((n) => n.href), ...m.portal.map((p) => p.href)]) {
      if (href === "/app" || href === "/staff" || m.core) continue;
      if ((pathname === href || pathname.startsWith(href + "/")) && (!best || href.length > best.len)) best = { mod: m, len: href.length };
    }
  }
  return best?.mod;
}
