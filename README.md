# Harbor by Nuit Works: HR for businesses in the Maldives

People, time, pay and paperwork for multiple companies (each in its own sealed "company space"). An owner signs up, answers a few questions about how they work, and gets only the tools that fit. Staff use a phone-friendly staff app.

- **Built with:** Next.js 16, TypeScript, Tailwind CSS, Supabase (login, database, file storage), deployed on Vercel.
- **Defaults:** MVR, Indian/Maldives time, DD/MM/YYYY. Every company can change these.
- **Brand name, prices, trial length and default rates:** [`src/config/app.config.ts`](src/config/app.config.ts).
- **Colours, fonts, spacing:** the design tokens at the top of [`src/app/globals.css`](src/app/globals.css).

### Words used in the product
| Say | Meaning |
|---|---|
| **Tools** | The parts of the product a company switches on (internally still called "modules" in the code) |
| **Foundation** | Always included: People directory, Requests, Letters & files, Access & roles, Staff app |
| **Hire / Run / Pay / Grow** | The four stages tools are grouped into |
| **Company space** | One company's private area |
| **Workspace** | Settings area in the app (Workspace → Tools, Company settings) |
| **Jump to** | The command bar (Ctrl+K / Cmd+K) |

## Build progress

| Phase | What | Status |
|---|---|---|
| 1 | Project setup, database for every module, security rules, module registry, sign-in | ✅ Done |
| 2 | Sign-up, question-based setup, Workspace → Tools | ✅ Done (restructured) |
| 3 | Foundation: people, org chart, access & roles, requests, letters & files, company settings, notifications, news, activity log, data export, two-step sign-in, support | ✅ Done |
| 4 | Staff app (installable phone app at `/staff`): news, requests, letters, files, directory, my details | ✅ Done |
| 5 | Time & shifts (clock-in with location check, breaks, time fixes, roster, timesheets), Time off (requests, balances, calendar) | ✅ Done |
| 6 | Payroll (pay runs, pension, tax, allowances, loans, payslips, bank and accounting files) and Claims (receipts, approval, payout) | ✅ Done |
| 7 | Hiring (roles, public careers page, candidate board, interviews, hire), Joiners & leavers (automatic checklists, staff tasks) and Permits & renewals (expiry tracking, daily reminders) | ✅ Done |
| 8 | Training (courses, quizzes, certificates, paid training), Reviews & goals (review rounds, goals) and Surveys (anonymous, with results hidden for small groups) | ✅ Done |
| 9 | Marketing website, pricing calculator, help centre | ✅ Structure and pages done early; content grows with each phase |
| 10 | Sample company for demos, security review and fixes, speed check, link previews, go-live guide | ✅ Built. The go-live steps below need you |

---

## First-time setup (step by step)

You only do this once. Each step says exactly where to click.

### Step 1: Install the tools (already done on this computer)

You need **Node.js** (version 20.9 or newer). Check by opening a terminal and typing `node -v`. If you see `v20` or higher you're fine. If not, download the "LTS" version from nodejs.org and install it with the default options.

Then, inside the project folder, install the app's building blocks:

```bash
npm install
```

### Step 2: Create a free Supabase account and project

Supabase stores your data, handles logins, and keeps uploaded files.

1. Go to **supabase.com** and click **Start your project**. Sign up with GitHub or your email.
2. Click **New project**.
   - **Organization:** create one (any name, e.g. your company). Choose the **Free** plan for now.
   - **Project name:** anything, e.g. `brand-hr`.
   - **Database password:** click **Generate a password**, then **copy it and save it somewhere safe** (a password manager or a private note). You'll need it in Step 3.
   - **Region:** pick the one closest to your users. For the Maldives, **South Asia (Mumbai)** is closest.
3. Click **Create new project** and wait about 2 minutes while it's prepared.

### Step 3: Copy your keys into `.env.local`

`.env.local` is a private settings file in the project folder. It holds your keys and **must never be shared or uploaded**. It's already listed in `.gitignore` so it won't be uploaded by accident.

Open `.env.local` in the project folder (right-click → **Open with** → **Notepad**) and fill in:

| Setting | Where to find it in Supabase |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Click the **Connect** button at the top of your project (or **Project Settings → Data API**). Copy the **Project URL**, which looks like `https://abcd1234.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | **Project Settings** (gear icon, bottom left) → **API Keys** → copy the **Publishable key** (starts with `sb_publishable_`) |
| `SUPABASE_SECRET_KEY` | Same page → **Secret keys** → click to reveal and copy (starts with `sb_secret_`). **Keep this one private.** |
| `DATABASE_URL` | Click **Connect** → **Connection string** → choose **Session pooler** → copy the text. Replace `[YOUR-PASSWORD]` with the database password from Step 2 (delete the square brackets too). |

> Older Supabase projects show an **anon** key and a **service_role** key instead. Use anon for the publishable key and service_role for the secret key.

Save the file.

### Step 4: Install the database tables

In a terminal in the project folder, run:

```bash
npm run db:migrate
```

You should see `✔ Applied 8 change(s). Your database is ready.` Run the same command again any time a later phase adds new tables. It only applies what's new.

### Step 5: Tell Supabase where the app lives

In Supabase, go to **Authentication → URL Configuration**:

1. **Site URL:** `http://localhost:3000`
2. Under **Redirect URLs**, click **Add URL** and enter `http://localhost:3000/**`
3. Click **Save**.

