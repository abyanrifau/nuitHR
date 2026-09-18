/**
 * Pre-filled settings for each tool (applied when a tool is switched on,
 * and editable in Workspace → Tools). They
 * come from src/config/app.config.ts, so changing a default rate there
 * changes it here too. Users can edit everything before saving.
 */
import { z } from "zod";
import { appConfig } from "@/config/app.config";
import { holidaySeeds } from "./data/holidays-mv";
import type { Industry } from "./selection";
import type { ModuleKey } from "./types";

/** Modules that have a quick-setup screen, in the order they are shown. */
export const SETUP_ORDER: ModuleKey[] = ["employees", "leave", "attendance", "payroll", "performance"];

// ---------------------------------------------------------------------
// Departments & positions
// ---------------------------------------------------------------------
const DEPARTMENTS_BY_INDUSTRY: Record<Industry, { name: string; positions: string[] }[]> = {
  resort: [
    { name: "Front Office", positions: ["Front Office Manager", "Receptionist", "Guest Relations Officer"] },
    { name: "Housekeeping", positions: ["Executive Housekeeper", "Room Attendant", "Laundry Attendant"] },
    { name: "Food & Beverage", positions: ["F&B Manager", "Chef", "Cook", "Waiter", "Bartender"] },
    { name: "Engineering", positions: ["Chief Engineer", "Technician", "Boat Captain"] },
    { name: "Administration", positions: ["General Manager", "HR Officer", "Accountant"] },
  ],
  guesthouse: [
    { name: "Front Office", positions: ["Guesthouse Manager", "Receptionist"] },
    { name: "Housekeeping", positions: ["Room Attendant"] },
    { name: "Food & Beverage", positions: ["Cook", "Waiter"] },
    { name: "Excursions", positions: ["Excursion Guide", "Boat Captain"] },
  ],
  hotel: [
    { name: "Front Office", positions: ["Front Office Manager", "Receptionist", "Bell Attendant"] },
    { name: "Housekeeping", positions: ["Executive Housekeeper", "Room Attendant"] },
    { name: "Food & Beverage", positions: ["Chef", "Cook", "Waiter"] },
    { name: "Administration", positions: ["General Manager", "Accountant"] },
  ],
  restaurant: [
    { name: "Kitchen", positions: ["Head Chef", "Cook", "Kitchen Helper", "Dishwasher"] },
    { name: "Service", positions: ["Restaurant Manager", "Waiter", "Cashier", "Barista"] },
  ],
  retail: [
    { name: "Store", positions: ["Store Manager", "Sales Assistant", "Cashier"] },
    { name: "Warehouse", positions: ["Storekeeper", "Delivery Driver"] },
  ],
  office: [
    { name: "Management", positions: ["Managing Director", "Office Manager"] },
    { name: "Finance", positions: ["Accountant", "Finance Officer"] },
    { name: "Operations", positions: ["Operations Officer", "Administrative Assistant"] },
  ],
  construction: [
    { name: "Site Operations", positions: ["Site Engineer", "Foreman", "Mason", "Carpenter", "Labourer"] },
    { name: "Plant & Equipment", positions: ["Machine Operator", "Driver"] },
    { name: "Office", positions: ["Project Manager", "Quantity Surveyor", "Accountant"] },
  ],
  manufacturing: [
    { name: "Production", positions: ["Production Supervisor", "Machine Operator", "Worker"] },
    { name: "Quality", positions: ["Quality Inspector"] },
    { name: "Office", positions: ["Manager", "Accountant"] },
  ],
  other: [
    { name: "Management", positions: ["Manager"] },
    { name: "Operations", positions: ["Staff"] },
  ],
};

export const employeesSetupSchema = z.object({
  departments: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Enter a department name.").max(80),
        positions: z.array(z.string().trim().min(1).max(80)).max(50),
      }),
    )
    .min(1, "Add at least one department.")
    .max(100),
});

// ---------------------------------------------------------------------
// Leave
// ---------------------------------------------------------------------
export const leaveSetupSchema = z.object({
  leave_types: z
    .array(
      z.object({
        code: z
          .string()
          .trim()
          .min(1)
          .max(6)
          .regex(/^[A-Za-z0-9]+$/, "Letters and numbers only."),
        name: z.string().trim().min(1, "Enter a name.").max(60),
        days: z.coerce.number().min(0, "Can't be negative.").max(366),
        paid: z.boolean(),
        accrual: z.enum(["upfront", "monthly", "yearly", "none"]),
        carry_forward: z.coerce.number().min(0).max(366),
        gender: z.enum(["any", "female", "male"]),
        requires_document: z.boolean(),
      }),
    )
    .min(1, "Keep at least one leave type."),
  holidays: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().min(1).max(100) })),
});

// ---------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------
const time = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM, e.g. 08:00.");
export const attendanceSetupSchema = z.object({
  shifts: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Enter a shift name.").max(40),
        start: time,
        end: time,
        break_minutes: z.coerce.number().int().min(0).max(240),
      }),
    )
    .min(1, "Add at least one shift."),
  policy: z.object({
    grace_minutes: z.coerce.number().int().min(0).max(120),
    half_day_min_hours: z.coerce.number().min(0).max(12),
    full_day_hours: z.coerce.number().min(1).max(24),
    overtime_enabled: z.boolean(),
    overtime_after_minutes: z.coerce.number().int().min(0).max(240),
    overtime_rate_weekday: z.coerce.number().min(1).max(5),
    overtime_rate_rest_day: z.coerce.number().min(1).max(5),
    overtime_rate_holiday: z.coerce.number().min(1).max(5),
    require_gps: z.boolean(),
    require_selfie: z.boolean(),
  }),
});

