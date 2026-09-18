import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Logins in a company with their names. Logins point at the sign-in
 * account rather than the profile table, so names are looked up in a
 * second step.
 */
export async function membersWithNames<T extends { user_id: string }>(supabase: SupabaseClient, rows: T[] | null) {
  const list = rows ?? [];
  const ids = [...new Set(list.map((r) => r.user_id))];
  const { data } = ids.length ? await supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const byId = new Map((data ?? []).map((p) => [p.id as string, p as { full_name: string | null; email: string | null }]));
  return list.map((r) => {
    const p = byId.get(r.user_id);
    return { ...r, name: p?.full_name || p?.email || "Someone", email: p?.email ?? "" };
  });
}