(When you go live, you'll add your real web address here too. See **Going live** below.)

### Step 6: Start the app

```bash
npm run dev
```

Open **http://localhost:3000/setup** in your browser. Every line should have a green tick. If one is red, it tells you what to fix. After changing `.env.local`, stop the app (press **Ctrl+C** in the terminal) and run `npm run dev` again.

> **Emails during testing:** Supabase sends sign-up and password emails for you, but its built-in sender only allows **a few emails per hour** and is meant for testing. Before launch you'll connect a proper email service (Resend) so there's no limit. See **Going live** below.

---

## Pages you can visit

| Page | Address | Needs |
|---|---|---|
| Home (marketing) | `/` | nothing |
| Product | `/product` | nothing |
| Industries | `/industries` | nothing |
| Pricing (calculator) | `/pricing` | nothing |
| Help centre | `/help`, `/help/owner`, `/help/hr`, `/help/manager`, `/help/staff`, `/help/guides/…` | nothing |
| Contact | `/contact` | nothing (messages are stored in the `contact_messages` table) |
| Sign up / log in / forgot password | `/signup`, `/login`, `/forgot-password` | Supabase connected |
| Setup (5 screens) | `/onboarding` → `/onboarding/company`, `/questions`, `/tools`, `/invite` | signed in |
| Home (in the app): Today (who is in, off, late, on shift), Celebrations, things needing attention | `/app` | signed in, setup finished |
| Requests (inbox, your requests, stand-in) | `/app/requests` | signed in |
| People (list, search, filters, CSV export) | `/app/people` | rights to see people |
| Add a person | `/app/people/new` | rights to add people |
| A person's profile (tabs: Overview, Personal, Job, Pay, Time & attendance, Time off, Claims, Documents, History) | `/app/people/<id>` | rights to see people; each tab only when its tool is on and you may see it |
| Org chart and company structure | `/app/people/org-chart` | rights to see company structure |
| Letters & files (make a letter, requests, sent letters, templates) | `/app/letters` | rights to letters |
| News | `/app/news` | rights to post news |
| Notifications | `/app/notifications` | signed in |
| Your account (name, two-step sign-in, notification choices) | `/app/account` | signed in |
| Two-step sign-in code | `/two-step` | shown after password when two-step is on |
| Workspace → Tools | `/app/workspace/tools` | signed in (owner/admin to change) |
| Workspace → People & access (logins, invitations, roles, permission grid) | `/app/workspace/people` | owner/admin |
| Workspace → Who approves what | `/app/workspace/requests` | owner/admin |
| Workspace → Company settings (details, letterhead) | `/app/workspace/company` | owner/admin |
| Workspace → Notification settings (email on/off, test email) | `/app/workspace/notifications` | owner/admin |
| Workspace → Activity log | `/app/workspace/activity` | owner |
| Workspace → Your data (download everything as a ZIP) | `/app/workspace/data` | owner |
| Workspace → Help & support (message us, let support in for a limited time) | `/app/workspace/support` | signed in |
| A tool's settings | `/app/workspace/tools/leave` (also `employees`, `attendance`, `payroll`, `claims`, `performance`) | signed in with rights to that tool |
| Staff app: Home (news, quick links) | `/staff` | signed in (staff land here automatically) |
| Staff app: Requests (yours, and ones waiting for your decision) | `/staff/requests` | signed in |
| Staff app: Ask for a letter | `/staff/letters` | login linked to a staff profile |
| Staff app: My files | `/staff/files` | login linked to a staff profile |
| Staff app: Directory | `/staff/directory` | signed in |
| Staff app: Me (contact details, emergency contacts, notifications, two-step sign-in) | `/staff/me` | signed in |
| Staff app: Notifications | `/staff/notifications` | signed in |
| Staff app: Time (clock in and out, breaks, your shifts, ask for a time fix) | `/staff/time` | Time & shifts switched on, login linked to a profile |
| Staff app: Time off (balances, ask for time off) | `/staff/time-off` | Time off switched on, login linked to a profile |
| Time (who's in today, fix a day) | `/app/time` | rights to see time records |
| Roster (weekly shifts, publish) | `/app/time/roster` | rights to see the roster |
| Timesheets (add up a period, approve, download) | `/app/time/timesheets` | rights to see time records |
| Salaries (search, change one, change several, history) | `/app/payroll/salaries` | see pay for everyone (owner, Payroll Officer) |
| Import salaries from a file | `/app/payroll/salaries/import` | change pay for everyone |
| Allowances & deductions (list, templates) | `/app/payroll/allowances` | payroll for everyone (owner, Payroll Officer) |
| One allowance or deduction (rules, who gets it, own amounts, try it) | `/app/payroll/allowances/<id>` (or `new`) | payroll for everyone; changes need payroll edit |
| Test panel for allowances & deductions | `/app/payroll/allowances/test` | payroll for everyone |
| Time off (requests, balances, documents, enter time off, new year) | `/app/time-off` | rights to see time off |
| Time off calendar (holidays, events, blackout dates, who's off) | `/app/time-off/calendar` | rights to see time off; adding and changing needs time off edit for everyone |
| Public holidays | `/app/time-off/holidays` | rights to see time off; changes need time off edit for everyone |
| Leave types and their rules | `/app/time-off/types` | time off edit for everyone |
| Granted leave (days given to one person) | `/app/time-off/grants` | time off edit for everyone |
| Payroll (pay runs) | `/app/payroll` | payroll rights (owner-granted) |
| A pay run (review, things to check, compared with last time, adjust, approve, finalize, email payslips, downloads) | `/app/payroll/<run>` | payroll rights; reversing needs the owner |
| Payroll reports (department, location, cost to company, year to date, pension, tax; Excel and PDF) | `/app/payroll/reports` | payroll for everyone |
| Salaries (everyone's current basic salary) | `/app/payroll/salaries` | salary rights for a team or the whole company |
| Allowances & deductions (add and edit the company's list) | `/app/payroll/allowances` | payroll rights (editing needs edit rights) |
| Claims (approve, pay separately) | `/app/claims` | rights to see claims |
| Staff app: Pay (payslips) | `/staff/pay` | Payroll switched on, login linked to a profile |
| Staff app: Claims (send a claim with a receipt) | `/staff/claims` | Claims switched on, login linked to a profile |
| Hiring (roles and careers page settings) | `/app/hiring` | hiring rights |
| New role | `/app/hiring/new` | hiring rights |
| A role's candidate board | `/app/hiring/<role>` | hiring rights |
| Edit a role | `/app/hiring/<role>/edit` | hiring rights |
| Public careers page | `/careers/<company>` | anyone, once the careers page is switched on |
| Public role page with the apply form | `/careers/<company>/<role>` | anyone |
| Joiners & leavers | `/app/joiners-leavers` | rights to see checklists |
| A person's checklist | `/app/joiners-leavers/<checklist>` | rights to see checklists |
| Checklist steps (templates) | `/app/joiners-leavers/checklists` | rights to see checklists |
| Permits & renewals | `/app/permits` | rights to see permits |
| Staff app: My tasks | `/staff/tasks` | Joiners & leavers switched on |
| Billing (plan, paid-until date, payments, how to pay) | `/app/workspace/billing` | the company owner |
| Platform admin (Harbor's own admin area; hidden) | `/admin`, `/admin/businesses`, `/admin/businesses/<company>`, `/admin/accounts`, `/admin/activity` | your email in `PLATFORM_ADMIN_EMAILS`, confirmed, with two-step sign-in |
| Training (courses) | `/app/training` | rights to manage courses |
| New course | `/app/training/new` | rights to manage courses |
| A course (lessons, quiz questions, who takes it, progress) | `/app/training/<course>` | rights to manage courses |
| Paid training | `/app/training/paid` | rights to see paid training |
| Reviews (review rounds) | `/app/reviews` | rights to see reviews |
| A review round | `/app/reviews/<round>` | rights to see reviews |
| One person's review (manager part, share) | `/app/reviews/review/<review>` | their manager, or rights to edit reviews |
| Goals | `/app/reviews/goals` | rights to see goals |
| Surveys | `/app/reviews/surveys` | rights to run surveys |
| New survey | `/app/reviews/surveys/new` | rights to run surveys |
| A survey (edit a draft, or see results) | `/app/reviews/surveys/<survey>` | rights to run surveys |
| Staff app: My courses (and paid training requests) | `/staff/courses` | Training switched on |
| Staff app: take a course | `/staff/courses/<course>` | the course is assigned to you |
| Staff app: certificate (PDF) | `/staff/courses/<course>/certificate` | you finished the course |
| Staff app: My goals | `/staff/goals` | Reviews & goals switched on |
| Staff app: My reviews | `/staff/reviews` | Reviews & goals switched on |
| Staff app: Surveys | `/staff/surveys` | Reviews & goals switched on |
| No connection page (shown by the phone app when offline) | `/offline` | nothing |
| Accept an invitation | `/invite/…` | the invitation link |
| Setup check | `/setup` | nothing |
| Privacy / Terms | `/privacy`, `/terms` | nothing |

Old addresses redirect automatically (for example `/app/settings/modules` → `/app/workspace/tools`, `/portal` → `/staff`, `/features` → `/product`). The list is in `next.config.ts`.

While email sending isn't set up, invitation emails are printed in the terminal where `npm run dev` is running, and setup shows a **Copy link** button so you can send invites by WhatsApp.

## The menu, pictures and celebrations

- **Menu (sidebar):** Home and Requests at the top, then folding sections for People, Hire, Run, Pay and Grow, with Workspace at the bottom. Everything starts open; click a section name to fold it. The section with the page you are on always stays open. Each person's choices are remembered in their browser. On a computer, the button next to the logo shrinks the menu to icons only. On phones the menu slides out from the left. Only switched-on tools and pages the person may see are listed. Your picture and name sit at the bottom of the menu, with Your account, the staff app, the home page, light or dark, and Sign out.
- **Profile pictures:** added by people who can edit staff profiles (owners, admins, HR), for anyone in the company and for themselves; staff can't add or change pictures. The picture is cropped to a square and made small in the browser before it's saved. Pictures are kept in the `avatars` storage bucket under random file names, so anyone with the exact link can see a picture, like most apps. Everywhere else shows initials when there's no picture.
- **Celebrations:** on Home in the office view and the staff app, for everyone. Birthdays this week (day and month only, never the year), work anniversaries, people who joined in the last two weeks, public holidays and company news. Staff can hide their birthday on their Me page (or Your account). Turn the card off for the whole company in Workspace, Company settings.

---

## Payroll (Pay, Payroll)

**Pay runs.** A regular run is for a pay period on one **pay schedule** (monthly, twice a month, every two weeks or weekly; set in Pay settings) and includes only the people on that schedule (people with no schedule are on the default one). An **ad-hoc run** pays only amounts added by hand, such as a bonus: no salary, allowances, overtime, claims or loans; pension and tax are worked out on what's added, if it counts for them. Monthly amounts (salary, fixed and percentage allowances) are shared out over shorter periods (for example × 0.5 twice a month), and tax on a monthly table is worked out on the monthly equivalent.

**What a run works out:** basic salary (prorated for people who join or leave during the period, less unpaid leave), every allowance and deduction with its rules, overtime at the rate for the kind of day, approved claims, loan and advance instalments, pension (staff and employer shares, rates in Pay settings) and income tax (bands in Pay settings, never in the code). Every line keeps a plain explanation.

**Steps:** calculate (as often as you like) → **approve** → **finalize** (locked; payslips appear in the staff app; loans and claims are updated) → mark as paid. Approving can be undone until you finalize. Only the **owner** can reverse a finalized run, with a reason. Amounts added by hand need a reason and are kept in the history (Activity log).

**Review screen:** one row per person with days, earnings, deductions and net pay; open a row to see every line and its explanation. **Things to check** lists: no salary or pay below zero (these stop the run until fixed or the person is put on hold), no bank details, no time records, missing clock-outs, overtime waiting for approval, requests still waiting, and net pay more than 20% different from the last regular run. **Compared with last time** shows the totals and each person against the last finalized run on the same schedule, biggest changes first.

**Outputs:** payslip PDFs with every line and its explanation, year-to-date totals and the company logo, in the staff app and emailed in bulk (**Email payslips**, attached as PDF; sent to the work email, else the personal email, else the sign-in email; without RESEND_API_KEY on your own computer they're printed in the terminal instead). Downloads on each run: bank transfer file, pay summary, payroll journal for the accountant (debits equal credits), pension report and tax report (both remind you to check the current rates). **Payroll reports** (by department, by location, cost to company, year to date, pension, tax) come from finalized and paid runs and download for Excel or as PDF.

---

## Salaries, allowances and deductions (Pay)

Both pages are for the **owner and the Payroll Officer** by default (Salaries needs "see pay for everyone"; Allowances & deductions needs payroll for everyone). They define everything payroll calculates.

**Salaries** (Pay, Salaries): everyone's basic salary, how it's paid (monthly, daily or hourly), pay schedule and the date it started, with search and filters (department, location, pay schedule, with or without a salary). A change starts on its own date and every earlier salary is kept (`employee_compensation`); an upcoming change shows under the current one. **Change several** raises a group by a percentage, adds an amount or sets one salary, from a date, and shows every change before saving. **Import from a file** takes a CSV or Excel file (staff number, salary, start date, optionally how it's paid and a reason) and checks every row before anything is saved.

**Allowances & deductions** (Pay, Allowances & deductions): pay items, with new, edit, duplicate and archive. A deduction works exactly like an allowance, but is taken off pay. Each item has:

- a name, type, taxable, counts toward pension, and optional dates it's in effect between;
- who gets it: all staff, or chosen departments, job titles, locations or people, plus people with their **own amount**;
- how it's worked out: a fixed amount per month; per day attended (rate × days present); prorated by attendance (amount × days present ÷ working days, or by calendar days); a percentage of basic salary; per occurrence (for example MVR 50 per late, only after the 3rd); or a custom formula;
- optional **rules**, checked from the top, first match wins: pay in full, pay a percentage, pay nothing, take off an amount, or pay a set amount. The builder combines conditions with and/or and warns when a rule can never be reached. There's also a rule formula, such as `IF(unapproved_absences >= 3, amount * 0.5, amount)`.

**Variables** for rules and formulas: basic_salary, amount, days_in_month, working_days, days_present (a half day counts as half), unapproved_absences, approved_absences, half_days, late_count, early_leaves, consecutive_unapproved_absences, overtime_hours, unpaid_leave_days, years_of_service. They come from the attendance register for the pay period.

**Formulas are never run as code.** They're read into a small checked tree (`src/lib/payroll/formula.ts`) that only knows numbers, those variables, + − * /, comparisons and IF, AND, OR, MIN, MAX and ROUND. The database calculates the tree (`private.pay_eval`) and refuses anything else, and formulas are checked again on the server before saving. Dividing by zero gives 0.

**Test panel** (Allowances & deductions, Test panel): pick a person and a month to see every item, what it comes to and why, for example "MVR 1,000.00 × 18 of 22 working days = MVR 818.18. Rule formula … gives MVR 409.09". Each item's page also has **Try it**, which works on unsaved changes. Payroll uses exactly the same calculation, and every payroll line keeps its explanation.

**Templates:** attendance allowance, service charge, food, transport (per day attended), phone, island allowance, late penalty, unapproved absence deduction and consecutive absence penalty. Amounts are examples.

**Unapproved absences:** basic salary now only takes off unpaid leave. Unapproved absences (working days with no time record and no approved time off) are taken off by the **Unapproved absence deduction** item every payroll company has: a day's basic salary for each (`basic_salary / working_days × unapproved_absences`). Change it or archive it like any other item.

**Rules that always hold:** editing or archiving an item never changes a finalized pay run (its lines are kept as they were). Every change to an item, who gets it, and salaries is kept in the history with who, when, and the values before and after. Staff claims (sent in by staff) stay separate in Claims; allowances are worked out automatically.

---

## Time off rules (Run, Time off)

**Days:** each leave type gives a fixed number of days per **leave year**, all at the start of the year. Nothing builds up month by month and nothing carries over. Per type, the leave year is either the calendar year or each person's year from their join date. Balances that existed before this change were kept exactly as they were (`leave_balances.kept_as_is`). A type can also have no limit (for example unpaid leave), give only days HR hands out to a person, or be **birthday leave** (for example 1 day in the birthday month, or within some days from the birthday; people need a date of birth on their profile).

**Rules per type** (Time off, Leave types): notice in minutes, hours or days, and whether it can be asked for after the day (sick leave); length of service needed first and whether it can be used during probation; who it's for (everyone, or chosen roles, job titles, departments, locations or people; staff never see types they can't use); least and most days per request, most days in a row (back-to-back requests count together); most people from one department off at once (approved and waiting both count); half days; paid or unpaid. **Blackout dates** are set on the calendar, for every type or chosen types, everywhere or one location.

**Asking:** when staff choose a type, the staff app shows what's left and the rules. Every change of dates is checked against the rules, and a request that breaks one can't be sent; the reason is shown (for example "Annual leave needs 7 days' notice. For these dates, you needed to ask by 20 Sep"). The database checks the same rules again when the request is saved. Office users entering time off for someone aren't held to notice or documents.

**Documents:** per type, never, always, or only for more than some days. They can be added when asking or, if the type allows, later: the deadline is a number of days after the last day off. The daily job (`/api/cron/notifications`) sends a reminder the day before the deadline to the person, their manager and HR. If there's still no document after the deadline, the time off is cancelled, its days go back into the balance, the working days become **unapproved absences** in attendance (source "system", so payroll and allowances see them) and everyone is told. HR can give more time or waive the document in Time off, Documents; both need a reason, which is kept in the history, and put the time off back.

**Granted leave:** HR can give one person days of any type (except no-limit types) with a reason, a start date and an optional expiry. Those days are added to what the person can ask for until they expire.

**Holidays and the calendar:** Time off, Holidays lists public holidays by year and location; add, edit or delete them, and load the Maldives list for a year (moon-based dates are estimates). Holidays are never absences. The calendar shows holidays, company events, blackout dates and who's off; people with time off edit rights add things with + on a day and click an entry to change or delete it.

---

## Attendance and overtime (Run, Time & shifts)

Each person gets **one status per day**: Present, Late, Half day, Early leave, Absent (unapproved), On leave, Holiday or Rest day. Harbor works it out from:

- **Work schedules** (Time, Work schedules): which weekdays someone works and their usual shift (the shift holds the start and end times and the break). One schedule can be the company default. The **roster** overrides a schedule for a single day, and managers can drag shifts onto days.
- **Public holidays** (from Time off) and **rest days** are never absences.
- **Absent** means no time record on a working day with no approved time off. Days on approved time off count as **approved absences**.
- **Rules** (Time, Rules): grace period before someone is late, how early leaving counts as early leave, half-day hours, and overtime. Overtime starts either after a number of hours in a day (by default the length of the person's shift) or for time outside the shift, with a minimum, rounding, a monthly limit, and optional manager approval. Every hour worked on a rest day or public holiday is overtime at that day's rate. The rates start at 1.25 times (normal days) and 1.5 times (rest days and public holidays); **check these against the current Maldives rules** before paying overtime.
- When no break was recorded, the shift's usual break is taken off days long enough to include one.

**Recording time:** staff clock in and out in the staff app (with optional location and a location fence per branch). Office users can add or fix a day, and must give a reason, which is kept in the history. Staff can ask for a fix, which goes to Requests. A fingerprint or face machine's file (CSV or Excel) can be imported in Time, Import from clock machine: match the columns, see every problem, then import.

**Monthly summary:** stored per person per month in the `attendance_months` table, for payroll formulas later: days in the month, working days, days present, half days, unapproved and approved absences, times late, early leaves, the longest run of unapproved absences, hours worked, and overtime by kind of day (plus overtime waiting for approval and over the monthly limit).

**Locking:** once a payroll run covering a day is finalized, that day's attendance can't be changed and the month's summary is kept as it was. Reversing the run unlocks it.

**Where to see it:** Time, Attendance register (everyone by day for a month), Overtime (approve or reject), Attendance reports (lateness, absences, overtime, hours; download for Excel or as PDF), and each person's profile, Time & attendance tab (their calendar, the month's numbers, overtime and fixes).

Payroll pays overtime only once it's approved (when approval is switched on), at the rate for the kind of day, and up to the monthly limit. Unapproved absences come off pay through the Unapproved absence deduction item (see Salaries, allowances and deductions).

---

## Design & fonts

- **All colours, fonts, radius, spacing and the marketing colour blobs** are CSS variables in the "DESIGN TOKENS" block at the top of [`src/app/globals.css`](src/app/globals.css). Dark is the default; the `.light` block is the light theme.
- **Blob colours** are `--blob-1` … `--blob-4` (placeholders). Blobs only appear on marketing pages, sign-in and the setup wizard, never inside the app.
- **Fonts:** `public/fonts` holds Alte Haas Grotesk Bold (freeware; its licence note must stay next to it) and Helvetica Neue Regular (`HelveticaNeue-Roman.otf`), which the link preview image's tagline uses. Helvetica Neue is a paid font: make sure you hold a licence for it.
- **Emails:** the look of every email Harbor sends lives in `src/lib/email/design.ts` (`emailLayout`, `emailButton`, `emailNote`, `emailFacts`, `emailParagraphs`). Change it once and every email follows. To see them without sending anything, run `npx tsx scripts/email-preview.mts <folder>` and open the files it writes.
- **Supabase's own emails** (sign-in link, confirm your email, password reset) are sent by Supabase, not by Harbor, so they have to be pasted in once. Run `npx tsx scripts/email-templates.ts`, then in Supabase go to **Authentication → Emails**, pick each template, and paste in the matching file from `supabase/email-templates/`, using the subject line listed in `README.txt` there. Rebuild them any time the design changes.

- **Icons:** the tab icon, the iPhone home-screen icon and the Android ones are all the same mark, drawn by `src/lib/og/harbor-mark.tsx`: the first letter of the brand name with a full stop, white on black, in Alte Haas Grotesk Bold, so it matches the "Harbor." wordmark. Change the brand name and they all follow. `src/app/favicon.ico` is the only one saved as a file (browsers ask for it by name); to rebuild it, run `npm run dev` in one terminal and `node scripts/make-favicon.mjs` in another.
- **Link preview image** (what WhatsApp, iMessage and Discord show when someone shares a Harbor link) is drawn by `src/lib/og/harbor-card.tsx`. The soft colour background is `public/og/harbor-bg.png`, made by `node scripts/og-background.mjs`.
- **Brand name** (the wordmark "Harbor.") comes from `brand.name` in the config file. The "by Nuit Works" credit comes from `brand.byline`.
- **Links to Nuit Works** are all built by `nuitWorksUrl()` in `src/lib/brand.ts`. They open in a new tab and carry `utm_source=harbor&utm_medium=referral&utm_campaign=<where the link sits>` (hero, footer, login, app-sidebar, settings, staff-app, email). Change the address or parameters there once.

## Environment variables

| Name | Needed | What it's for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Always | Address of your Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Always | Public key the browser uses. Safe to expose, because the database security rules protect the data |
| `SUPABASE_SECRET_KEY` | Always | Server-only master key, used for emails, reminders and the public careers form. **Never share it.** |
| `DATABASE_URL` | For `npm run db:migrate` | Direct database connection used to install/update tables |
| `NEXT_PUBLIC_SITE_URL` | When deployed | Your public web address (for links in emails), e.g. `https://app.yourbrand.com` |
| `RESEND_API_KEY` | For real emails | Sends app emails (notifications, letters ready, payslips). Without it, emails are printed in the terminal on your computer |
| `PLATFORM_ADMIN_EMAILS` | For the admin area | Emails of Harbor's own admins (you), comma separated, e.g. `abyan@nuit.works`. Only these can open `/admin`. See **Platform admin** below |
| `CRON_SECRET` | Optional, on Vercel | Any long random text. Lets Vercel run the daily catch-up that emails any notifications that didn't go out straight away (see `vercel.json`) |

On Vercel you'll enter the same names and values under **Project → Settings → Environment Variables** (see **Going live** below).

---

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app on your computer at http://localhost:3000 |
| `npm test` | Runs the automated tests (security rules, module rules, pricing) |
| `npm run check` | Type check + code-style check + tests. Run before deploying |
| `npm run db:migrate` | Applies new database changes to Supabase |
| `npm run db:migrate -- --status` | Lists which database changes are applied |
| `npm run demo:create -- you@example.com` | Adds the sample company **Coral Bay Resort** to your account, full of realistic data (see below) |
| `npm run demo:remove -- you@example.com` | Deletes that sample company again |

---

## How it's organised

```
src/
  config/app.config.ts      ← brand, colours, prices, default rates (edit me)
  modules/
    registry.ts             ← every module: name, features, dependencies, menus, permissions
    selection.ts            ← bundles + turning modules on/off with dependency rules
    pricing.ts              ← price estimates from the config
    roles.ts                ← default roles (Admin, HR Manager, Payroll Officer, Manager, Employee)
    access.ts               ← decides which menus/widgets/portal items each person sees
  lib/
    supabase/               ← database connections (user-level, and server-only admin)
    auth/                   ← sign-in, sign-up, sessions, business switching
  app/                      ← pages (Next.js App Router)
  proxy.ts                  ← keeps sessions fresh; sends signed-out visitors to /login
supabase/migrations/        ← database tables + security rules, applied in order
tests/                      ← automated tests (run with npm test)
scripts/db-migrate.mjs      ← installs database changes
```

### How each company space is kept separate

- Every table that holds business data has a `business_id`. Postgres **Row Level Security** checks every single read and write, so one business can never see another's data, even through a guessed URL or a direct API call.
- Links between records carry the `business_id` too, so a record can't point at another business's data. A record can never be moved to another business.
- Permissions are a matrix of **resource × action × scope** (`all` / `team` / `own`). Managers automatically see only their team (direct and indirect reports, plus departments they head); staff see only their own records.
- Salary, bank and payroll data are only visible to the Owner, the Payroll Officer and roles the **Owner** explicitly grants. Only the Owner can grant that access.
- Sensitive changes (salaries, roles, permissions, payroll runs, sign-ins) are written to an audit log that users can't edit.
- The migration **refuses to finish** if any table is missing security rules, and `npm test` checks that no table leaks data between businesses.

### Backups

Supabase backs up the database automatically every day (7 days kept on the Pro plan; the Free plan has limited backups, so upgrade to Pro before going live). Owners can also download all their company's data at any time from Workspace → Your data.

---

## Sample company for demos

To show Harbor to someone without using real people's data:

```bash
npm run demo:create -- you@example.com
```

Use the email you sign in to Harbor with. It adds a company called **Coral Bay Resort** to your account with 14 staff across two locations and data in every tool:
- **Time:** two weeks of shifts and clock-ins, with some people clocked in right now.
- **Pay:** time off, claims, and last month's payroll finished and paid.
- **Hiring and papers:** an open role with candidates, a new joiner's checklist, and work permits with some expiring soon.
- **Grow:** a food safety course, an open review round, goals, a survey and two news posts.

Sign in and choose it in the company switcher at the top left. You're its owner and also its general manager, so the staff app works too.

When you're done:

```bash
npm run demo:remove -- you@example.com
```

This only deletes the sample company, never your real one. The script signs in as you using the secret key in `.env.local`; no email is sent.

---

## Security review

Before launch, the whole app was reviewed for ways one person could reach data they shouldn't. Every issue found was fixed, and each fix has an automated test (`tests/db/security-hardening.test.ts`) so it stays fixed:

- **Pay:** only an owner can give someone a role that sees other people's pay or changes roles. Nobody but an owner can re-link their own login to another person's profile.
- **Records staff can't write directly:** their own clock-ins, timesheets and course progress. Those go through the app's checked steps (clock in, time fix requests, lessons and quizzes).
- **Reviews:** staff don't see their manager's rating or notes until the review is shared with them.
- **Anonymous surveys:** answers can't be matched to who replied, even by someone who can read the database directly.
- **Files:** a file HR hid from someone can't be downloaded by them.
- **Checklists:** only people allowed to can start one.
- **Careers form:**
  - A CV must really be a PDF, Word file or photo; a renamed file is refused.
  - One email address can apply at most 5 times a day per company.
  - Someone applying again can't overwrite an existing applicant's details.
- **Sign-in links:** can't redirect people to another website.
- **Spreadsheet exports:** can't carry formulas typed into the careers form.
- **Browser settings:** every page tells browsers not to let other sites frame Harbor, to use HTTPS only, and to allow only camera and location (for clock-in).

One limit to know about: someone who can invite staff could invite a second email address of their own and link it to another person's profile, which would show them that person's own pay and payslips. Invitations and links are recorded in the Activity log. Give "People & access" rights only to people you trust with that.

---

## Platform admin (for you)

Harbor has a private admin area for Nuit Works at **harbor.nuit.works/admin**. It's separate from the admin roles inside each company, and it lets you see every company on Harbor and manage their subscriptions.

**Who can open it:**
- Someone whose email is in the `PLATFORM_ADMIN_EMAILS` setting.
- Signed in with that email, and the email is confirmed.
- With two-step sign-in (a code from an authenticator app). The first time, the admin area asks you to set it up.

Everyone else gets an ordinary "page not found", so nobody can tell the area exists. There's no link to it on the public site or inside company workspaces. When you're signed in as a platform admin, a small **Admin** link appears at the top of your account page (Your account).

**What's in it:**
- **Overview:**
  - Numbers: companies, active and paying, on trial, ending in the next 7 days, suspended, total staff and estimated monthly revenue.
  - New signups over the last 90 days.
  - A "needs attention" list: trials and paid periods ending soon, overdue payments, and companies that never finished setup.
- **Companies:** every company with its owner, contact details, staff, tools, status, dates and price. It has search, filters and sorting, plus **Export CSV**.
- **One company:**
  - **What you see:** profile, owner and admin contacts, locations, usage, subscription, payments, private notes, and this company's admin log. Never staff personal details, salaries, IDs or documents.
  - **Actions:** each asks you to confirm and give a reason.
    - Extend a trial.
    - Extend the subscription.
    - Change status: suspend, reactivate or cancel.
    - Turn tools on or off.
    - Set a custom price or a discount.
    - Record a payment (with receipt).
    - Email the owner.
    - Add a private note.
    - Open their workspace as support: only when the company has switched on support access, view only, never pay data.
- **Logins:** every account that has signed up, with the companies they belong to, and a **Delete** button for test accounts. A login that is the only owner of a company can't be deleted until that company is deleted (or someone else is made owner). Deleting a login removes the sign-in only; the person's staff record stays with the company.
- **Deleting a company:** at the bottom of a company's page. It permanently removes the company, all its records and its uploaded files, after you type the company name and a reason. It cannot be undone; the admin log keeps a record.
- **Admin log:** every action, with who, what, which company, why, and the values before and after.

**Subscriptions:**
- A trial lasts the number of days in the config file (30).
- Payments are manual: you confirm bank transfers or mobile payments by recording them. Recording a payment makes the company active and moves its paid-until date to the end of the period it covers.
- When a trial or paid period ends, the company gets a **7-day grace period**. The owner sees a banner during it. After that the account becomes **read-only** until you record a payment or extend it: they can still view and export their data, and message support.
- Owners get emails 7 days and 1 day before the end, and when the account is paused. These are sent by the daily job at 02:00 UTC.
- Owners see their plan, paid-until date, payment history and how to pay in **Workspace → Billing**. To show your bank details there, fill in `billing.bankTransfer` in `src/config/app.config.ts`. Until then it tells them to email you.

### Adding another admin (or yourself) on Vercel
1. Go to **vercel.com → your Harbor project → Settings → Environment Variables**.
2. If `PLATFORM_ADMIN_EMAILS` isn't there yet, click **Add New**:
   - **Name:** `PLATFORM_ADMIN_EMAILS`
   - **Value:** `abyan@nuit.works`
   - **Environments:** tick **Production** (and Preview if you use it)
   - Click **Save**.
3. To add someone later, click the **⋯** next to `PLATFORM_ADMIN_EMAILS` → **Edit**. Add their email after a comma, with no spaces needed, for example `abyan@nuit.works,colleague@nuit.works`. Click **Save**.
4. Go to **Deployments → the latest one → ⋯ → Redeploy**. Settings only take effect after a redeploy.
5. The new admin signs up or signs in to Harbor with exactly that email, confirms it, then opens harbor.nuit.works/admin. They'll be asked to set up two-step sign-in the first time.

To remove an admin, delete their email from the list and redeploy. They lose access straight away, and their support access goes with it at the next daily job, or the next time any admin opens the admin area.

On your own computer, the same setting is in `.env.local`.

---

## Speed

Harbor's pages are built on Vercel's servers, and every page asks the database (Supabase) for its data. The two must be in the same place, or every page waits for data to cross the world, often more than once.

- **Supabase** is in **Mumbai** (`ap-south-1`).
- **Vercel functions** are pinned to **Mumbai** too (`"regions": ["bom1"]` in `vercel.json`).

**Checking the region in Vercel:**
1. Go to **vercel.com** → your Harbor project → **Settings** → **Functions**.
2. Under **Function Region**, it should say **Mumbai, India (bom1)**. `vercel.json` sets this on each deploy.
3. To see it on a live page: open harbor.nuit.works in Chrome, press **F12** → **Network**, reload, click the first row and look for `x-vercel-id` under **Response Headers**. It reads like `bom1::bom1::…`. The last place name before the code is where the page was built; it should be `bom1`, not `iad1` (Washington DC).

If you ever move Supabase to another region, change `bom1` in `vercel.json` to the matching Vercel region.

**Measuring speed** (for developers): `scripts/perf/` has the tools used to measure and tune Harbor. `session.mts` makes a throwaway signed-in test company (and deletes it again), `measure.mts` times the main pages, `waterfall.mts` lists each page's database calls, `js-size.mts` shows how much JavaScript each page downloads, and `db-audit.mjs` checks the database for missing indexes and slow security rules. Each file explains how to run it. Always run `session.mts teardown` afterwards.

---

## Going live on harbor.nuit.works

Do these in order. Each one is a few clicks. Where it says "copy", never paste keys into chats or emails.

### 1. Upgrade Supabase to Pro
**Supabase → your project → Settings → Billing → Upgrade to Pro.** This gives daily backups kept for 7 days, and no pausing when the project is quiet. While you're there, note your project's **region** (Settings → General, for example "Southeast Asia (Singapore)"); you need it in step 5.

### 2. Set up email with Resend
1. Sign up at **resend.com** and choose **Domains → Add domain**, then enter `harbor.nuit.works`.
2. Resend shows a few DNS records. Add each one where you manage the nuit.works domain (the company you bought it from, or Cloudflare), exactly as shown (they go on names under harbor.nuit.works, so they don't clash with the website). Back in Resend, click **Verify**; it can take up to an hour.
3. In Resend, go to **API Keys → Create API key** (name it "Harbor"). Keep the page open for step 4.
4. In `src/config/app.config.ts`, `fromAddress` is set to `no-reply@harbor.nuit.works`.
5. So that sign-up and password emails also go through Resend, in **Supabase → Authentication → Emails → SMTP Settings**, turn on **Custom SMTP** and enter:
   - **Host:** `smtp.resend.com`
   - **Port:** `465`
   - **Username:** `resend`
   - **Password:** your Resend API key
   - **Sender:** the same from address.

### 3. Add the settings on Vercel
**Vercel → your project → Settings → Environment Variables.** Add each of these for **Production** (copy the values from your `.env.local` where you have them):

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | same as `.env.local` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | same as `.env.local` |
| `SUPABASE_SECRET_KEY` | same as `.env.local` |
| `NEXT_PUBLIC_SITE_URL` | `https://harbor.nuit.works` |
| `RESEND_API_KEY` | the key from Resend |
| `CRON_SECRET` | any long random text, for example 40 letters and numbers typed at random |
| `PLATFORM_ADMIN_EMAILS` | `abyan@nuit.works` |

Then **Deployments → the latest one → ⋯ → Redeploy** so the new settings are used.

### 4. Point harbor.nuit.works at Vercel
1. **Vercel → your project → Settings → Domains → Add**, enter `harbor.nuit.works`.
2. Vercel shows one record to add, usually a **CNAME** named `harbor` pointing to `cname.vercel-dns.com`. Add it where you manage nuit.works.
3. Wait until Vercel shows a green tick (a few minutes to an hour). HTTPS is set up for you.

### 5. Put Harbor's server next to the database
**Vercel → Settings → Functions → Function Region**: choose the region closest to your Supabase region from step 1 (for example Singapore, `sin1`). Pages then load several times faster. Redeploy afterwards.

### 6. Tell Supabase the real address
**Supabase → Authentication → URL Configuration:**
- **Site URL:** `https://harbor.nuit.works`
- **Redirect URLs:** add `https://harbor.nuit.works/**` (keep the localhost one for testing on your computer).
- Click **Save**.

Also turn on **Authentication → Providers → Email → Prevent use of leaked passwords**, if your plan offers it.

### 7. Check it works
1. Open **https://harbor.nuit.works/setup**. Every line should have a green tick.
2. Sign up with a new email address and check the confirmation email arrives from your address.
3. Share `https://harbor.nuit.works` in a WhatsApp chat with yourself and check the preview card shows.
4. The next morning, check **Vercel → your project → Logs** for the 02:00 (UTC) daily reminder job, which should show a 200 result.

---

## Adding a new tool later

1. **Name it.** Add its key to `ModuleKey` in [`src/modules/types.ts`](src/modules/types.ts).
2. **Describe it.** Add an entry to `MODULES` in [`src/modules/registry.ts`](src/modules/registry.ts): the name people see, its stage (`hire`, `run`, `pay`, `grow`), a one-line tagline, 3–4 short points, 4–6 outcomes for the product page, `requires` and `recommends`, permission `resources`, sidebar `nav`, staff app `portal` items, Home `widgets` (with a section: attention, today or month), `notifications`, optional `setup` and `checklist` items.
3. **Price it.** Add a line under `pricing.tools` in [`src/config/app.config.ts`](src/config/app.config.ts).
4. **Suggest it in setup (optional).** Add a question or a rule in [`src/modules/setup-questions.ts`](src/modules/setup-questions.ts).
5. **Store its data.** Create a new file in `supabase/migrations/` (with a later date). Give every table a `business_id` column and `unique (business_id, id)`, link to other tables with `(business_id, x_id)` foreign keys, then add security rules with one line per table:
   ```sql
   call private.std_rls('my_table', 'my_resource', 'employee_id');  -- or null if not about one person
   call private.finalize_tenant_tables();                            -- always last
   ```
   Also add the key to `private.module_catalog` in the migration.
6. **Give roles access** in [`src/modules/roles.ts`](src/modules/roles.ts), and add its pages to [`src/modules/routes.ts`](src/modules/routes.ts) once they exist.
7. Run `npm run db:migrate` and `npm test`.

Setup, Workspace → Tools, the sidebar, Jump to, Home, the staff app, notifications, pricing and the permission grid all pick up the new tool automatically.
