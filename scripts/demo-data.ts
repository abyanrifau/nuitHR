/**
 * SAMPLE COMPANY for demos.
 *
 *   npm run demo:create -- you@example.com
 *   npm run demo:remove -- you@example.com
 *
 * "create" adds a company called Coral Bay Resort to an existing Harbor
 * account (yours) and fills every tool with realistic sample data: people,
 * shifts and clock-ins, time off, a finished payroll, claims, hiring,
 * joiner checklists, permits, a course, a review round, goals and a survey.
 * You then see it in the company switcher and can show Harbor to anyone.
 *
 * "remove" deletes that sample company again (only companies this script
 * made, which are marked with the registration number below).
 *
 * Needs the keys in .env.local. Signs in as the account owner with a
 * one-time link made by the secret key; no email is sent.
 */
import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { defaultRolesPayload } from "../src/modules/roles";
import { CORE_MODULE_KEYS } from "../src/modules/registry";
import { TEMPLATES } from "../src/lib/payroll/pay-items";

const MARKER = "SAMPLE-DATA";
const NAME = "Coral Bay Resort";
const TZ = "Indian/Maldives";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET = env.SUPABASE_SECRET_KEY;
const PUBLIC_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!URL_ || !SECRET || !PUBLIC_KEY) {
  console.error("The Supabase keys aren't in .env.local. See the README, section Keys.");
  process.exit(1);
}
const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------
// The database isn't typed in this script, so results come back loosely typed.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function must(label: string, r: { data: any; error: { message: string } | null }): any {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data;
}
type Row = { id: string; name: string; code: string; key: string; title: string };
/** Like must(), for results that are a list of rows. */
function rows(label: string, r: { data: unknown; error: { message: string } | null }): Row[] {
  return must(label, r) as Row[];
}
const todayMv = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
function day(offset: number, from = todayMv) {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
/** A Maldives local time on a day, as a UTC timestamp (Maldives is UTC+5, no daylight saving). */
function at(date: string, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m - 5 * 60);
  return d.toISOString();
}
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

async function signInAs(email: string): Promise<{ client: SupabaseClient; userId: string }> {
  const link = must("Make sign-in link", await admin.auth.admin.generateLink({ type: "magiclink", email }));
  const client = createClient(URL_, PUBLIC_KEY, { auth: { persistSession: false } });
  must("Sign in", await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" }));
  return { client, userId: link.user.id };
}

// ---------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------
async function remove(email: string) {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) throw new Error(`No Harbor account with the email ${email}.`);
  const userId = link.data.user.id;
  const { data: list } = await admin.from("businesses").select("id, name").eq("registration_no", MARKER).eq("created_by", userId);
  if (!list?.length) return console.log("There's no sample company in that account.");
  for (const b of list) {
    // Company files, and profile pictures added for its people.
    for (const bucket of ["tenant-files", "avatars"]) {
      const files: string[] = [];
      const walk = async (prefix: string) => {
        const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
        for (const o of data ?? []) {
          const path = `${prefix}/${o.name}`;
          if (o.id) files.push(path);
          else await walk(path);
        }
      };
      await walk(b.id);
      if (files.length) await admin.storage.from(bucket).remove(files);
    }
    must("Delete company", await admin.from("businesses").delete().eq("id", b.id));
    console.log(`Removed ${b.name}.`);
  }
}

