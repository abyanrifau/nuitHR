import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { safeNextPath } from "@/lib/utils";

const TYPES: EmailOtpType[] = ["signup", "invite", "magiclink", "recovery", "email_change", "email"];

/**
 * Alternative landing for email links that carry a "token_hash" instead of a
 * code. These work even when the link is opened on a different device.
 * (Used if you switch the Supabase email templates to the token-hash style,
 * see README → "Email templates".)
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const fallbackNext = type === "recovery" ? "/reset-password" : "/app";
  const next = safeNextPath(url.searchParams.get("next"), fallbackNext);

  if (tokenHash && type && TYPES.includes(type) && isSupabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      await supabase.rpc("log_sign_in", {
        p_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        p_user_agent: request.headers.get("user-agent"),
      });
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  const login = new URL("/login", url.origin);
  login.searchParams.set("error", "link");
  return NextResponse.redirect(login);
}
