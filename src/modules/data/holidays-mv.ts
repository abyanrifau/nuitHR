/**
 * Maldives public holidays, loaded as a STARTING POINT when Leave is set up.
 *
 * Islamic holidays follow the moon, so their dates are estimates and can
 * move by a day. Every business can edit this list, and should check it
 * against the official government announcements each year.
 */
export interface HolidaySeed {
  date: string; // YYYY-MM-DD
  name: string;
}

const MV: Record<number, HolidaySeed[]> = {
  2026: [
    { date: "2026-01-01", name: "New Year's Day" },
    { date: "2026-02-18", name: "First day of Ramadan (estimated)" },
    { date: "2026-03-20", name: "Eid al-Fitr (estimated)" },
    { date: "2026-03-21", name: "Eid al-Fitr holiday (estimated)" },
    { date: "2026-03-22", name: "Eid al-Fitr holiday (estimated)" },
    { date: "2026-05-01", name: "Labour Day" },
    { date: "2026-05-26", name: "Hajj Day (estimated)" },
    { date: "2026-05-27", name: "Eid al-Adha (estimated)" },
    { date: "2026-05-28", name: "Eid al-Adha holiday (estimated)" },
    { date: "2026-05-29", name: "Eid al-Adha holiday (estimated)" },
    { date: "2026-06-16", name: "Islamic New Year (estimated)" },
    { date: "2026-07-26", name: "Independence Day" },
    { date: "2026-08-14", name: "National Day (estimated)" },
    { date: "2026-08-25", name: "Birth of the Prophet (estimated)" },
    { date: "2026-09-13", name: "The Day Maldives Embraced Islam (estimated)" },
    { date: "2026-11-03", name: "Victory Day" },
    { date: "2026-11-11", name: "Republic Day" },
  ],
  2027: [
    { date: "2027-01-01", name: "New Year's Day" },
    { date: "2027-02-08", name: "First day of Ramadan (estimated)" },
    { date: "2027-03-10", name: "Eid al-Fitr (estimated)" },
    { date: "2027-03-11", name: "Eid al-Fitr holiday (estimated)" },
    { date: "2027-03-12", name: "Eid al-Fitr holiday (estimated)" },
    { date: "2027-05-01", name: "Labour Day" },
    { date: "2027-05-16", name: "Hajj Day (estimated)" },
    { date: "2027-05-17", name: "Eid al-Adha (estimated)" },
    { date: "2027-05-18", name: "Eid al-Adha holiday (estimated)" },
    { date: "2027-05-19", name: "Eid al-Adha holiday (estimated)" },
    { date: "2027-06-06", name: "Islamic New Year (estimated)" },
    { date: "2027-07-26", name: "Independence Day" },
    { date: "2027-08-04", name: "National Day (estimated)" },
    { date: "2027-08-15", name: "Birth of the Prophet (estimated)" },
    { date: "2027-09-03", name: "The Day Maldives Embraced Islam (estimated)" },
    { date: "2027-11-03", name: "Victory Day" },
    { date: "2027-11-11", name: "Republic Day" },
  ],
};

/** Holidays for this year and next, for the given country (only the Maldives is pre-loaded). */
export function holidaySeeds(country: string, today = new Date()): HolidaySeed[] {
  if (country !== "MV") return [];
  const year = today.getFullYear();
  return [...(MV[year] ?? []), ...(MV[year + 1] ?? [])].filter((h) => h.date >= `${year}-01-01`);
}
