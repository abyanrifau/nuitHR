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
| 10 | Demo data, security review, performance check, go live on Vercel | Next |

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

(When you go live on Vercel in Phase 10, you'll add your real web address here too.)

### Step 6: Start the app

```bash
npm run dev
```

Open **http://localhost:3000/setup** in your browser. Every line should have a green tick. If one is red, it tells you what to fix. After changing `.env.local`, stop the app (press **Ctrl+C** in the terminal) and run `npm run dev` again.

> **Emails during testing:** Supabase sends sign-up and password emails for you, but its built-in sender only allows **a few emails per hour** and is meant for testing. Before launch (Phase 10) we'll connect a proper email service (Resend) so there's no limit.

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
| Home (in the app) | `/app` | signed in, setup finished |
| Requests (inbox, your requests, stand-in) | `/app/requests` | signed in |
| People (list, search, filters, CSV export) | `/app/people` | rights to see people |
| Add a person | `/app/people/new` | rights to add people |
| A person's profile (tabs: personal, job, emergency, ID, salary & bank, files, login, history) | `/app/people/<id>` | rights to see people (salary tab only with salary rights) |
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
| Time off (requests, balances, enter time off, new year) | `/app/time-off` | rights to see time off |
| Time off calendar | `/app/time-off/calendar` | rights to see time off |
| Payroll (pay runs) | `/app/payroll` | payroll rights (owner-granted) |
| A pay run (check, adjust, finalize, reverse, downloads) | `/app/payroll/<run>` | payroll rights |
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

## Design & fonts

- **All colours, fonts, radius, spacing and the marketing colour blobs** are CSS variables in the "DESIGN TOKENS" block at the top of [`src/app/globals.css`](src/app/globals.css). Dark is the default; the `.light` block is the light theme.
- **Blob colours** are `--blob-1` … `--blob-4` (placeholders). Blobs only appear on marketing pages, sign-in and the setup wizard, never inside the app.
- **Fonts:** see [`public/fonts/README.txt`](public/fonts/README.txt) for the two files to add (Alte Haas Grotesk Bold, Helvetica Neue Light).
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
| `CRON_SECRET` | Optional, on Vercel | Any long random text. Lets Vercel run the daily catch-up that emails any notifications that didn't go out straight away (see `vercel.json`) |

On Vercel you'll enter the same names and values under **Project → Settings → Environment Variables** (Phase 10 walks you through it).

---

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Starts the app on your computer at http://localhost:3000 |
| `npm test` | Runs the automated tests (security rules, module rules, pricing) |
| `npm run check` | Type check + code-style check + tests. Run before deploying |
| `npm run db:migrate` | Applies new database changes to Supabase |
| `npm run db:migrate -- --status` | Lists which database changes are applied |

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
