/**
 * ============================================================
 *  APP CONFIGURATION — the one file to edit for your brand.
 * ============================================================
 *  Change the product name, contact details, prices
 *  and default rates here. Everything in the app reads from
 *  this file, so you never have to hunt through the code.
 *
 *  After editing, save the file. If the app is running
 *  locally it refreshes by itself; on Vercel, push the change
 *  and it redeploys automatically.
 * ============================================================
 */

export const appConfig = {
  // ----------------------------------------------------------
  // Brand
  // ----------------------------------------------------------
  brand: {
    /** Product name shown everywhere (navbar, emails, PDFs, browser tab). */
    name: "Harbor",
    /** Short name used on the phone home screen when staff install the app. */
    shortName: "Harbor",
    /**
     * The "by Nuit Works" credit. Every link to it is built by nuitWorksUrl()
     * in src/lib/brand.ts, which adds the tracking parameters.
     */
    byline: {
      text: "by Nuit Works",
      studio: "Nuit Works",
      url: "https://nuit.works",
    },
    tagline: "Staff, shifts and pay, handled in one place.",
    description: "People, time, pay and paperwork for businesses in the Maldives. Answer a few questions and switch on only the tools you need.",
    /** Your company's legal name for the footer, Terms and Privacy pages. */
    legalName: "Nuit Works",
    supportEmail: "support@example.com",
    salesEmail: "hello@example.com",
    /** WhatsApp number with country code, digits only (used for the chat button). */
    whatsappNumber: "9607000000",
    /** The public web address (no trailing slash). Link previews and search results use it. */
    siteUrl: "https://harbor.nuit.works",
    /** The short description in link previews (WhatsApp, iMessage, Discord…) and search results. */
    shareDescription: "HR, time, leave and payroll in one place, built for businesses in the Maldives.",
  },

  // ----------------------------------------------------------
  // Colours, fonts, radius and the marketing colour blobs live in
  // src/app/globals.css (the "DESIGN TOKENS" block at the top).
  // ----------------------------------------------------------

  // ----------------------------------------------------------
  // Defaults for new businesses (each business can change these
  // in its own Settings).
  // ----------------------------------------------------------
  defaults: {
    country: "MV",
    currency: "MVR",
    timezone: "Indian/Maldives",
    dateFormat: "DD/MM/YYYY",
    /** 0 = Sunday. The Maldives working week usually starts on Sunday. */
    weekStart: 0,
    /** Working days: 0 = Sunday ... 6 = Saturday. */
    workingDays: [0, 1, 2, 3, 4],
    standardHoursPerDay: 8,
  },

  // ----------------------------------------------------------
  // Free trial
  // ----------------------------------------------------------
  trial: {
    /** Length of the free trial in days. */
    days: 30,
  },

  // ----------------------------------------------------------
  // Billing (payments are made by bank transfer or mobile payment
  // and confirmed by you in the admin panel; there's no card payment)
  // ----------------------------------------------------------
  billing: {
    /** Days a company keeps full access after its trial or paid period ends. (The database uses the same 7.) */
    graceDays: 7,
    /** Shown to company owners in Workspace → Billing. Leave empty until you have them; nothing is shown then. */
    bankTransfer: {
      bankName: "",
      accountName: "",
      accountNumber: "",
      /** Optional, e.g. "Or pay by BML mobile transfer to 7xxxxxx". */
      otherWays: "",
    },
    /** Where owners send their payment receipt. Empty = the support email above. */
    receiptEmail: "",
  },

  // ----------------------------------------------------------
  // PLACEHOLDER PRICES — replace with your real prices.
  // Every plan pays the foundation base fee (people directory,
  // requests, letters & files, access & roles, staff app).
  // Each extra tool is an add-on:
  //   add-on price = base + (perPerson × number of people)
  // ----------------------------------------------------------
  pricing: {
    currency: "MVR",
    foundation: { base: 450, perPerson: 10 },
    tools: {
      recruitment: { base: 250, perPerson: 0 },
      onboarding: { base: 0, perPerson: 3 },
      attendance: { base: 0, perPerson: 8 },
      leave: { base: 0, perPerson: 5 },
      compliance: { base: 0, perPerson: 4 },
      payroll: { base: 200, perPerson: 12 },
      claims: { base: 0, perPerson: 4 },
      learning: { base: 150, perPerson: 4 },
      performance: { base: 0, perPerson: 5 },
    },
  },

  // ----------------------------------------------------------
  // Default statutory & HR rates.
  //
  // IMPORTANT: These are STARTING POINTS ONLY. Laws and rates
  // change. Before running real payroll, check the current
  // rates with MIRA (tax) and the Maldives Pension
  // Administration Office (pension). Every business can edit
  // these in Settings → Payroll.
  // ----------------------------------------------------------
  rates: {
    pension: {
      name: "Maldives Retirement Pension Scheme",
      employeeRate: 7,
      employerRate: 7,
      appliesTo: "locals" as const,
      note: "Applies to Maldivian employees. Verify the current rates with the Pension Office.",
    },
    incomeTax: {
      name: "Employment income tax (monthly)",
      basis: "monthly" as const,
      note: "Starting brackets only. Verify the current brackets with MIRA before running payroll.",
      brackets: [
        { lower: 0, upper: 60000, rate: 0 },
        { lower: 60000, upper: 100000, rate: 5.5 },
        { lower: 100000, upper: 150000, rate: 8 },
        { lower: 150000, upper: 200000, rate: 12 },
        { lower: 200000, upper: null, rate: 15 },
      ],
    },
    overtime: {
      weekday: 1.25,
      restDay: 1.5,
      publicHoliday: 1.5,
    },
    attendance: {
      graceMinutes: 10,
      halfDayMinHours: 4,
    },
    /** Starting leave entitlements (days per year). Check the Employment Act for current values. */
    leave: [
      {
        code: "AL",
        name: "Annual leave",
        days: 30,
        paid: true,
        accrual: "monthly" as const,
        carryForward: 0,
        gender: "any" as const,
        requiresDocument: false,
      },
      {
        code: "SL",
        name: "Sick leave",
        days: 30,
        paid: true,
        accrual: "upfront" as const,
        carryForward: 0,
        gender: "any" as const,
        requiresDocument: true,
      },
      {
        code: "FRL",
        name: "Family responsibility leave",
        days: 10,
        paid: true,
        accrual: "upfront" as const,
        carryForward: 0,
        gender: "any" as const,
        requiresDocument: false,
      },
      {
        code: "ML",
        name: "Maternity leave",
        days: 60,
        paid: true,
        accrual: "upfront" as const,
        carryForward: 0,
        gender: "female" as const,
        requiresDocument: true,
      },
      {
        code: "PL",
        name: "Paternity leave",
        days: 3,
        paid: true,
        accrual: "upfront" as const,
        carryForward: 0,
        gender: "male" as const,
        requiresDocument: false,
      },
      {
        code: "UL",
        name: "Unpaid leave",
        days: 0,
        paid: false,
        accrual: "none" as const,
        carryForward: 0,
        gender: "any" as const,
        requiresDocument: false,
      },
    ],
  },

  // ----------------------------------------------------------
  // Email sending
  // ----------------------------------------------------------
  email: {
    /** Which email service to use: "resend" or "console" (prints emails in the terminal, for testing). */
    provider: "resend" as "resend" | "console",
    fromName: "Harbor",
    /** Must be an address on a domain you have verified with your email provider. */
    fromAddress: "no-reply@harbor.nuit.works",
  },
} as const;

export type AppConfig = typeof appConfig;
