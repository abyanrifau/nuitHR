import { appConfig } from "@/config/app.config";
import { MODULE_MAP } from "./registry";
import type { ModuleKey } from "./types";

type ToolPriceKey = keyof typeof appConfig.pricing.tools;

export interface PriceLine {
  key: "foundation" | ToolPriceKey;
  label: string;
  base: number;
  perPerson: number;
  total: number;
}

export interface PriceEstimate {
  currency: string;
  people: number;
  lines: PriceLine[];
  monthlyTotal: number;
}

function clampPeople(n: number) {
  return Math.max(1, Math.floor(Number.isFinite(n) ? n : 1));
}

/** Monthly estimate: foundation base fee + each selected add-on tool. */
export function estimateMonthlyPrice(selected: Iterable<ModuleKey>, people: number): PriceEstimate {
  const count = clampPeople(people);
  const { foundation, tools } = appConfig.pricing;
  const lines: PriceLine[] = [
    {
      key: "foundation",
      label: "Foundation",
      base: foundation.base,
      perPerson: foundation.perPerson,
      total: foundation.base + foundation.perPerson * count,
    },
  ];
  const seen = new Set<string>();
  for (const k of selected) {
    if (seen.has(k) || MODULE_MAP[k]?.core || !(k in tools)) continue;
    seen.add(k);
    const p = tools[k as ToolPriceKey];
    lines.push({ key: k as ToolPriceKey, label: MODULE_MAP[k].name, base: p.base, perPerson: p.perPerson, total: p.base + p.perPerson * count });
  }
  return { currency: appConfig.pricing.currency, people: count, lines, monthlyTotal: lines.reduce((s, l) => s + l.total, 0) };
}

/** Price of one add-on tool for a given headcount. */
export function toolPrice(key: ModuleKey, people: number): number {
  const p = appConfig.pricing.tools[key as ToolPriceKey];
  return p ? p.base + p.perPerson * clampPeople(people) : 0;
}

/** Turns the "number of staff" ranges from setup into a number for estimates. */
export function employeeCountFromRange(range: string | null | undefined): number {
  switch (range) {
    case "1-10":
      return 10;
    case "11-25":
      return 25;
    case "26-50":
      return 50;
    case "51-100":
      return 100;
    case "101-250":
      return 250;
    case "251-500":
      return 500;
    case "500+":
      return 750;
    default:
      return 10;
  }
}

export const EMPLOYEE_COUNT_RANGES = ["1-10", "11-25", "26-50", "51-100", "101-250", "251-500", "500+"] as const;
