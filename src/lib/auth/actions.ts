"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, siteUrl } from "@/lib/env";
import { safeNextPath } from "@/lib/utils";
import { ACTIVE_BUSINESS_COOKIE, getMyBusinesses, requireUser } from "./session";

export interface FormState {
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Values to put back into the form after an error. */
  values?: Record<string, string>;
}

const NOT_CONNECTED: FormState = {
  error: "The app isn't connected to Supabase yet. Follow the setup steps in the README first.",
};

async function origin(): Promise<string> {
  // Online, always the real web address: confirmation and reset links must
  // land on the same address the session cookie belongs to.
  if (process.env.NODE_ENV === "production") return siteUrl();
  const h = await headers();
  return h.get("origin") ?? siteUrl();
}

async function clientInfo() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
    ua: h.get("user-agent"),
  };
}

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");
const password = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Use 72 characters or fewer.")
  .regex(/[A-Za-z]/, "Include at least one letter.")
  .regex(/[0-9]/, "Include at least one number.");

function str(fd: FormData, key: string): string {
  const v = fd.get(key);
  return typeof v === "string" ? v : "";
}

// ---------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------
export async function signInWithPassword(_: FormState, fd: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONNECTED;
  const parsed = z.object({ email, password: z.string().min(1, "Enter your password.") }).safeParse({
    email: str(fd, "email"),
    password: str(fd, "password"),
  });
  const values = { email: str(fd, "email") };
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    if (error.code === "email_not_confirmed") {
      return {
        error: "Please confirm your email address first. We've sent you a link; check your inbox (and spam folder).",
        values,
      };
    }
    if (error.status === 429) return { error: "Too many attempts. Please wait a minute and try again.", values };
    return { error: "That email and password don't match. Please try again.", values };
  }

  const { ip, ua } = await clientInfo();
  await supabase.rpc("log_sign_in", { p_ip: ip, p_user_agent: ua });
  redirect(safeNextPath(str(fd, "next")));
}

export async function sendMagicLink(_: FormState, fd: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONNECTED;
  const parsed = email.safeParse(str(fd, "email"));
  const values = { email: str(fd, "email") };
  if (!parsed.success) return { fieldErrors: { email: parsed.error.issues.map((i) => i.message) }, values };

  const supabase = await createClient();
  const next = safeNextPath(str(fd, "next"));
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error?.status === 429) return { error: "Too many emails requested. Please wait a minute and try again.", values };
  // Same message whether or not the account exists, so emails can't be discovered.
  return {
    message: `If ${parsed.data} has an account, a sign-in link is on its way. It works once and expires in 1 hour.`,
    values,
  };
}

// ---------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------
export async function signUp(_: FormState, fd: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONNECTED;
  const method = str(fd, "method") === "magic" ? "magic" : "password";
  const values = {
    full_name: str(fd, "full_name"),
    email: str(fd, "email"),
    phone: str(fd, "phone"),
    method,
  };

  const base = z.object({
    full_name: z.string().trim().min(2, "Enter your full name.").max(120, "That name is too long."),
    email,
    phone: z
      .string()
      .trim()
      .max(30, "That phone number is too long.")
      .regex(/^[+0-9 ()-]*$/, "Use numbers only, with an optional + at the start."),
  });
  const schema =
    method === "password"
      ? base
          .extend({ password, confirm_password: z.string() })
          .refine((d) => d.password === d.confirm_password, { path: ["confirm_password"], message: "The passwords don't match." })
      : base;

  const parsed = schema.safeParse({
    full_name: values.full_name,
    email: values.email,
    phone: values.phone,
    password: str(fd, "password"),
    confirm_password: str(fd, "confirm_password"),
  });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors, values };

  const supabase = await createClient();
  const next = safeNextPath(str(fd, "next"), "/onboarding");
  const redirectTo = `${await origin()}/auth/callback?next=${encodeURIComponent(next)}`;
  const profile = { full_name: parsed.data.full_name, phone: parsed.data.phone || null };

  if (method === "password") {
    const { data, error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: str(fd, "password"),
      options: { data: profile, emailRedirectTo: redirectTo },
    });
    if (error) {
      if (error.status === 429) return { error: "Too many sign-ups from here. Please wait a minute and try again.", values };
      if (error.code === "weak_password") return { fieldErrors: { password: [error.message] }, values };
      return { error: "We couldn't create your account. Please check your details and try again.", values };
    }
    // Email confirmation switched off in Supabase: the user is signed in straight away.
    if (data.session) redirect(next);
  } else {
    const { error } = await supabase.auth.signInWithOtp({
      email: parsed.data.email,
      options: { shouldCreateUser: true, data: profile, emailRedirectTo: redirectTo },
    });
    if (error) {
      if (error.status === 429) return { error: "Too many emails requested. Please wait a minute and try again.", values };
      return { error: "We couldn't send your sign-in link. Please try again.", values };
    }
  }

  redirect(`/verify-email?email=${encodeURIComponent(parsed.data.email)}&method=${method}`);
}

export async function resendVerification(_: FormState, fd: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONNECTED;
  const parsed = email.safeParse(str(fd, "email"));
  if (!parsed.success) return { error: "Enter a valid email address." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data,
    options: { emailRedirectTo: `${await origin()}/auth/callback?next=/app` },
  });
  if (error?.status === 429) return { error: "Please wait a minute before asking for another email." };
  return { message: "We've sent the email again. It can take a minute or two to arrive." };
}

// ---------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------
export async function requestPasswordReset(_: FormState, fd: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONNECTED;
  const parsed = email.safeParse(str(fd, "email"));
  const values = { email: str(fd, "email") };
  if (!parsed.success) return { fieldErrors: { email: parsed.error.issues.map((i) => i.message) }, values };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${await origin()}/auth/callback?next=/reset-password`,
  });
  if (error?.status === 429) return { error: "Too many emails requested. Please wait a minute and try again.", values };
  return { message: `If ${parsed.data} has an account, we've emailed a link to choose a new password.`, values };
}

export async function updatePassword(_: FormState, fd: FormData): Promise<FormState> {
  if (!isSupabaseConfigured()) return NOT_CONNECTED;
  await requireUser("/reset-password");
  const parsed = z
    .object({ password, confirm_password: z.string() })
    .refine((d) => d.password === d.confirm_password, { path: ["confirm_password"], message: "The passwords don't match." })
    .safeParse({ password: str(fd, "password"), confirm_password: str(fd, "confirm_password") });
  if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (error.code === "same_password") return { fieldErrors: { password: ["Choose a password you haven't used before."] } };
    if (error.code === "weak_password") return { fieldErrors: { password: [error.message] } };
    return { error: "We couldn't update your password. The link may have expired; please request a new one." };
  }
  redirect("/app?notice=password-updated");
}

// ---------------------------------------------------------------------
// Sign out & business switching
// ---------------------------------------------------------------------
export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  (await cookies()).delete(ACTIVE_BUSINESS_COOKIE);
  redirect("/login?notice=signed-out");
}

export async function switchBusiness(fd: FormData): Promise<void> {
  const user = await requireUser();
  const businessId = str(fd, "business_id");
  const businesses = await getMyBusinesses();
  // Only businesses the user really belongs to can be selected.
  if (!businesses.some((b) => b.business_id === businessId)) redirect("/app");

  (await cookies()).set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  const supabase = await createClient();
  await supabase.from("profiles").update({ last_business_id: businessId }).eq("id", user.id);
  redirect(safeNextPath(str(fd, "next"), "/app"));
}
