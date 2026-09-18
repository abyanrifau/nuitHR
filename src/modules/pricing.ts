import { appConfig } from "@/config/app.config";
import { MODULE_MAP } from "./registry";
import type { ModuleKey } from "./types";

type PriceKey = keyof typeof appConfig.pricing.modules;

export interface PriceLine {
  key: PriceKey;
  label: string;
  base: number;
  perEmployee: number;
  total: number;
}

export interface PriceEstimate {
  currency: string;
  employees: number;
  lines: PriceLine[];
  monthlyTotal: number;
}

/** Monthly estimate: core (always) + each selected module = base + perEmployee × employees. */
export function estimateMonthlyPrice(selected: Iterable<ModuleKey>, employees: number): PriceEstimate {
  const count = Math.max(1, Math.floor(Number.isFinite(employees) ? employees : 1));
  const prices = appConfig.pricing.modules;
  const keys = new Set<PriceKey>(["core"]);
  for (const k of selected) {
    if (!MODULE_MAP[k]?.core && k in prices) keys.add(k as PriceKey);
  }
  const lines: PriceLine[] = [...keys].map((key) => {
    const p = prices[key];
    return {
      key,
      label: key === "core" ? "Core platform (always included)" : MODULE_MAP[key as ModuleKey].name,
      base: p.base,
      perEmployee: p.perEmployee,
      total: p.base + p.perEmployee * count,
    };
  });
  return {
    currency: appConfig.pricing.currency,
    employees: count,
    lines,
    monthlyTotal: lines.reduce((sum, l) => sum + l.total, 0),
  };
}

/** Lowest possible monthly price for a module (used for "from X/month"). */
export function startingPrice(key: ModuleKey | "core"): number {
  const p = appConfig.pricing.modules[(MODULE_MAP[key as ModuleKey]?.core ? "core" : key) as PriceKey];
  return p ? p.base + p.perEmployee : 0;
}

/** Turns the employee-count ranges from the wizard into a number for estimates. */
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