// ---------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------
async function create(email: string) {
  const { client: owner, userId } = await signInAs(email);
  const { data: existing } = await admin.from("businesses").select("id").eq("registration_no", MARKER).eq("created_by", userId);
  if (existing?.length) {
    console.log("That account already has the sample company. Run demo:remove first to start fresh.");
    return;
  }

  console.log("Creating the company…");
  const bid = must(
    "Create company",
    await owner.rpc("create_business", {
      p_business: {
        name: NAME,
        industry: "resort",
        country: "MV",
        currency: "MVR",
        timezone: TZ,
        date_format: "DD/MM/YYYY",
        employee_count_range: "11-25",
        trial_days: 30,
      },
      p_roles: defaultRolesPayload(),
      p_modules: CORE_MODULE_KEYS,
    }),
  ) as string;
  must(
    "Switch on tools",
    await owner.rpc("set_business_modules", {
      p_business: bid,
      p_enabled: [...CORE_MODULE_KEYS, "recruitment", "onboarding", "attendance", "leave", "compliance", "payroll", "claims", "learning", "performance"],
    }),
  );
  must(
    "Company details",
    await admin
      .from("businesses")
      .update({
        onboarding_completed_at: new Date().toISOString(),
        registration_no: MARKER,
        address: "Coral Bay Island, Baa Atoll, Maldives",
        phone: "+960 660 0000",
        email: "hr@coralbay.example",
        signatory_name: "Aishath Rasheed",
        signatory_title: "HR Manager",
        careers_page_enabled: true,
        careers_intro: "Join a small, friendly team on one of the prettiest islands in Baa Atoll.",
      })
      .eq("id", bid),
  );

  // Places and teams ---------------------------------------------------
  console.log("Adding places, teams and people…");
  const [male, island] = rows(
    "Locations",
    await admin
      .from("branches")
      .insert([
        { business_id: bid, name: "Malé office" },
        { business_id: bid, name: "Coral Bay island" },
      ])
      .select("id"),
  ).map((b) => b.id);
  const deptNames = ["Management", "Front Office", "Food & Beverage", "Kitchen", "Housekeeping"];
  const depts = Object.fromEntries(
    rows("Departments", await admin.from("departments").insert(deptNames.map((name) => ({ business_id: bid, name }))).select("id, name")).map((d) => [d.name, d.id]),
  ) as Record<string, string>;
  const posTitles: [string, string][] = [
    ["General manager", "Management"],
    ["HR manager", "Management"],
    ["Front office manager", "Front Office"],
    ["Receptionist", "Front Office"],
    ["Restaurant manager", "Food & Beverage"],
    ["Waiter", "Food & Beverage"],
    ["Bartender", "Food & Beverage"],
    ["Head chef", "Kitchen"],
    ["Cook", "Kitchen"],
    ["Housekeeping supervisor", "Housekeeping"],
    ["Room attendant", "Housekeeping"],
  ];
  const pos = Object.fromEntries(
    rows(
      "Jobs",
      await admin
        .from("positions")
        .insert(posTitles.map(([title, d]) => ({ business_id: bid, title, department_id: depts[d] })))
        .select("id, title"),
    ).map((p) => [p.title, p.id]),
  ) as Record<string, string>;

  // People -------------------------------------------------------------
  type P = { code: string; first: string; last: string; g: "male" | "female"; nat: string; job: string; dept: string; mgr?: string; branch: "male" | "island"; salary: number; joined: string };
  const people: P[] = [
    { code: "E001", first: "Ibrahim", last: "Naseem", g: "male", nat: "MV", job: "General manager", dept: "Management", branch: "male", salary: 48000, joined: "2019-03-01" },
    { code: "E002", first: "Aishath", last: "Rasheed", g: "female", nat: "MV", job: "HR manager", dept: "Management", mgr: "E001", branch: "male", salary: 30000, joined: "2020-06-15" },
    { code: "E003", first: "Mohamed", last: "Shiyam", g: "male", nat: "MV", job: "Front office manager", dept: "Front Office", mgr: "E001", branch: "island", salary: 26000, joined: "2020-11-01" },
    { code: "E004", first: "Fathimath", last: "Zahira", g: "female", nat: "MV", job: "Receptionist", dept: "Front Office", mgr: "E003", branch: "island", salary: 14500, joined: "2022-02-01" },
    { code: "E005", first: "Ahmed", last: "Rilwan", g: "male", nat: "MV", job: "Receptionist", dept: "Front Office", mgr: "E003", branch: "island", salary: 13500, joined: "2023-05-10" },
    { code: "E006", first: "Rajesh", last: "Kumar", g: "male", nat: "IN", job: "Restaurant manager", dept: "Food & Beverage", mgr: "E001", branch: "island", salary: 24000, joined: "2021-01-20" },
    { code: "E007", first: "Mariyam", last: "Shifna", g: "female", nat: "MV", job: "Waiter", dept: "Food & Beverage", mgr: "E006", branch: "island", salary: 11000, joined: "2023-08-01" },
    { code: "E008", first: "Kasun", last: "Perera", g: "male", nat: "LK", job: "Bartender", dept: "Food & Beverage", mgr: "E006", branch: "island", salary: 12500, joined: "2022-09-15" },
    { code: "E009", first: "Anil", last: "Thomas", g: "male", nat: "IN", job: "Head chef", dept: "Kitchen", mgr: "E001", branch: "island", salary: 32000, joined: "2020-04-01" },
    { code: "E010", first: "Rahim", last: "Uddin", g: "male", nat: "BD", job: "Cook", dept: "Kitchen", mgr: "E009", branch: "island", salary: 10500, joined: "2021-07-01" },
    { code: "E011", first: "Hassan", last: "Ali", g: "male", nat: "BD", job: "Cook", dept: "Kitchen", mgr: "E009", branch: "island", salary: 10000, joined: "2024-01-15" },
    { code: "E012", first: "Aminath", last: "Nisha", g: "female", nat: "MV", job: "Housekeeping supervisor", dept: "Housekeeping", mgr: "E001", branch: "island", salary: 17000, joined: "2021-03-01" },
    { code: "E013", first: "Karim", last: "Hossain", g: "male", nat: "BD", job: "Room attendant", dept: "Housekeeping", mgr: "E012", branch: "island", salary: 9000, joined: "2022-12-01" },
    { code: "E014", first: "Hawwa", last: "Shaheema", g: "female", nat: "MV", job: "Room attendant", dept: "Housekeeping", mgr: "E012", branch: "island", salary: 9500, joined: day(-4) },
  ];
  const emp: Record<string, string> = {};
  for (const p of people) {
    const row = must(
      `Person ${p.code}`,
      await admin
        .from("employees")
        .insert({
          business_id: bid,
          employee_code: p.code,
          first_name: p.first,
          last_name: p.last,
          gender: p.g,
          nationality: p.nat,
          is_expatriate: p.nat !== "MV",
          status: p.joined > day(-90) ? "probation" : "active",
          join_date: p.joined,
          probation_end_date: p.joined > day(-90) ? day(90, p.joined) : null,
          contract_type: "permanent",
          branch_id: p.branch === "male" ? male : island,
          department_id: depts[p.dept],
          position_id: pos[p.job],
          manager_id: p.mgr ? emp[p.mgr] : null,
          phone: `+960 7${String(100000 + Number(p.code.slice(1)) * 7919).slice(-6)}`,
          work_email: `${p.first.toLowerCase()}.${p.last.toLowerCase()}@coralbay.example`,
        })
        .select("id")
        .single(),
    );
    emp[p.code] = row.id;
  }
  // The account owner is the general manager, so the staff app works for them too.
  must("Link owner", await admin.from("business_members").update({ employee_id: emp.E001 }).eq("business_id", bid).eq("user_id", userId));
  for (const [d, head] of [
    ["Management", "E001"],
    ["Front Office", "E003"],
    ["Food & Beverage", "E006"],
    ["Kitchen", "E009"],
    ["Housekeeping", "E012"],
  ]) {
    await admin.from("departments").update({ head_employee_id: emp[head] }).eq("id", depts[d]);
  }
  must(
    "Salaries",
    await admin.from("employee_compensation").insert(people.map((p) => ({ business_id: bid, employee_id: emp[p.code], effective_date: p.joined < "2025-01-01" ? "2025-01-01" : p.joined, basic_salary: p.salary }))),
  );
  must(
    "Bank accounts",
    await admin.from("employee_bank_accounts").insert(
      people.map((p, i) => ({
        business_id: bid,
        employee_id: emp[p.code],
        bank_name: i % 3 === 0 ? "Maldives Islamic Bank" : "Bank of Maldives",
        account_name: `${p.first} ${p.last}`,
        account_number: `7730${String(100000000 + i * 1234567).slice(0, 9)}`,
        is_primary: true,
      })),
    ),
  );

  // Pay settings (starter rates; check them with the Pension Office and MIRA) ----
  const { data: sched } = await admin.from("pay_schedules").select("id").eq("business_id", bid).eq("is_default", true).maybeSingle();
  if (!sched) must("Pay day", await admin.from("pay_schedules").insert({ business_id: bid, name: "Monthly payroll", pay_day: 28, is_default: true }));
  must("Pension", await admin.from("pension_schemes").insert({ business_id: bid, name: "Maldives Retirement Pension Scheme", employee_rate: 7, employer_rate: 7, applies_to: "locals", effective_from: "2020-01-01" }));
  const tax = must("Tax table", await admin.from("tax_tables").insert({ business_id: bid, name: "Income tax", basis: "monthly", effective_from: "2020-01-01" }).select("id").single());
  must(
    "Tax brackets",
    await admin.from("tax_brackets").insert(
      [
        [0, 60000, 0],
        [60000, 100000, 5.5],
        [100000, 150000, 8],
        [150000, 200000, 12],
        [200000, null, 15],
      ].map(([lo, hi, rate], i) => ({ business_id: bid, tax_table_id: tax.id, lower_bound: lo, upper_bound: hi, rate, sort: i + 1 })),
    ),
  );

  // Shifts, roster and clock-ins ---------------------------------------------
  console.log("Adding shifts, clock-ins and time off…");
  const shifts = rows(
    "Shifts",
    await admin
      .from("shifts")
      .insert([
        { business_id: bid, name: "Morning", code: "AM", start_time: "07:00", end_time: "15:00", break_minutes: 60 },
        { business_id: bid, name: "Evening", code: "PM", start_time: "15:00", end_time: "23:00", break_minutes: 60 },
        { business_id: bid, name: "Office", code: "OF", start_time: "08:00", end_time: "16:00", break_minutes: 60 },
      ])
      .select("id, code"),
  );
  const shift = Object.fromEntries(shifts.map((s) => [s.code, s.id])) as Record<string, string>;
  const shiftFor = (p: P, i: number) => (p.branch === "male" ? "OF" : i % 2 ? "PM" : "AM");
  const times: Record<string, [string, string]> = { AM: ["07:00", "15:00"], PM: ["15:00", "23:00"], OF: ["08:00", "16:00"] };
  // Work schedules: the resort works six days with Friday off; the Malé office Sunday to Thursday.
  const scheds = rows(
    "Work schedules",
    await admin
      .from("work_schedules")
      .insert([
        { business_id: bid, name: "Six days, Friday off", working_days: [0, 1, 2, 3, 4, 6], shift_id: shift.AM, is_default: true },
        { business_id: bid, name: "Office, Sunday to Thursday", working_days: [0, 1, 2, 3, 4], shift_id: shift.OF, is_default: false },
      ])
      .select("id, name"),
  );
  const officeSched = scheds.find((s) => s.name.startsWith("Office"))!.id;
  must(
    "Office schedule",
    await admin
      .from("employees")
      .update({ work_schedule_id: officeSched })
      .in(
        "id",
        people.filter((p) => p.branch === "male").map((p) => emp[p.code]),
      ),
  );
  // Rules: overtime needs a manager's approval, rounded down to 15 minutes, up to 40 hours a month.
  const { data: pol } = await admin.from("attendance_policies").select("id").eq("business_id", bid).eq("is_default", true).maybeSingle();
  const rules = { overtime_requires_approval: true, overtime_rounding: "down", overtime_round_to: 15, overtime_monthly_cap_hours: 40, early_leave_minutes: 10, grace_minutes: 10 };
  if (pol) must("Rules", await admin.from("attendance_policies").update(rules).eq("id", pol.id));
  else must("Rules", await admin.from("attendance_policies").insert({ business_id: bid, name: "Standard rules", is_default: true, ...rules }));

  // A public holiday last month, if the company's list has none then.
  const [ty, tm] = todayMv.split("-").map(Number);
  const prevStart = `${tm === 1 ? ty - 1 : ty}-${String(tm === 1 ? 12 : tm - 1).padStart(2, "0")}-01`;
  const { count: hols } = await admin
    .from("public_holidays")
    .select("id", { count: "exact", head: true })
    .eq("business_id", bid)
    .gte("holiday_date", prevStart)
    .lt("holiday_date", `${todayMv.slice(0, 7)}-01`);
  if (!hols) must("Holiday", await admin.from("public_holidays").insert({ business_id: bid, name: "Sample public holiday", holiday_date: `${prevStart.slice(0, 8)}15` }));
  const holidayDays = new Set(
    rows("Holidays", await admin.from("public_holidays").select("id, holiday_date").eq("business_id", bid).gte("holiday_date", prevStart).lte("holiday_date", todayMv)).map(
      (h) => (h as unknown as { holiday_date: string }).holiday_date,
    ),
  );

  // The roster for the last two weeks and the next week (it overrides the schedule for those days).
  const roster = [];
  for (let d = -13; d <= 6; d++) {
    const date = day(d);
    for (const [i, p] of people.entries()) {
      if (date < p.joined) continue;
      const rest = (i + d + 100) % 7 === 0;
      const code = shiftFor(p, i);
      roster.push({ business_id: bid, employee_id: emp[p.code], work_date: date, shift_id: rest ? null : shift[code], is_rest_day: rest, published: true, branch_id: p.branch === "male" ? male : island });
    }
  }
  must("Roster", await admin.from("roster_entries").insert(roster));
  const rosterBy = new Map(roster.map((r) => [`${r.employee_id}|${r.work_date}`, r]));

  // Clock-ins from the start of last month to yesterday, with the usual mix: most days on time, some late,
  // a few half days, early leaves and days missed, and overtime on busy days. Days on time off are left empty.
  const onLeave = new Set<string>();
  for (const [code, s, e] of [
    ["E004", day(-20), day(-16)],
    ["E010", day(-6), day(-5)],
  ] as const)
    for (let d = s; d <= e; d = day(1, d)) onLeave.add(`${emp[code]}|${d}`);
  const attendance = [];
  for (let date = prevStart; date < todayMv; date = day(1, date)) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const [i, p] of people.entries()) {
      if (date < p.joined) continue;
      const id = emp[p.code];
      if (onLeave.has(`${id}|${date}`)) continue;
      const ros = rosterBy.get(`${id}|${date}`);
      const office = p.branch === "male";
      const rest = ros ? ros.is_rest_day : office ? dow === 5 || dow === 6 : dow === 5;
      const code = ros?.shift_id ? (Object.entries(shift).find(([, v]) => v === ros.shift_id)?.[0] ?? shiftFor(p, i)) : office ? "OF" : "AM";
      const [s, e] = times[code];
      const holiday = holidayDays.has(date);
      const r = rand();
      let inMin = -5 + rand() * 4; // minutes after the shift starts
      let outMin = rand() * 10; // minutes after the shift ends
      if (rest || holiday) {
        // Most people are off; a few work part of a rest day, and island staff cover public holidays.
        if (rest && r > 0.04) continue;
        if (holiday && (office || r > 0.5)) continue;
        if (rest) outMin = -240;
      } else if (r < 0.035) continue; // absent without approval
      else if (r < 0.075) outMin = -270; // half day
      else if (r < 0.105) outMin = -95; // left early
      else if (r < 0.2) inMin = 12 + rand() * 28; // late
      if (!rest && !holiday && r >= 0.105 && rand() < 0.18) outMin = 60 + rand() * 120; // stayed on
      const inAt = new Date(new Date(at(date, s)).getTime() + inMin * 60000).toISOString();
      const outAt = new Date(new Date(at(date, e)).getTime() + outMin * 60000).toISOString();
      attendance.push({
        business_id: bid,
        employee_id: id,
        work_date: date,
        shift_id: shift[code],
        branch_id: office ? male : island,
        clock_in_at: inAt,
        clock_out_at: outAt,
        source: "portal",
      });
    }
  }
  // Lateness, hours and overtime are worked out by the database as each day is saved.
  for (let k = 0; k < attendance.length; k += 400) must("Clock-ins", await admin.from("attendance_records").insert(attendance.slice(k, k + 400)));
  // A manager approved last month's overtime; this month's is still waiting.
  const { data: lastOt } = await admin.from("attendance_records").select("id").eq("business_id", bid).gt("overtime_minutes", 0).lt("work_date", `${todayMv.slice(0, 7)}-01`);
  if (lastOt?.length) must("Overtime approval", await owner.rpc("decide_overtime", { p_business: bid, p_records: lastOt.map((x) => x.id), p_decision: "approved" }));
  // Some people are clocked in right now.
  must(
    "Clocked in today",
    await admin.from("attendance_records").insert(
      people
        .filter((p, i) => shiftFor(p, i) !== "PM" && p.joined <= todayMv)
        .slice(0, 8)
        .map((p, i) => ({
          business_id: bid,
          employee_id: emp[p.code],
          work_date: todayMv,
          shift_id: shift[shiftFor(p, people.indexOf(p))],
          branch_id: p.branch === "male" ? male : island,
          clock_in_at: at(todayMv, i % 3 ? "06:56" : "07:08"),
          late_minutes: i % 3 ? 0 : 8,
          status: i % 3 ? "present" : "late",
          source: "portal",
        })),
    ),
  );

  // Time off --------------------------------------------------------------------
  // A new company gets its time off types from the setup questions, so add the usual Maldives ones here.
  const { count: typeCount } = await admin.from("leave_types").select("id", { count: "exact", head: true }).eq("business_id", bid);
  if (!typeCount) {
    must(
      "Time off types",
      await admin.from("leave_types").insert([
        { business_id: bid, name: "Annual leave", code: "AL", entitlement_days: 30, requires_document: false, document_required_after_days: null, sort: 1 },
        { business_id: bid, name: "Sick leave", code: "SL", entitlement_days: 15, requires_document: true, document_required_after_days: 2, sort: 2 },
        { business_id: bid, name: "Family responsibility leave", code: "FR", entitlement_days: 10, requires_document: false, document_required_after_days: null, sort: 3 },
      ]),
    );
  }
  // Rules that show what each type can do: notice and team limits on annual leave, birthday leave,
  // study leave after a year of service, and compassionate leave that HR gives to one person.
  must(
    "More time off types",
    await admin.from("leave_types").upsert(
      [
        { business_id: bid, name: "Birthday leave", code: "BL", color: "#f59e0b", entitlement_mode: "birthday", entitlement_days: 1, allow_half_day: false, sort: 20 },
        { business_id: bid, name: "Study leave", code: "STL", color: "#8b5cf6", entitlement_days: 5, eligible_after_value: 1, eligible_after_unit: "years", allow_during_probation: false, notice_value: 14, sort: 21 },
        { business_id: bid, name: "Compassionate leave", code: "CL", color: "#64748b", entitlement_mode: "granted", entitlement_days: 0, sort: 22 },
      ],
      { onConflict: "business_id,code", ignoreDuplicates: true, defaultToNull: false },
    ),
  );
  await admin.from("leave_types").update({ notice_value: 7, notice_unit: "days", max_off_per_department: 2 }).eq("business_id", bid).eq("code", "AL");
  const types = Object.fromEntries(rows("Leave types", await admin.from("leave_types").select("id, code").eq("business_id", bid)).map((t) => [t.code, t.id])) as Record<string, string>;
  const annual = types.AL ?? Object.values(types)[0];
  const sick = types.SL ?? annual;
  if (types.CL) {
    await admin.from("leave_allocations").insert({ business_id: bid, employee_id: emp.E004, leave_type_id: types.CL, days: 3, reason: "Family bereavement", starts_on: day(-2), expires_on: day(60) });
  }
  await admin.from("company_events").insert([
    { business_id: bid, title: "Staff party", kind: "event", start_date: day(15), end_date: day(15), notes: "Dinner at the resort" },
    { business_id: bid, title: "Year-end stock take", kind: "blackout", start_date: day(40), end_date: day(42) },
  ]);
  for (const [code, type, start, end, reason] of [
    ["E004", annual, day(-20), day(-16), "Family trip to Addu"],
    ["E010", sick, day(-6), day(-4), "Fever"],
    ["E007", annual, day(9), day(13), "Sister's wedding"],
    ["E013", annual, day(20), day(34), "Home leave to Bangladesh"],
  ] as const) {
    const r = await owner.rpc("record_leave", { p_business: bid, p_employee: emp[code], p_type: type, p_start: start, p_end: end, p_reason: reason });
    if (r.error) console.log(`  (skipped one time off entry: ${r.error.message})`);
  }
  await owner.rpc("refresh_leave_balances", { p_business: bid, p_year: Number(todayMv.slice(0, 4)) });

  // Claims --------------------------------------------------------------------
  console.log("Adding claims and last month's payroll…");
  const claimTypes = Object.fromEntries(rows("Claim types", await admin.from("claim_types").select("id, key").eq("business_id", bid)).map((c) => [c.key, c.id])) as Record<string, string>;
  const transport = claimTypes.transport ?? Object.values(claimTypes)[0];
  const other = Object.entries(claimTypes).find(([k]) => k !== "transport")?.[1] ?? transport;
  must(
    "Claims",
    await admin.from("claims").insert([
      { business_id: bid, employee_id: emp.E003, claim_type_id: transport, claim_date: day(-9), amount: 350, currency: "MVR", route: "Malé to Coral Bay (speedboat)", description: null, status: "approved", payout_method: "payroll" },
      { business_id: bid, employee_id: emp.E006, claim_type_id: other, claim_date: day(-3), amount: 780, currency: "MVR", route: null, description: "Supplier lunch meeting in Malé", status: "approved", payout_method: "separate" },
      { business_id: bid, employee_id: emp.E002, claim_type_id: transport, claim_date: day(-2), amount: 120, currency: "MVR", route: "Office to MIRA and back (taxi)", description: null, status: "approved", payout_method: "payroll" },
    ]),
  );

  // Allowances and deductions worked out from attendance, from the templates.
  must(
    "Allowances and deductions",
    await owner.from("pay_components").insert(
      ["attendance_allowance", "late_penalty", "transport_allowance"].map((key, i) => {
        const t = TEMPLATES.find((x) => x.key === key)!;
        return {
          business_id: bid,
          code: key.toUpperCase().slice(0, 16),
          name: t.name,
          description: t.description,
          kind: t.kind,
          method: t.method,
          default_amount: t.amount,
          occurrence_var: t.occurrence_var ?? null,
          occurrence_after: t.occurrence_after ?? 0,
          rules_mode: t.rules?.length ? "builder" : "none",
          rules: t.rules ?? [],
          is_taxable: t.is_taxable,
          is_pensionable: t.is_pensionable,
          applies_to: "all",
          template_key: key,
          sort: 10 + i,
        };
      }),
    ),
  );

  // Last month's payroll, calculated, finalized and paid ----------------------
  const [y, m] = todayMv.split("-").map(Number);
  const lastY = m === 1 ? y - 1 : y;
  const lastM = m === 1 ? 12 : m - 1;
  const start = `${lastY}-${String(lastM).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(lastY, lastM, 0)).toISOString().slice(0, 10);
  const run = await owner.rpc("create_payroll_run", { p_business: bid, p_start: start, p_end: end, p_pay_date: `${end.slice(0, 8)}28` });
  if (run.error) console.log(`  (payroll not created: ${run.error.message})`);
  else {
    const steps = [
      ["calculate_payroll_run", "calculate"],
      ["approve_payroll_run", "approve"],
      ["finalize_payroll_run", "finalize"],
      ["mark_payroll_paid", "mark as paid"],
    ] as const;
    for (const [fn, label] of steps) {
      const r = await owner.rpc(fn, { p_run: run.data });
      if (r.error) {
        console.log(`  (payroll couldn't ${label}: ${r.error.message})`);
        break;
      }
    }
  }

  // Hiring ---------------------------------------------------------------------
  console.log("Adding hiring, checklists, permits, training and reviews…");
  const vac = must(
    "Role",
    await admin
      .from("vacancies")
      .insert({
        business_id: bid,
        title: "Commis chef",
        slug: "commis-chef",
        department_id: depts.Kitchen,
        branch_id: island,
        position_id: pos.Cook,
        employment_type: "permanent",
        description: "Help our head chef run a busy island kitchen serving guests from breakfast to dinner.",
        requirements: "At least one year in a hotel or resort kitchen. Food safety certificate is a plus.",
        salary_min: 9000,
        salary_max: 12000,
        show_salary: true,
        status: "open",
        is_public: true,
        hiring_manager_user_id: userId,
      })
      .select("id")
      .single(),
  );
  for (const [i, [name, stage, rating, source]] of (
    [
      ["Ismail Hameed", "applied", null, "careers_page"],
      ["Sunil Fernando", "screening", 3, "careers_page"],
      ["Aishath Liusha", "interview", 4, "referral"],
      ["Mohamed Ziyad", "offer", 5, "job_board"],
    ] as const
  ).entries()) {
    const c = must(
      "Candidate",
      await admin
        .from("candidates")
        .insert({ business_id: bid, full_name: name, email: `${name.toLowerCase().replace(/ /g, ".")}@mail.example`, phone: `+960 9${1000000 + i * 131}`, source })
        .select("id")
        .single(),
    );
    must("Application", await admin.from("applications").insert({ business_id: bid, vacancy_id: vac.id, candidate_id: c.id, stage, rating, stage_position: i }));
  }
  await admin.from("vacancies").insert({
    business_id: bid,
    title: "Guest relations officer",
    slug: "guest-relations-officer",
    department_id: depts["Front Office"],
    branch_id: island,
    description: "Welcome guests, look after them during their stay and make every departure a warm one.",
    status: "open",
    is_public: true,
  });

  // Permits and passports -------------------------------------------------------
  const ctypes = Object.fromEntries(rows("Permit types", await admin.from("compliance_types").select("id, key").eq("business_id", bid)).map((c) => [c.key, c.id])) as Record<string, string>;
  const expats = people.filter((p) => p.nat !== "MV");
  const expiries = [18, 47, 83, -6, 210, 320, 150];
  must(
    "Permits",
    await admin.from("compliance_items").insert(
      expats.flatMap((p, i) => [
        {
          business_id: bid,
          employee_id: emp[p.code],
          type_id: ctypes.work_permit,
          reference_no: `WP${2400000 + i * 3571}`,
          issued_on: day(expiries[i] - 365),
          expires_on: day(expiries[i]),
          issuing_authority: "Ministry of Homeland Security",
          details: { permit_no: `WP${2400000 + i * 3571}`, employer_on_permit: NAME, deposit_amount: "3000" },
          renewal_status: expiries[i] < 30 ? "in_progress" : "none",
        },
        {
          business_id: bid,
          employee_id: emp[p.code],
          type_id: ctypes.passport,
          reference_no: `${p.nat}${8800000 + i * 7}`,
          issued_on: day(400 + i * 90 - 3650),
          expires_on: day(400 + i * 90),
          issuing_authority: "Department of Immigration",
          details: {},
          renewal_status: "none",
        },
      ]),
    ),
  );

  // Training --------------------------------------------------------------------
  const course = must(
    "Course",
    await owner
      .from("courses")
      .insert({ business_id: bid, title: "Food safety basics", description: "Keeping food safe from delivery to the guest's plate.", category: "Kitchen", estimated_minutes: 12, is_mandatory: true })
      .select("id")
      .single(),
  );
  must(
    "Lessons",
    await owner.from("course_lessons").insert([
      {
        business_id: bid,
        course_id: course.id,
        title: "Keep cold food cold",
        kind: "text",
        sort: 1,
        content: "Fridges must be at 5°C or below, freezers at -18°C or below.\n\nCheck and write down the temperatures at the start of every shift.",
      },
      { business_id: bid, course_id: course.id, title: "Wash your hands", kind: "text", sort: 2, content: "Wash for 20 seconds with soap before handling food, after breaks and after touching raw meat." },
    ]),
  );
  const quiz = must("Quiz", await owner.from("course_lessons").insert({ business_id: bid, course_id: course.id, title: "Quick check", kind: "quiz", sort: 3 }).select("id").single());
  must(
    "Question",
    await owner.rpc("save_quiz_question", {
      p_lesson: quiz.id,
      p_question: null,
      p_text: "How cold should a fridge be?",
      p_kind: "single",
      p_options: [
        { id: "a", text: "5°C or below" },
        { id: "b", text: "10°C" },
        { id: "c", text: "15°C" },
      ],
      p_correct: ["a"],
      p_explanation: "Bacteria grow fast above 5°C.",
    }),
  );
  must("Publish course", await owner.from("courses").update({ status: "published" }).eq("id", course.id));
  for (const d of ["Kitchen", "Food & Beverage"]) {
    must("Assign course", await owner.rpc("assign_course", { p_course: course.id, p_target_type: "department", p_target_id: depts[d], p_due: day(21), p_mandatory: true }));
  }
  // A few people have already finished it.
  for (const code of ["E009", "E010", "E008"]) {
    await admin
      .from("course_enrollments")
      .update({ status: "completed", progress_percent: 100, score: 100, started_at: at(day(-3), "10:00"), completed_at: at(day(-2), "11:30") })
      .eq("course_id", course.id)
      .eq("employee_id", emp[code]);
  }
  await admin.from("course_enrollments").update({ status: "in_progress", progress_percent: 67, started_at: at(day(-1), "09:00") }).eq("course_id", course.id).eq("employee_id", emp.E007);

  // Reviews and goals -------------------------------------------------------------
  const tpl = must("Review questions", await admin.from("review_templates").select("id").eq("business_id", bid).limit(1).single());
  const cycle = must(
    "Review round",
    await owner
      .from("review_cycles")
      .insert({ business_id: bid, name: `${y} mid-year review`, period_type: "half_yearly", period_start: `${y}-01-01`, period_end: `${y}-06-30`, self_review_due: day(10), manager_review_due: day(24), template_id: tpl.id })
      .select("id")
      .single(),
  );
  must("Open review round", await owner.rpc("open_review_cycle", { p_cycle: cycle.id }));
  // A couple of people have sent their self review already.
  const { data: qs } = await admin.from("review_questions").select("id, kind").eq("template_id", tpl.id);
  for (const code of ["E004", "E012"]) {
    const { data: rv } = await admin.from("reviews").select("id").eq("cycle_id", cycle.id).eq("employee_id", emp[code]).single();
    if (!rv || !qs) continue;
    await admin.from("review_responses").insert(
      qs.map((q) => ({
        business_id: bid,
        review_id: rv.id,
        question_id: q.id,
        respondent_type: "self",
        respondent_employee_id: emp[code],
        rating: q.kind === "text" ? null : 4,
        answer: q.kind === "rating" ? null : "Busy season went well; I'd like more training on the new booking system.",
        submitted_at: new Date().toISOString(),
      })),
    );
    await admin.from("reviews").update({ status: "manager_review", self_submitted_at: new Date().toISOString() }).eq("id", rv.id);
  }
  must(
    "Goals",
    await admin.from("goals").insert(
      (
        [
          { level: "company", title: "Guest review score of 4.7 or higher", metric: "Average review score", target_value: 4.7, current_value: 4.5, progress_percent: 60, status: "on_track", due_date: `${y}-12-31` },
          { level: "company", title: "Every staff member finishes food safety training", progress_percent: 25, status: "at_risk", due_date: day(21) },
          { level: "department", department_id: depts.Housekeeping, title: "Rooms ready by 14:00 on 95% of days", metric: "Days rooms ready on time (%)", target_value: 95, current_value: 88, progress_percent: 70, status: "on_track", due_date: `${y}-12-31` },
          { level: "individual", employee_id: emp.E004, title: "Learn the new booking system", progress_percent: 40, status: "on_track", due_date: day(45) },
          { level: "individual", employee_id: emp.E008, title: "Create three new signature drinks", metric: "Drinks on the menu", target_value: 3, current_value: 1, progress_percent: 33, status: "behind", due_date: day(30) },
        ] as Record<string, unknown>[]
      ).map((g) => ({ business_id: bid, department_id: null, employee_id: null, metric: null, target_value: null, current_value: null, ...g })),
    ),
  );

  // Survey, joiner checklist and news ------------------------------------------------
  const survey = must(
    "Survey",
    await owner.from("surveys").insert({ business_id: bid, title: "Staff accommodation check-in", description: "Tell us how staff housing is working for you.", is_anonymous: true, min_responses_to_show: 3 }).select("id").single(),
  );
  must(
    "Survey questions",
    await owner.from("survey_questions").insert([
      { business_id: bid, survey_id: survey.id, question: "How happy are you with your room?", kind: "scale", options: [], is_required: true, sort: 1 },
      { business_id: bid, survey_id: survey.id, question: "What should we improve first?", kind: "single", options: ["Wi-Fi", "Laundry", "Food in the staff canteen", "Quiet hours"], is_required: true, sort: 2 },
      { business_id: bid, survey_id: survey.id, question: "Anything else?", kind: "text", options: [], is_required: false, sort: 3 },
    ]),
  );
  must("Open survey", await owner.from("surveys").update({ status: "open", opens_at: new Date().toISOString() }).eq("id", survey.id));
  must(
    "News",
    await admin.from("announcements").insert([
      {
        business_id: bid,
        title: "Welcome Hawwa to Housekeeping",
        body: "Hawwa joined the housekeeping team this week. Please say hello and help her settle in.",
        is_pinned: false,
        published_at: new Date().toISOString(),
        created_by: userId,
      },
      {
        business_id: bid,
        title: "Staff football on Friday",
        body: "Friday 17:00 at the staff village pitch. Kitchen versus everyone else again.",
        is_pinned: true,
        published_at: new Date().toISOString(),
        created_by: userId,
      },
    ]),
  );

  console.log(`\nDone. ${NAME} is in your account with ${people.length} people and sample data in every tool.`);
  console.log("Sign in, then choose it in the company switcher at the top left.");
  console.log("To remove it later:  npm run demo:remove -- " + email);
}

// ---------------------------------------------------------------------
const [cmd, email] = process.argv.slice(2);
if (!["create", "remove"].includes(cmd ?? "") || !email?.includes("@")) {
  console.log("Use:  npm run demo:create -- you@example.com   or   npm run demo:remove -- you@example.com");
  process.exit(1);
}
(cmd === "create" ? create(email) : remove(email)).catch((e) => {
  console.error(`\nStopped: ${e instanceof Error ? e.message : e}`);
  console.error("If it stopped halfway, run demo:remove and try again.");
  process.exit(1);
});
