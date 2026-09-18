/**
 * Tool selection rules: dependencies and switching tools on/off. Pure
 * functions, used by setup, Workspace → Tools and the server (which
 * re-checks every change).
 */
import { CORE_MODULE_KEYS, LEGACY_KEYS, MODULE_MAP, MODULES } from "./registry";
import type { ModuleKey } from "./types";

export type Industry = "resort" | "guesthouse" | "hotel" | "restaurant" | "retail" | "office" | "construction" | "manufacturing" | "other";

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

export interface AutoEnabledNote {
  module: ModuleKey;
  because: ModuleKey;
  message: string;
}

/** Every tool that `key` needs, directly or indirectly. */
export function requiredBy(key: ModuleKey, seen = new Set<ModuleKey>()): ModuleKey[] {
  for (const dep of MODULE_MAP[key]?.requires ?? []) {
    if (!seen.has(dep)) {
      seen.add(dep);
      requiredBy(dep, seen);
    }
  }
  return [...seen];
}

/** Every enabled tool that would stop working if `key` were switched off. */
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
  return `${def.name} needs ${needs}${reason}, so ${needs} is on too.`;
}

/** Switches a tool on, plus anything it requires. */
export function enableModule(selected: Iterable<ModuleKey>, key: ModuleKey): { selected: ModuleKey[]; autoEnabled: AutoEnabledNote[] } {
  const sel = new Set(selected);
  const autoEnabled: AutoEnabledNote[] = [];
  sel.add(key);
  for (const dep of requiredBy(key)) {
    if (!sel.has(dep)) {
      sel.add(dep);
      if (!MODULE_MAP[dep].core) autoEnabled.push({ module: dep, because: key, message: friendlyRequirementMessage(dep, key) });
    }
  }
  return { selected: normalizeSelection(sel), autoEnabled };
}

/** What happens if a tool is switched off. Foundation tools can't be. */
export function previewDisable(selected: Iterable<ModuleKey>, key: ModuleKey): { allowed: boolean; alsoDisabled: ModuleKey[]; reason?: string } {
  const def = MODULE_MAP[key];
  if (!def) return { allowed: false, alsoDisabled: [], reason: "Unknown tool" };
  if (def.core) return { allowed: false, alsoDisabled: [], reason: `${def.name} is always included.` };
  return { allowed: true, alsoDisabled: dependentsOf(key, selected) };
}

/** Switches a tool off, together with everything that depends on it. */
export function disableModule(selected: Iterable<ModuleKey>, key: ModuleKey): { selected: ModuleKey[]; alsoDisabled: ModuleKey[] } {
  const preview = previewDisable(selected, key);
  if (!preview.allowed) return { selected: normalizeSelection(selected), alsoDisabled: [] };
  const remove = new Set<ModuleKey>([key, ...preview.alsoDisabled]);
  return { selected: normalizeSelection([...new Set(selected)].filter((k) => !remove.has(k))), alsoDisabled: preview.alsoDisabled };
}

/**
 * Makes any selection valid: maps old keys (transport, expenses → claims),
 * drops unknown keys, always includes the foundation and adds requirements.
 */
export function normalizeSelection(selected: Iterable<string>): ModuleKey[] {
  const sel = new Set<ModuleKey>(CORE_MODULE_KEYS);
  for (const raw of selected) {
    const key = LEGACY_KEYS[raw] ?? raw;
    if (key in MODULE_MAP) {
      sel.add(key as ModuleKey);
      for (const dep of requiredBy(key as ModuleKey)) sel.add(dep);
    }
  }
  return MODULES.map((m) => m.key).filter((k) => sel.has(k));
}

/** Tools that pair well with the current selection but aren't on yet. */
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