// ---------------------------------------------------------------------
// Payroll
// ---------------------------------------------------------------------
export const payrollSetupSchema = z.object({
  schedule: z.object({
    frequency: z.enum(["monthly", "semi_monthly", "weekly"]),
    pay_day: z.coerce.number().int().min(1).max(31),
    period_start_day: z.coerce.number().int().min(1).max(28),
  }),
  pension: z.object({
    name: z.string().trim().min(1).max(80),
    employee_rate: z.coerce.number().min(0).max(100),
    employer_rate: z.coerce.number().min(0).max(100),
    applies_to: z.enum(["all", "locals", "expatriates"]),
    note: z.string().optional(),
  }),
  tax: z.object({
    name: z.string().trim().min(1).max(80),
    basis: z.enum(["monthly", "annual"]),
    note: z.string().optional(),
    brackets: z
      .array(z.object({ lower: z.coerce.number().min(0), upper: z.coerce.number().positive().nullable(), rate: z.coerce.number().min(0).max(100) }))
      .min(1, "Add at least one tax bracket."),
  }),
  components: z.array(
    z.object({
      code: z.string().trim().min(1).max(12),
      name: z.string().trim().min(1).max(60),
      kind: z.enum(["earning", "deduction"]),
      category: z.string(),
      taxable: z.boolean(),
      pensionable: z.boolean(),
    }),
  ),
});

export const performanceSetupSchema = z.object({
  cycle: z
    .object({
      name: z.string().trim().min(1, "Give the review a name.").max(80),
      period_type: z.enum(["quarterly", "half_yearly", "annual"]),
      period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      self_review_due: z.string().optional(),
      manager_review_due: z.string().optional(),
    })
    .refine((c) => c.period_end >= c.period_start, { path: ["period_end"], message: "The end must be after the start." }),
});

export const SETUP_SCHEMAS = {
  employees: employeesSetupSchema,
  leave: leaveSetupSchema,
  attendance: attendanceSetupSchema,
  payroll: payrollSetupSchema,
  performance: performanceSetupSchema,
} as const;

export type SetupModule = keyof typeof SETUP_SCHEMAS;
export type SetupConfig<M extends SetupModule> = z.infer<(typeof SETUP_SCHEMAS)[M]>;

export function isSetupModule(key: string): key is SetupModule {
  return key in SETUP_SCHEMAS;
}

/** Default answers for a module's quick-setup screen. */
export function defaultSetup<M extends SetupModule>(module: M, ctx: { industry: Industry; country: string; today?: Date }): SetupConfig<M> {
  const today = ctx.today ?? new Date();
  const r = appConfig.rates;
  const defaults: { [K in SetupModule]: SetupConfig<K> } = {
    employees: { departments: DEPARTMENTS_BY_INDUSTRY[ctx.industry] ?? DEPARTMENTS_BY_INDUSTRY.other },
    leave: {
      leave_types: r.leave.map((l) => ({
        code: l.code,
        name: l.name,
        days: l.days,
        paid: l.paid,
        accrual: l.accrual,
        carry_forward: l.carryForward,
        gender: l.gender,
        requires_document: l.requiresDocument,
      })),
      holidays: holidaySeeds(ctx.country, today),
    },
    attendance: {
      shifts: [
        { name: "Morning", start: "08:00", end: "17:00", break_minutes: 60 },
        { name: "Evening", start: "15:00", end: "23:00", break_minutes: 30 },
        { name: "Night", start: "23:00", end: "07:00", break_minutes: 30 },
      ],
      policy: {
        grace_minutes: r.attendance.graceMinutes,
        half_day_min_hours: r.attendance.halfDayMinHours,
        full_day_hours: appConfig.defaults.standardHoursPerDay,
        overtime_enabled: true,
        overtime_after_minutes: 30,
        overtime_rate_weekday: r.overtime.weekday,
        overtime_rate_rest_day: r.overtime.restDay,
        overtime_rate_holiday: r.overtime.publicHoliday,
        require_gps: false,
        require_selfie: false,
      },
    },
    payroll: {
      schedule: { frequency: "monthly", pay_day: 28, period_start_day: 1 },
      pension: {
        name: r.pension.name,
        employee_rate: r.pension.employeeRate,
        employer_rate: r.pension.employerRate,
        applies_to: r.pension.appliesTo,
        note: r.pension.note,
      },
      tax: {
        name: r.incomeTax.name,
        basis: r.incomeTax.basis,
        note: r.incomeTax.note,
        brackets: r.incomeTax.brackets.map((b) => ({ lower: b.lower, upper: b.upper, rate: b.rate })),
      },
      components: [
        { code: "SC", name: "Service charge", kind: "earning", category: "service_charge", taxable: true, pensionable: false },
        { code: "FOOD", name: "Food allowance", kind: "earning", category: "allowance", taxable: true, pensionable: false },
        { code: "ACCOM", name: "Accommodation allowance", kind: "earning", category: "allowance", taxable: true, pensionable: false },
        { code: "PHONE", name: "Phone allowance", kind: "earning", category: "allowance", taxable: true, pensionable: false },
        { code: "ISLAND", name: "Island allowance", kind: "earning", category: "allowance", taxable: true, pensionable: false },
        { code: "ADV", name: "Salary advance", kind: "deduction", category: "advance", taxable: false, pensionable: false },
      ],
    },
    performance: {
      cycle: {
        name: `${today.getFullYear()} annual review`,
        period_type: "annual",
        period_start: `${today.getFullYear()}-01-01`,
        period_end: `${today.getFullYear()}-12-31`,
        self_review_due: `${today.getFullYear()}-12-10`,
        manager_review_due: `${today.getFullYear()}-12-20`,
      },
    },
  };
  return defaults[module] as SetupConfig<M>;
}
