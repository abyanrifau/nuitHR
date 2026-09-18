/**
 * Country, currency and time-zone lists for dropdowns. Names come from the
 * browser/server's built-in international data, so every country works.
 */
const COUNTRY_CODES =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );

/** Sensible currency & time zone when a country is picked (the user can still change them). */
export const COUNTRY_DEFAULTS: Record<string, { currency: string; timezone: string }> = {
  MV: { currency: "MVR", timezone: "Indian/Maldives" },
  IN: { currency: "INR", timezone: "Asia/Kolkata" },
  LK: { currency: "LKR", timezone: "Asia/Colombo" },
  BD: { currency: "BDT", timezone: "Asia/Dhaka" },
  NP: { currency: "NPR", timezone: "Asia/Kathmandu" },
  PK: { currency: "PKR", timezone: "Asia/Karachi" },
  AE: { currency: "AED", timezone: "Asia/Dubai" },
  SA: { currency: "SAR", timezone: "Asia/Riyadh" },
  QA: { currency: "QAR", timezone: "Asia/Qatar" },
  SG: { currency: "SGD", timezone: "Asia/Singapore" },
  MY: { currency: "MYR", timezone: "Asia/Kuala_Lumpur" },
  TH: { currency: "THB", timezone: "Asia/Bangkok" },
  ID: { currency: "IDR", timezone: "Asia/Jakarta" },
  PH: { currency: "PHP", timezone: "Asia/Manila" },
  SC: { currency: "SCR", timezone: "Indian/Mahe" },
  MU: { currency: "MUR", timezone: "Indian/Mauritius" },
  GB: { currency: "GBP", timezone: "Europe/London" },
  US: { currency: "USD", timezone: "America/New_York" },
  AU: { currency: "AUD", timezone: "Australia/Sydney" },
  DE: { currency: "EUR", timezone: "Europe/Berlin" },
  FR: { currency: "EUR", timezone: "Europe/Paris" },
  IT: { currency: "EUR", timezone: "Europe/Rome" },
};

export function countryOptions(): { value: string; label: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return COUNTRY_CODES.map((c) => ({ value: c, label: names.of(c) ?? c })).sort((a, b) => a.label.localeCompare(b.label));
}

export function currencyOptions(): { value: string; label: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "currency" });
  return Intl.supportedValuesOf("currency")
    .map((c) => ({ value: c, label: `${c} (${names.of(c) ?? c})` }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

export function timezoneOptions(): { value: string; label: string }[] {
  return Intl.supportedValuesOf("timeZone").map((z) => ({ value: z, label: z.replace(/_/g, " ") }));
}

export const DATE_FORMATS = [
  { value: "DD/MM/YYYY", label: "DD/MM/YYYY (31/12/2026)" },
  { value: "MM/DD/YYYY", label: "MM/DD/YYYY (12/31/2026)" },
  { value: "YYYY-MM-DD", label: "YYYY-MM-DD (2026-12-31)" },
  { value: "DD MMM YYYY", label: "DD MMM YYYY (31 Dec 2026)" },
];

/** Formats an amount in the business's currency, e.g. "MVR 1,250". */
export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(amount)}`;
}
