import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
