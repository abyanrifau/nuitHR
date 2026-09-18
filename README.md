# [BRAND] — HR & Workforce Platform

A multi-business (multi-tenant) HR platform. A business owner signs up, picks only the HR modules they need, and gets a private workspace. Staff use a phone-friendly portal to clock in, apply for leave, see payslips and submit claims.

- **Built with:** Next.js 16, TypeScript, Tailwind CSS, Supabase (login, database, file storage), deployed on Vercel.
- **Defaults:** Maldives first (MVR, Indian/Maldives time, DD/MM/YYYY), but every business can change these.

> **Brand name, colours, prices and default rates** all live in one file:
> [`src/config/app.config.ts`](src/config/app.config.ts). Change `[BRAND]` there and it updates everywhere.

---

## Build progress

| Phase | What | Status |
|---|---|---|
| 1 | Project setup, database for every module, security rules, module registry, sign-in | ✅ Done |
| 2 | Registration & module-selection wizard, Settings → Modules | ✅ Done |
| 3 | Core: employees, organization, roles, approvals, dashboard, notifications, documents & letters | Next |
| 4 | Staff portal (installable phone app) | |
| 5 | Attendance & Leave | |
| 6 | Payroll, Transport Allowance, Expense Claims | |
| 7 | Recruitment, Onboarding, Compliance | |
| 8 | Learning & People Development | |
| 9 | Marketing website, pricing calculator, help centre | |
| 10 | Demo data, security review, performance check, go live on Vercel | |

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

You should see `✔ Applied 7 change(s). Your database is ready.` Run the same command again any time a later phase adds new tables. It only applies what's new.

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
| Home | `/` | nothing |
| Sign up (wizard step 1) | `/signup` | Supabase connected |
| Log in / forgot password | `/login`, `/forgot-password` | Supabase connected |
| Business setup wizard (steps 2–6) | `/onboarding` | signed in |
| Dashboard + getting-started checklist | `/app` | signed in, business set up |
| Settings → Modules | `/app/settings/modules` | signed in (owner/admin to change) |
| Accept an invitation | `/invite/…` (link from the email) | the invitation link |
| Setup check | `/setup` | nothing |
| Privacy / Terms | `/privacy`, `/terms` | nothing |

While email sending isn't set up, invitation emails are printed in the terminal where `npm run dev` is running, and the wizard shows a **Copy link** button so you can send invites by WhatsApp.

## Design & fonts

- **All colours, fonts, radius, spacing and the marketing colour blobs** are CSS variables in the "DESIGN TOKENS" block at the top of [`src/app/globals.css`](src/app/globals.css). Dark is the default; the `.light` block is the light theme.
- **Blob colours** are `--blob-1` … `--blob-4` (placeholders). Blobs only appear on marketing pages, sign-in and the setup wizard, never inside the app.
- **Fonts:** see [`public/fonts/README.txt`](public/fonts/README.txt) for the two files to add (Alte Haas Grotesk Bold, Helvetica Neue Light).
- **Brand name** (the wordmark "Nuit Works.") comes from `brand.name` in the config file.

## Environment variables

| Name | Needed | What it's for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Always | Address of your Supabase project |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Always | Public key the browser uses. Safe to expose, because the database security rules protect the data |
| `SUPABASE_SECRET_KEY` | Always | Server-only master key, used for emails, reminders and the public careers form. **Never share it.** |
| `DATABASE_URL` | For `npm run db:migrate` | Direct database connection used to install/update tables |
| `NEXT_PUBLIC_SITE_URL` | When deployed | Your public web address (for links in emails), e.g. `https://app.yourbrand.com` |
| `RESEND_API_KEY` | From Phase 3 | Sends app emails (notifications, payslips) |

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

### How data is kept separate between businesses

- Every table that holds business data has a `business_id`. Postgres **Row Level Security** checks every single read and write, so one business can never see another's data, even through a guessed URL or a direct API call.
- Links between records carry the `business_id` too, so a record can't point at another business's data. A record can never be moved to another business.
- Permissions are a matrix of **resource × action × scope** (`all` / `team` / `own`). Managers automatically see only their team (direct and indirect reports, plus departments they head); staff see only their own records.
- Salary, bank and payroll data are only visible to the Owner, the Payroll Officer and roles the **Owner** explicitly grants. Only the Owner can grant that access.
- Sensitive changes (salaries, roles, permissions, payroll runs, sign-ins) are written to an audit log that users can't edit.
- The migration **refuses to finish** if any table is missing security rules, and `npm test` checks that no table leaks data between businesses.

### Backups

Supabase backs up the database automatically every day (7 days kept on the Pro plan; the Free plan has limited backups, so upgrade to Pro before going live). A download-your-data export for business owners is part of Phase 3.

---

## Adding a new module later

1. **Name it.** Add its key to `ModuleKey` in [`src/modules/types.ts`](src/modules/types.ts).
2. **Describe it.** Add an entry to `MODULES` in [`src/modules/registry.ts`](src/modules/registry.ts): name, category, features, who it's for, `requires` (must-have modules) and `recommends`, its permission `resources`, sidebar `nav` items, staff `portal` items, dashboard `widgets`, `notifications`, optional `setup` step and `checklist` items.
3. **Price it.** Add a line under `pricing.modules` in [`src/config/app.config.ts`](src/config/app.config.ts).
4. **Store its data.** Create a new file in `supabase/migrations/` (name it with a later date, e.g. `20270101000001_my_module.sql`). Give every table a `business_id` column and `unique (business_id, id)`, link to other tables with `(business_id, x_id)` foreign keys, then add security rules with one line per table:
   ```sql
   call private.std_rls('my_table', 'my_resource', 'employee_id');  -- or null if not about one employee
   call private.finalize_tenant_tables();                            -- always last
   ```
5. **Give roles access.** Add the new resource to the default roles in [`src/modules/roles.ts`](src/modules/roles.ts) if needed.
6. Run `npm run db:migrate` and `npm test`.

The wizard, Settings → Modules, sidebar, dashboard, portal, notification settings and permission matrix all pick up the new module automatically.
