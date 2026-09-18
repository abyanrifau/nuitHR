/**
 * Module selection rules: bundles, dependencies and turning modules
 * on/off. Pure functions, used by the onboarding wizard, Settings →
 * Modules and the server (which re-checks every change).
 */
import { CORE_MODULE_KEYS, MODULE_MAP, MODULES } from "./registry";
import type { ModuleKey } from "./types";

export type Industry =
  | "resort"
  | "guesthouse"
  | "hotel"
  | "restaurant"
  | "retail"
  | "office"
  | "construction"
  | "manufacturing"
  | "other";

export const INDUSTRIES: { value: Industry; label: string }[] = [
  { value: "resort", label: "Resort" },
  { value: "guesthouse", label: "Guesthouse" },
  { value: "hotel", label: "Hotel" },
  { value: "restaurant", label: "Restaurant / café" },
  { value: "retail", label: "Retail" },
  { value: "office", label: "Office / services" },
  { value: "construction", label: "Construction" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "other", label: "Other" },
];

export interface Bundle {
  key: string;
  name: string;
  description: string;
  modules: ModuleKey[];
  /** Industries this bundle is recommended for (shown first). */
  industries: Industry[];
}

export const BUNDLES: Bundle[] = [
  {
    key: "hospitality",
    name: "Resort / guesthouse bundle",
    description: "Shifts, leave, payroll with transport claims, permit tracking and smooth onboarding.",
    modules: ["attendance", "leave", "payroll", "transport", "compliance", "onboarding"],
    industries: ["resort", "guesthouse", "hotel"],
  },
  {
    key: "restaurant",
    name: "Restaurant bundle",
    description: "Clock-ins, leave, payroll and permit tracking for kitchen and floor teams.",
    modules: ["attendance", "leave", "payroll", "compliance"],
    industries: ["restaurant"],
  },
  {
    key: "retail",
    name: "Retail bundle",
    description: "Shift attendance, leave and payroll for shop teams.",
    modules: ["attendance", "leave", "payroll"],
    industries: ["retail"],
  },
  {
    key: "office",
    name: "Office bundle",
    description: "Leave, payroll, hiring, performance reviews and training.",
    modules: ["leave", "payroll", "recruitment", "performance", "learning"],
    industries: ["office"],
  },
  {
    key: "construction",
    name: "Construction bundle",
    description: "Site attendance, leave, payroll, permit tracking and expense claims.",
    modules: ["attendance", "leave", "payroll", "compliance", "expenses"],
    industries: ["construction", "manufacturing"],
  },
  {
    key: "basics",
    name: "Just the basics",
    description: "Employee records, documents, approvals and the staff app. Add more anytime.",
    modules: [],
    industries: ["other"],
  },
];

/** Bundles sorted so the ones recommended for this industry come first. */
export function bundlesForIndustry(industry: Industry | undefined): { bundle: Bundle; recommended: boolean }[] {
  const list = BUNDLES.map((bundle) => ({
    bundle,
    recommended: !!industry && bundle.industries.includes(industry),
  }));
  return [...list.filter((b) => b.recommended), ...list.filter((b) => !b.recommended)];
}

export interface AutoEnabledNote {
  module: ModuleKey;
  because: ModuleKey;
  message: string;
}

/** Every module that `key` needs, directly or indirectly. */
export function requiredBy(key: ModuleKey, seen = new Set<ModuleKey>()): ModuleKey[] {
  for (const dep of MODULE_MAP[key]?.requires ?? []) {
    if (!seen.has(dep)) {
      seen.add(dep);
      requiredBy(dep, seen);
    }
  }
  return [...seen];
}

/** Every enabled module that would stop working if `key` were turned off. */
export function dependentsOf(key: ModuleKey, selected: Iterable<ModuleKey>): ModuleKey[] {
  const sel = new Set(selected);
  const result = new Set<ModuleKey>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of MODULES) {
      if (!sel.has(m.key) || result.has(m.key) || m.key === key) continue;
      if (m.requires.some((dep) => dep === key || result.has(dep))) {
        result.add(m.key);
        changed = true;
      }
    }
  }
  return [...result];
}

