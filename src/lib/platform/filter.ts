import "server-only";
import type { AdminBusiness } from "./data";

/** Search, filters and sorting for the companies list (shared by the page and the CSV export). */
export interface BusinessFilter {
  q?: string;
  status?: string;
  industry?: string;
  tool?: string;
  expiring?: string;
  sort?: string;
  dir?: string;
}

const DAY = 86_400_000;

export function filterBusinesses(all: AdminBusiness[], f: BusinessFilter): AdminBusiness[] {
  const q = f.q?.trim().toLowerCase();
  const now = Date.now();
  let rows = all.filter((b) => {
    if (q && ![b.name, b.owner?.name, b.owner?.email, b.owner?.phone, b.slug].some((v) => v?.toLowerCase().includes(q))) return false;
    if (f.status && b.status !== f.status) return false;
    if (f.industry && b.industry !== f.industry) return false;
    if (f.tool && !b.modules.includes(f.tool)) return false;
    if (f.expiring) {
      const days = Number(f.expiring) || 7;
      const t = b.ends_at ? new Date(b.ends_at).getTime() : null;
      if (!t || t < now || t > now + days * DAY) return false;
    }
    return true;
  });
  const key = f.sort ?? "created_at";
  const dir = f.dir === "asc" ? 1 : -1;
  const val = (b: AdminBusiness): string | number => {
    switch (key) {
      case "name":
        return b.name.toLowerCase();
      case "staff":
        return b.staff_count;
      case "price":
        return b.monthly_price;
      case "ends":
        return b.ends_at ?? "";
      case "active":
        return b.last_active ?? "";
      case "status":
        return b.status;
      default:
        return b.created_at;
    }
  };
  rows = [...rows].sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0));
  return rows;
}
