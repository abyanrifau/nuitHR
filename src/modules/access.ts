/**
 * Works out what a user can see, from the business's enabled modules
 * and the user's role permissions. The sidebar, portal tabs, dashboard
 * widgets and notification settings all use these helpers, so the whole
 * app adapts automatically when modules are turned on or off.
 *
 * These checks decide what to SHOW. The database (Row Level Security)
 * independently decides what data can actually be read or changed.
 */
import { MODULE_CATEGORIES, MODULES } from "./registry";
import type {
  ModuleCategory,
  ModuleDefinition,
  ModuleKey,
  NavItem,
  NotificationEvent,
  PermissionAction,
  PermissionScope,
  PortalItem,
  WidgetDefinition,
} from "./types";

export interface AccessContext {
  isOwner: boolean;
  modules: ModuleKey[];
  permissions: { resource: string; action: PermissionAction; scope: PermissionScope }[];
}

export function scopeFor(ctx: AccessContext, resource: string, action: PermissionAction): PermissionScope | null {
  if (ctx.isOwner) return "all";
  const rank = { own: 1, team: 2, all: 3 } as const;
  let best: PermissionScope | null = null;
  for (const p of ctx.permissions) {
    if (p.resource === resource && p.action === action && (!best || rank[p.scope] > rank[best])) best = p.scope;
  }
  return best;
}

export function can(ctx: AccessContext, resource: string, action: PermissionAction, scope?: PermissionScope): boolean {
  const s = scopeFor(ctx, resource, action);
  if (!s) return false;
  if (!scope) return true;
  const rank = { own: 1, team: 2, all: 3 } as const;
  return rank[s] >= rank[scope];
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

export interface NavGroup {
  category: ModuleCategory;
  label: string;
  items: (NavItem & { moduleKey: ModuleKey })[];
}

/** Admin sidebar, grouped by module category. */
export function adminNavigation(ctx: AccessContext): NavGroup[] {
  const mods = enabledModules(ctx);
  return MODULE_CATEGORIES.map((cat) => ({
    category: cat.key,
    label: cat.label,
    items: mods
      .filter((m) => m.category === cat.key)
      .flatMap((m) => m.nav.filter((n) => allowed(ctx, n)).map((n) => ({ ...n, moduleKey: m.key }))),
  })).filter((g) => g.items.length > 0);
}

/** Staff portal items (tabs, home buttons, "More" menu). */
export function portalNavigation(ctx: AccessContext): (PortalItem & { moduleKey: ModuleKey })[] {
  return enabledModules(ctx).flatMap((m) =>
    m.portal.filter((p) => allowed(ctx, p)).map((p) => ({ ...p, moduleKey: m.key })),
  );
}

export function dashboardWidgets(ctx: AccessContext): (WidgetDefinition & { moduleKey: ModuleKey })[] {
  return enabledModules(ctx).flatMap((m) =>
    m.widgets.filter((w) => allowed(ctx, w)).map((w) => ({ ...w, moduleKey: m.key })),
  );
}

export function notificationEvents(ctx: Pick<AccessContext, "modules">): (NotificationEvent & { moduleKey: ModuleKey })[] {
  return enabledModules(ctx).flatMap((m) => m.notifications.map((n) => ({ ...n, moduleKey: m.key })));
}

/** Whether a URL belongs to a module that is switched off (used to block direct visits). */
export function moduleForPath(pathname: string): ModuleDefinition | undefined {
  let best: { mod: ModuleDefinition; len: number } | undefined;
  for (const m of MODULES) {
    for (const href of [...m.nav.map((n) => n.href), ...m.portal.map((p) => p.href)]) {
      if (href === "/app" || href === "/portal") continue;
      if ((pathname === href || pathname.startsWith(href + "/")) && (!best || href.length > best.len)) {
        best = { mod: m, len: href.length };
      }
    }
  }
  return best?.mod;
}