function friendlyRequirementMessage(module: ModuleKey, because: ModuleKey): string {
  const needs = MODULE_MAP[module].name;
  const def = MODULE_MAP[because];
  const reason = def.requiresReason ? ` (${def.requiresReason.toLowerCase()})` : "";
  return `${def.name} needs ${needs}${reason}, so we've turned ${needs} on too.`;
}

/** Turns a module on, plus anything it requires. */
export function enableModule(
  selected: Iterable<ModuleKey>,
  key: ModuleKey,
): { selected: ModuleKey[]; autoEnabled: AutoEnabledNote[] } {
  const sel = new Set(selected);
  const autoEnabled: AutoEnabledNote[] = [];
  sel.add(key);
  for (const dep of requiredBy(key)) {
    if (!sel.has(dep)) {
      sel.add(dep);
      if (!MODULE_MAP[dep].core) {
        autoEnabled.push({ module: dep, because: key, message: friendlyRequirementMessage(dep, key) });
      }
    }
  }
  return { selected: normalizeSelection(sel), autoEnabled };
}

/**
 * What happens if a module is turned off. Core modules can't be.
 * Returns the modules that would ALSO be turned off, so the UI can
 * warn before doing it.
 */
export function previewDisable(
  selected: Iterable<ModuleKey>,
  key: ModuleKey,
): { allowed: boolean; alsoDisabled: ModuleKey[]; reason?: string } {
  const def = MODULE_MAP[key];
  if (!def) return { allowed: false, alsoDisabled: [], reason: "Unknown module" };
  if (def.core) return { allowed: false, alsoDisabled: [], reason: `${def.name} is always included.` };
  return { allowed: true, alsoDisabled: dependentsOf(key, selected) };
}

/** Turns a module off, together with everything that depends on it. */
export function disableModule(selected: Iterable<ModuleKey>, key: ModuleKey): { selected: ModuleKey[]; alsoDisabled: ModuleKey[] } {
  const preview = previewDisable(selected, key);
  if (!preview.allowed) return { selected: normalizeSelection(selected), alsoDisabled: [] };
  const remove = new Set<ModuleKey>([key, ...preview.alsoDisabled]);
  const next = [...new Set(selected)].filter((k) => !remove.has(k));
  return { selected: normalizeSelection(next), alsoDisabled: preview.alsoDisabled };
}

/** Selecting a bundle: its modules plus requirements (the user can still adjust). */
export function applyBundle(bundleKey: string): { selected: ModuleKey[]; autoEnabled: AutoEnabledNote[] } {
  const bundle = BUNDLES.find((b) => b.key === bundleKey);
  let selected: ModuleKey[] = [...CORE_MODULE_KEYS];
  const notes: AutoEnabledNote[] = [];
  for (const m of bundle?.modules ?? []) {
    const r = enableModule(selected, m);
    selected = r.selected;
    notes.push(...r.autoEnabled);
  }
  return { selected, autoEnabled: notes };
}

/**
 * Makes any selection valid: removes unknown keys, always includes core
 * modules and adds every required module. Returns a stable order.
 */
export function normalizeSelection(selected: Iterable<string>): ModuleKey[] {
  const sel = new Set<ModuleKey>(CORE_MODULE_KEYS);
  for (const key of selected) {
    if (key in MODULE_MAP) {
      sel.add(key as ModuleKey);
      for (const dep of requiredBy(key as ModuleKey)) sel.add(dep);
    }
  }
  return MODULES.map((m) => m.key).filter((k) => sel.has(k));
}

/** Modules that pair well with the current selection but aren't on yet. */
export function recommendationsFor(selected: Iterable<ModuleKey>): { module: ModuleKey; suggestedBy: ModuleKey }[] {
  const sel = new Set(selected);
  const out: { module: ModuleKey; suggestedBy: ModuleKey }[] = [];
  for (const key of sel) {
    for (const rec of MODULE_MAP[key]?.recommends ?? []) {
      if (!sel.has(rec) && !out.some((o) => o.module === rec)) out.push({ module: rec, suggestedBy: key });
    }
  }
  return out;
}
