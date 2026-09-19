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
| Billing (plan, paid-until date, payments, how to pay) | `/app/workspace/billing` | the company owner |
| Platform admin (Harbor's own admin area; hidden) | `/admin`, `/admin/businesses`, `/admin/businesses/<company>`, `/admin/activity` | your email in `PLATFORM_ADMIN_EMAILS`, confirmed, with two-step sign-in |
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
- **Fonts:** `public/fonts` holds Alte Haas Grotesk Bold (freeware; its licence note must stay next to it) and Helvetica Neue Regular (`HelveticaNeue-Roman.otf`), which the link preview image's tagline uses. Helvetica Neue is a paid font: make sure you hold a licence for it.
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
