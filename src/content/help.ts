/**
 * Help centre content. Organised by role; each guide has a short intro,
 * numbered steps and an "If something looks wrong" box.
 *
 * Only features that exist are documented. Add a guide here when a new
 * part of the product ships, and list it under the roles that need it.
 */
import { appConfig } from "@/config/app.config";

export type HelpRole = "owner" | "hr" | "manager" | "staff";

export const HELP_ROLES: { key: HelpRole; title: string; summary: string }[] = [
  { key: "owner", title: "I own the business", summary: "Setting up, choosing tools, and deciding who can do what." },
  { key: "hr", title: "I run HR", summary: "Getting people in, keeping settings right, and tidy records." },
  { key: "manager", title: "I manage a team", summary: "Joining your company space and keeping an eye on your team." },
  { key: "staff", title: "I'm a staff member", summary: "The phone app, asking for letters, joining from an invitation and getting back in." },
];

export interface HelpGuide {
  slug: string;
  title: string;
  roles: HelpRole[];
  intro: string;
  steps: string[];
  wrong: string[];
}

export const HELP_GUIDES: HelpGuide[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    roles: ["owner", "hr"],
    intro: `Setup is five short screens, and everything on them can be changed later. You get ${appConfig.trial.days} days free.`,
    steps: [
      "Go to the sign-up page, enter your name, email and a password, then open the confirmation email and tap the link.",
      "About your company: add your company name, logo, industry, country, currency, time zone, roughly how many staff you have, and each location they work at.",
      "Tell us how you work: answer the eight questions. Each answer is a single tap.",
      "Your recommended tools: check the list. Each suggestion shows why it was picked. Switch anything on or off and watch the monthly estimate change, then continue.",
      "Invite people: send email invitations, upload a spreadsheet of your staff, or skip this for now.",
      "You land on Home. The setup checklist there shows what is left for each tool.",
    ],
    wrong: [
      'The confirmation email hasn\'t arrived: wait a few minutes, check spam, then use "Send the email again".',
      "The link says it didn't work: it may have been opened in a different browser. Your email is probably confirmed already, so just sign in.",
      "You closed the browser halfway: sign in again and setup picks up where you stopped.",
    ],
  },
  {
    slug: "switch-tools",
    title: "Switch tools on or off",
    roles: ["owner", "hr"],
    intro: "You can add or remove tools at any time. Switching one off only hides it; everything in it is kept for when you switch it back on.",
    steps: [
      "In the sidebar, open Workspace → Tools.",
      "Find the tool under Hire, Run, Pay or Grow and use its switch.",
      "Check the monthly estimate on the right (at the bottom on a phone).",
      "Select Save changes.",
    ],
    wrong: [
      "The switches are greyed out: only the owner or an admin can change tools. Ask one of them.",
      "A tool you switched off still shows in the menu: refresh the page.",
    ],
  },
  {
    slug: "tool-settings",
    title: "Change a tool's settings",
    roles: ["owner", "hr"],
    intro:
      "Some tools start with sensible settings you should check once: time off types and public holidays, shifts and overtime, pay day with pension and tax rates, claim types, and your first review round.",
    steps: [
      "Open Workspace → Tools.",
      "Under Tool settings, choose the tool.",
      "Change what you need. For example, edit leave days per year, add a shift, or correct a tax band.",
      "Select Save settings. The matching item on the Home checklist is ticked.",
    ],
    wrong: [
      'You see "No access": the setting belongs to someone with rights to that tool (for example, payroll rates need the payroll officer or the owner).',
      "Pension or tax rates look out of date: rates change. Check the current figures with the pension office and MIRA, then update them here.",
    ],
  },
  {
    slug: "claim-types",
    title: "Set up claim types",
    roles: ["owner", "hr"],
    intro:
      "Claims covers transport, meals, travel, supplies and any types you add. Each type has its own cut-off day, limit, receipt rule and way of being paid.",
    steps: [
      "Open Workspace → Tools → Claims.",
      "For each type, set a cut-off day if late claims should move to the next month.",
      'Add a limit per claim if you want one, and tick "Receipt photo required" where needed.',
      "Choose whether it's paid in payroll or separately.",
      'Use "Add a claim type" for anything else you pay back, then select Save claim types.',
    ],
    wrong: [
      'You don\'t use Payroll here: approved claims show as "to be paid" so you can pay them yourself.',
      '"Each claim type needs a different name": two types share a name. Rename one.',
    ],
  },
  {
    slug: "invite-people",
    title: "Invite people",
    roles: ["owner", "hr"],
    intro: "Invited people get an email with a link to join your company space with the role you choose.",
    steps: [
      "During setup, open the Invite people screen.",
      "Choose Invite by email.",
      "Enter each person's name, email, role and department.",
      'Keep "Send an invitation email" ticked, then select Add.',
      "If email sending isn't set up yet, select Copy link next to each person and send it by WhatsApp or message.",
    ],
    wrong: [
      "They can't accept: the link only works for the email address it was sent to. Ask them to sign in with that address.",
      "The link has expired: invitations last 14 days. Invite them again and the old link stops working.",
    ],
  },
  {
    slug: "upload-staff-list",
    title: "Upload your staff from a spreadsheet",
    roles: ["hr", "owner"],
    intro:
      "Add everyone at once from Excel or Google Sheets. Every row is checked before anything is saved, so a mistake never leaves you half imported.",
    steps: [
      "On the Invite people screen, choose Upload a spreadsheet.",
      "Select Download template and fill it in. Only the first name is required.",
      "Save it as CSV (in Excel: File → Save As → CSV).",
      "Upload the file. Rows with problems are listed with the exact reason and row number.",
      "Fix those rows in your spreadsheet and upload again. When every row is ready, select Import.",
    ],
    wrong: [
      '"That\'s an Excel file": save it as CSV first.',
      '"Location doesn\'t exist": it must match one you added in About your company, spelled the same way.',
      "Dates are rejected: use day/month/year, for example 01/03/2025.",
    ],
  },
  {
    slug: "read-home",
    title: "Read your Home screen",
    roles: ["owner", "hr", "manager"],
    intro: "Home shows only what you're allowed to see, from the tools your company uses, in three parts.",
    steps: [
      "Needs your attention: requests waiting for you, permits and files about to expire, the next pay day, and claims still to be paid.",
      "Today: who has clocked in, who is off, and how many shifts are on the roster.",
      "This month: headcount, the last payroll cost, and training due.",
      "Owners and admins also see the setup checklist until everything is done.",
    ],
    wrong: ["A section is missing: it appears once the matching tool is switched on and you have access to it."],
  },
  {
    slug: "switch-company",
    title: "Move between companies",
    roles: ["owner", "hr"],
    intro: "If you work for more than one company, like an accountant with several clients, you can switch between their spaces with one login.",
    steps: [
      "Select the company name in the top bar.",
      "Choose the company you want. Everything on screen now belongs to that company.",
      'To add a new company, choose "Set up another company space".',
    ],
    wrong: ["A company is missing from the list: ask its owner to invite you with your current email address."],
  },
  {
    slug: "join-from-invite",
    title: "Join from an invitation",
    roles: ["manager", "staff"],
    intro: "Your employer sends you a link. It works once, for the email address it was sent to.",
    steps: [
      "Open the link from the email or message.",
      "If you're new, choose Create your account and use the same email address. Otherwise choose I already have an account.",
      "Confirm your email if asked, then open the link again.",
      "Select Accept invitation.",
    ],
    wrong: [
      '"Sent to a different email": sign out, then sign in or create an account with the address the invitation was sent to.',
      '"Expired" or "cancelled": ask your employer for a new link.',
    ],
  },
  {
    slug: "sign-in",
    title: "Sign in, or get back in",
    roles: ["owner", "hr", "manager", "staff"],
    intro: "You can sign in with a password, or with a one-time link sent to your email.",
    steps: [
      "Open the log in page.",
      "Choose Password, or Email me a link if you'd rather not type a password.",
      "Forgot your password? Select Forgot password, enter your email and open the link we send.",
      "Choose a new password with at least 8 characters, including a letter and a number.",
    ],
    wrong: [
      '"Too many attempts": wait a minute and try again.',
      "The reset link doesn't work: it only works once and for a limited time. Ask for a new one.",
    ],
  },
  {
    slug: "add-a-person",
    title: "Add a person and keep their profile up to date",
    roles: ["owner", "hr"],
    intro: "Each person has one profile with tabs for their details, job, emergency contacts, ID, salary, files, login and a full change history.",
    steps: [
      "In the sidebar, open People and select Add person.",
      "Fill in their name, then their job: employee number, job title, department, location and who they report to. Everything else is optional.",
      "Select Add person. Their profile opens.",
      "To change something later, open the tab and select Edit, change it, then Save.",
      "If they leave, open the Job tab, select Change status, choose Resigned or Let go, and add their last day and a reason. Their records are kept.",
      "To download everyone as a spreadsheet, select Export CSV on the People page. It uses whatever search and filters you have on.",
    ],
    wrong: [
      '"That employee number is already used": each person needs a different number. The form suggests the next free one.',
      "You can't see the Salary & bank tab: only people the owner allows can see salaries.",
      "No job titles in the list: add them first in People → Org chart → Company structure.",
    ],
  },
  {
    slug: "company-structure",
    title: "Set up locations, departments and job titles",
    roles: ["owner", "hr"],
    intro: "Locations, departments and job titles are the building blocks for the org chart, filters and who approves what.",
    steps: [
      "Open People → Org chart, then the Company structure tab.",
      "Select Add next to Locations, Departments or Job titles, fill in the name and save.",
      "For a location, you can add its map position and a radius. The staff app uses this to check where people clock in.",
      "To see who reports to whom, open the Chart tab. It draws itself from each person's Reports to field.",
    ],
    wrong: [
      "Removing something archived it instead: people are still linked to it, so it's hidden rather than deleted. Tick Show archived to restore it.",
      "Someone is under No manager set: open their profile, Job tab, and choose who they report to.",
    ],
  },
  {
    slug: "decide-requests",
    title: "Approve or decline requests",
    roles: ["owner", "hr", "manager"],
    intro: "Time off, claims, letters and fixes that need your decision all arrive in one list. You also get a notification, and an email unless you switched it off.",
    steps: [
      "Open Requests in the sidebar. Waiting for you lists everything you need to decide, oldest first.",
      "Select Approve, or Decline and add a short note so they know why.",
      "To decide several at once, tick them and use Approve or Decline at the top.",
      "Going away? Open the Stand-in tab, choose a colleague and the dates. They can decide your requests until then.",
      "Owners and admins can set who approves what in Workspace → Who approves what.",
    ],
    wrong: [
      "\"This request isn't waiting for you\": someone else already decided it, or it moved to the next step.",
      "Nothing arrives: requests go to the person's manager first. Check they have a manager and that the manager has a login linked to their profile.",
    ],
  },
  {
    slug: "letters",
    title: "Make a letter or certificate",
    roles: ["owner", "hr"],
    intro: "Letters are filled in from the person's profile and printed on your letterhead as a PDF.",
    steps: [
      "First, add your logo, signature, stamp and who signs letters in Workspace → Company settings → Letterhead.",
      "Open Letters & files and stay on Make a letter.",
      "Choose the person and the template, add the purpose if the letter needs one, then select Fill in the letter.",
      "Read it through. You can change any wording before making it.",
      "Select Make PDF. It downloads, and a copy is saved to the person's files.",
      "When staff ask for a letter, it shows under Requests. Once approved, select Issue. They're told it's ready.",
    ],
    wrong: [
      "Words in [brackets]: that detail is missing from the profile. Add it and fill in again, or type over it.",
      "The logo doesn't appear: use a PNG or JPG image. Other image types can't be printed on PDFs.",
    ],
  },
  {
    slug: "roles-and-access",
    title: "Decide who can see and do what",
    roles: ["owner"],
    intro: "Every login has one role. A role says what that person can see and change, for their own records, their team, or everyone.",
    steps: [
      "Open Workspace → People & access.",
      "On the Logins tab, change someone's role, link their login to their profile, or turn their login off.",
      "On the Roles tab, pick a role to see its permission grid. Own means only their own records, Team adds the people who report to them, All means everyone.",
      "Change what you need and select Save permissions.",
      "To make a new role, select New role and copy an existing one as a starting point.",
    ],
    wrong: [
      "A row has a lock: salary, payroll and role settings can only be changed by the owner.",
      "Someone can't see their own time off: their login isn't linked to their profile. Link it on the Logins tab.",
    ],
  },
  {
    slug: "post-news",
    title: "Post company news",
    roles: ["owner", "hr"],
    intro: "News shows at the top of the staff app. You can send it to everyone, or just one location or team.",
    steps: [
      "Open News in the sidebar and select Post news.",
      "Write a headline and the news.",
      "Choose a location or team if it's only for them.",
      "Post it now, schedule it for later, or save it as a draft. Tick Keep at the top to pin it.",
    ],
    wrong: ["Nobody was notified about a scheduled post: people are notified when a post goes up straight away. Scheduled posts simply appear at their time."],
  },
  {
    slug: "notifications-and-security",
    title: "Notifications, two-step sign-in and your data",
    roles: ["owner", "hr", "manager", "staff"],
    intro: "The bell at the top shows what's new. You choose which events also reach you by email.",
    steps: [
      "Select the person icon at the top right to open your account.",
      "Under Notifications, tick what you want in the app and by email, then save.",
      "Under Two-step sign-in, select Set up and scan the code with an authenticator app. After that you'll type a code each time you sign in.",
      "Owners can send a test email from Workspace → Notification settings, download all company data from Workspace → Your data, and see every change in Workspace → Activity log.",
    ],
    wrong: [
      "Emails don't arrive: check spam, then ask the owner to send a test email. If that fails too, email sending isn't set up yet.",
      "Lost the phone with your authenticator app: ask your company's owner to contact support.",
    ],
  },
  {
    slug: "get-support",
    title: "Get help from our team",
    roles: ["owner", "hr"],
    intro: "Our support team can't see anything in your company unless you let them in, and only for as long as you choose.",
    steps: [
      "Open Workspace → Help & support.",
      "Write what you need under Message support and select Send. We reply by email.",
      "If we need to look at your setup, choose how long to let support in (1, 3 or 7 days) and select Let support in.",
      "Access ends by itself. Select End now to close it early.",
    ],
    wrong: ["You can't see the support access section: only the owner or an admin can let support in."],
  },
  {
    slug: "staff-app",
    title: "Use the staff app on your phone",
    roles: ["staff", "manager", "owner", "hr"],
    intro: "The staff app is where staff see news, ask for letters, find their files and keep their contact details up to date. It works in the phone's browser, and you can add it to your home screen like any other app.",
    steps: [
      "Open the invitation email on your phone and set your password, or sign in at the usual address.",
      "Staff go straight to the staff app. Managers and HR can switch between the staff app and the office view with the button at the top.",
      "On Android, tap Install when the app offers it. On iPhone, open it in Safari, tap Share, then Add to Home Screen.",
      "Home shows company news and quick links. Requests shows what you've asked for, and anything waiting for your decision.",
      "Me is where you update your phone number and address, add emergency contacts, choose notifications and turn on two-step sign-in.",
    ],
    wrong: [
      '"Your login isn\'t linked to a staff profile": ask HR to link your login to your profile in Workspace → People & access.',
      "No Install button on iPhone: Apple only allows adding apps from Safari, using Share → Add to Home Screen.",
      "It says you're offline: check your data or Wi-Fi and tap Try again. Nothing you entered is lost until you send it.",
    ],
  },
  {
    slug: "ask-for-a-letter",
    title: "Ask for a letter from your phone",
    roles: ["staff"],
    intro: "You can ask HR for letters such as an employment certificate, a salary certificate or a no objection letter.",
    steps: [
      "In the staff app, open Requests and choose A letter.",
      "Pick the letter, say what it's for, and who it should be addressed to if the bank or office asked for that.",
      "Tap Send request. Your manager or HR approves it, and HR prepares it on company letterhead.",
      "You get a notification when it's ready. Tap Download on the letter.",
    ],
    wrong: [
      "The letter you need isn't in the list: HR decides which letters can be asked for. Ask them directly.",
      "Your request was declined: the note from the person who declined it is shown under the request.",
    ],
  },
  {
    slug: "clock-in",
    title: "Clock in and out on your phone",
    roles: ["staff"],
    intro: "Open the staff app and use the Time tab. It checks where you are if your company uses location check, and works out if you're late or doing overtime.",
    steps: [
      "Tap Time at the bottom of the staff app.",
      "Tap Clock in when you start. If your phone asks to share your location, allow it. Some companies also ask for a quick photo.",
      "Tap Start break and End break for your breaks, if your company tracks them.",
      "Tap Clock out when you finish. You'll see how long you worked.",
      "Forgot to clock in or out? Scroll down to Forgot to clock in or out, fill in the times and what happened, and send it to your manager.",
    ],
    wrong: [
      '"You need to be at…": you\'re outside your work location. Clock in when you arrive, or ask your manager to fix the time.',
      "It says you're already clocked in: clock out first, or ask for a fix if you forgot yesterday.",
      "Location doesn't work: in your phone's settings, allow location for your browser or the app.",
    ],
  },
  {
    slug: "ask-for-time-off",
    title: "Ask for time off",
    roles: ["staff"],
    intro: "You can see what you have left and ask for time off from your phone.",
    steps: [
      "In the staff app, open Requests and choose Time off (or tap Time off on Home).",
      "Your balances are at the top. The number is what you can still ask for.",
      "Choose the type, first and last day, and whether any day is a half day. The app shows how many working days it uses. Rest days and public holidays don't count.",
      "Add a note, and a document if the type needs one (for example a medical certificate for longer sick leave).",
      "Tap Send request. You'll get a notification when your manager answers.",
    ],
    wrong: [
      '"Not enough … left": you\'ve used or asked for more days than you have. Choose fewer days or ask HR.',
      '"You already have time off on some of those days": you have another request for those dates. Cancel it first in Your time off.',
    ],
  },
  {
    slug: "roster-and-time",
    title: "Plan the roster and check who's in",
    roles: ["owner", "hr", "manager"],
    intro: "Put shifts on a weekly roster, publish it so staff see it, and follow clock-ins on the Time page.",
    steps: [
      "First add your shifts in Workspace → Tools → Time & shifts, for example Morning 07:00 to 15:00.",
      "Open Time → Roster. Pick a shift or Rest day for each person and day. Each change saves straight away.",
      "Use Copy last week to start from the previous week. Select Publish when you're ready; staff see published shifts in their app.",
      "The Time page shows who's in, who's late, who hasn't arrived and anything that needs checking, like a clock-in outside the work location.",
      "To fix a day yourself, select the pencil next to the person. Late minutes, hours and overtime are worked out for you.",
    ],
    wrong: [
      "Staff can't see their shifts: the week isn't published yet. Select Publish on the roster.",
      "Lateness looks wrong: check the person was on the right shift that day, and the grace period in Workspace → Tools → Time & shifts.",
    ],
  },
  {
    slug: "timesheets",
    title: "Prepare and approve timesheets",
    roles: ["owner", "hr"],
    intro: "Timesheets add up each person's days, hours, lateness and overtime for a period. Approved timesheets are what payroll uses.",
    steps: [
      "Open Time → Timesheets.",
      "Choose the period, for example the 1st to the last day of the month, and select Add up this period.",
      "Check the numbers. If a day is wrong, fix it on the Time page and add up again.",
      "Select Approve on each person, or Approve all. Download CSV if you want a copy.",
    ],
    wrong: ["A number didn't change after you fixed a day: approved timesheets are locked. Select Reopen, then add up again."],
  },
  {
    slug: "manage-time-off",
    title: "Approve time off and keep balances right",
    roles: ["owner", "hr", "manager"],
    intro: "Requests arrive in Requests and on the Time off page. Balances update themselves when you approve, decline or cancel.",
    steps: [
      "Open Time off. Waiting requests show Approve and Decline. The Calendar shows who else is off, so you can spot clashes.",
      "To enter time off for someone who told you in person, select Enter time off. It's approved straight away.",
      "On the Balances tab you can see everyone's days left. Select Change a balance to add or take away days, with a reason.",
      "At the start of a new year, open that year on the Balances tab and select Set up. Unused days carry over up to each type's limit.",
      "To cancel approved time off (for example someone came back early), select Cancel on the request. The days go back.",
    ],
    wrong: [
      "A balance looks too low: hover over it to see what was given, carried over, changed and used.",
      "You can't approve a request: it may be waiting for someone else first. Check who approves what in Workspace → Who approves what.",
    ],
  },
  {
    slug: "run-payroll",
    title: "Run payroll each month",
    roles: ["owner", "hr"],
    intro: "A pay run works out everyone's pay from their salary, allowances, time records, unpaid time off, claims and loans, then takes off pension and tax. Nothing is final until you finalize it.",
    steps: [
      "Before your first run, check pay day, pension and tax rates in Payroll → Pay settings, and add everyone's basic salary and bank account on their profile.",
      "Open Payroll and select New pay run. The dates are filled in for you. Select Create and calculate.",
      "Check the list. Select a person to see every line of their pay. Anything in red must be fixed first; yellow is worth a look.",
      "Need a bonus or a correction? Select the person, then Add a one-off amount. To leave someone out this month, select Put on hold.",
      "Changed something on a profile? Select Calculate again.",
      "When it's right, select Finalize. Payslips appear in everyone's staff app, loan repayments are recorded and claims are marked paid.",
      "Download the bank transfer list for your bank, then select Mark as paid once the money has gone.",
    ],
    wrong: [
      '"No salary on their profile": add their basic salary on the Salary & bank tab, then calculate again.',
      "A finalized run was wrong: select Reverse with a reason. Loans and claims go back, and you can create the run again.",
      "Pension or tax looks wrong: the rates are starting points. Check them with the Pension Office and MIRA and update them in Pay settings.",
    ],
  },
  {
    slug: "allowances-and-loans",
    title: "Add allowances, deductions and loans",
    roles: ["owner", "hr"],
    intro: "Regular extras like housing or food allowance, and loans or salary advances, are set on each person's profile and included in every pay run.",
    steps: [
      "First add the pay items your company uses in Payroll → Pay settings, for example Housing allowance or Uniform deduction.",
      "Open the person in People, then the Salary & bank tab.",
      "Under Allowances and deductions, select Add, choose the item and the monthly amount, and the date it starts.",
      "Under Loans and advances, select Add, enter the amount and how much to take off each month.",
      "To stop an allowance, select Stop. Loans can be paused or cancelled.",
    ],
    wrong: ["You can't see the Salary & bank tab: only people the owner allows can see and change pay."],
  },
  {
    slug: "send-a-claim",
    title: "Send a claim",
    roles: ["staff"],
    intro: "Get paid back for work costs like taxis, meals and travel.",
    steps: [
      "In the staff app, open Requests and choose A claim.",
      "Choose the type, the date and the amount. For transport, add where from and to.",
      "Take a photo of the receipt.",
      "Tap Send claim. Your manager approves it, and it's paid with your next pay (or separately, if your company does that).",
    ],
    wrong: [
      '"Claims can be up to…": that type has a limit. Split it or speak to your manager.',
      "It says it will be paid next month: it was sent after this month's cut-off day.",
    ],
  },
  {
    slug: "approve-and-pay-claims",
    title: "Approve and pay claims",
    roles: ["owner", "hr", "manager"],
    intro: "Claims arrive in Requests and on the Claims page, with the receipt photo.",
    steps: [
      "Open Claims. Waiting shows claims to decide. Select the paperclip to see the receipt.",
      "Select Approve, or Decline with a note.",
      "Approved claims paid through payroll are added to the next pay run automatically.",
      "For claims you pay separately, open To be paid, tick them, and select Mark as paid once you've paid them.",
      "Limits, cut-off days and whether each type is paid through payroll are in Claims → Claim types.",
    ],
    wrong: ["A claim isn't on the pay run: check it's approved and its type is paid through payroll, then calculate the run again."],
  },
  {
    slug: "your-payslip",
    title: "See your payslip",
    roles: ["staff"],
    intro: "Your payslips are in the staff app as soon as payroll is finalized each month.",
    steps: [
      "Tap Pay at the bottom of the staff app.",
      "The top shows your last pay. Tap Open payslip to see or save the PDF.",
      "Older payslips are listed underneath.",
    ],
    wrong: ["No payslip yet: it appears once your company finalizes payroll for the month. Ask HR if it's late."],
  },
];

export function guidesFor(role: HelpRole): HelpGuide[] {
  return HELP_GUIDES.filter((g) => g.roles.includes(role));
}

export function getGuide(slug: string): HelpGuide | undefined {
  return HELP_GUIDES.find((g) => g.slug === slug);
}
