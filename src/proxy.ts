import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { siteUrl } from "@/lib/env";

/**
 * Runs before every page request:
 *  1. keeps the user's sign-in session fresh (Supabase cookies), and
 *  2. sends signed-out visitors to the login page when they open a
 *     private area (/app, /staff, /onboarding).
 *
 * This is only a convenience redirect. Every private page also checks
 * the user on the server, and the database enforces access itself.
 */
const PRIVATE_PREFIXES = ["/app", "/staff", "/onboarding"];
const AUTH_PAGES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  // One address only. Vercel also serves the site at <project>.vercel.app,
  // and a sign-in saved on one address doesn't exist on the other, so anyone
  // arriving there is moved to the real address, keeping the page they wanted.
  const canonical = canonicalRedirect(request);
  if (canonical) return NextResponse.redirect(canonical, 308);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    // Not connected to Supabase yet: let pages render their own "setup needed" message.
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [h, v] of Object.entries(headers ?? {})) response.headers.set(h, v);
      },
    },
  });

  // Validates the session token and refreshes it if needed. Do not remove.
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims?.sub;

  const path = request.nextUrl.pathname;

  // The platform admin area: anyone not on the PLATFORM_ADMIN_EMAILS list gets
  // exactly the same 404 as for a page that doesn't exist. (The admin pages
  // check again on the server, including two-step sign-in, for everyone else.)
  if (path === "/admin" || path.startsWith("/admin/")) {
    const email = typeof data?.claims?.email === "string" ? data.claims.email.toLowerCase() : "";
    const admins = (process.env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (!email || !admins.includes(email)) {
      const hidden = request.nextUrl.clone();
      hidden.pathname = "/_hidden-not-found";
      hidden.search = "";
      return NextResponse.rewrite(hidden, { headers: response.headers });
    }
  }

  const isPrivate = PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));

  if (isPrivate && !signedIn) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    login.searchParams.set("next", path + request.nextUrl.search);
    return redirectWithCookies(login, response);
  }

  // Two-step sign-in: people who switched it on must enter their code before private pages open.
  if (isPrivate && signedIn && data?.claims?.aal !== "aal2") {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const verify = request.nextUrl.clone();
      verify.pathname = "/two-step";
      verify.search = "";
      verify.searchParams.set("next", path + request.nextUrl.search);
      return redirectWithCookies(verify, response);
    }
  }

  if (signedIn && AUTH_PAGES.includes(path)) {
    const home = request.nextUrl.clone();
    home.pathname = "/app";
    home.search = "";
    return redirectWithCookies(home, response);
  }

  return response;
}

/** The same page on the real web address, or null if we're already on it. */
function canonicalRedirect(request: NextRequest): URL | null {
  if (process.env.VERCEL_ENV !== "production") return null;
  const wanted = new URL(siteUrl());
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  if (!wanted.host || !host || host === wanted.host) return null;
  // Only ever send someone once. If the address they came from sends them
  // straight back (a redirect set up on the domain itself), the mark below
  // is still on the web address, and they stay where they are instead of
  // bouncing between the two forever.
  if (request.nextUrl.searchParams.has(SENT_HOME)) return null;
  const to = new URL(request.nextUrl.pathname + request.nextUrl.search, wanted.origin);
  to.searchParams.set(SENT_HOME, "1");
  return to;
}

const SENT_HOME = "_h";

function redirectWithCookies(to: URL, from: NextResponse) {
  const redirect = NextResponse.redirect(to);
  for (const c of from.cookies.getAll()) redirect.cookies.set(c);
  return redirect;
}

export const config = {
  matcher: [
    // Everything except static files, images and the service worker.
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
