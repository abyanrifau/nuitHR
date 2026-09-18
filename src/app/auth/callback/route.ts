import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/utils";

/**
 * Where email links land (confirm email, magic sign-in link, password reset).
 * Supabase adds a one-time "code" which we swap for a signed-in session.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));

  if (code && isSupabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await supabase.rpc("log_sign_in", {
        p_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        p_user_agent: request.headers.get("user-agent"),
      });
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  // Common causes: the link was already used, it expired, or it was opened in a
  // different browser from the one that asked for it. Email confirmation links
  // still confirm the address, so signing in normally will work.
  const login = new URL("/login", url.origin);
  login.searchParams.set("error", "link");
  if (next !== "/app") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}
