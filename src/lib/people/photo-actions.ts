"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getActiveBusiness, requireUser, toAccessContext } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/modules/access";

/**
 * Profile pictures. The browser crops the picture to a square and shrinks
 * it before sending, so files are small. Only people who can edit staff
 * profiles (owners, admins, HR) add pictures: for anyone in their company,
 * and for themselves.
 * Files go to the public "avatars" bucket under random names.
 */
const TYPES: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };
const MAX_BYTES = 400_000;
const UUID = /^[0-9a-f-]{36}$/i;

async function removeFiles(paths: (string | null | undefined)[], allowedPrefixes: string[]) {
  const doomed = paths.filter((p): p is string => Boolean(p) && allowedPrefixes.some((pre) => p!.startsWith(pre)));
  if (doomed.length) await createAdminClient().storage.from("avatars").remove(doomed);
}

function readFile(form: FormData): File | string {
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return "Choose a picture first.";
  if (!TYPES[file.type]) return "Use a JPG, PNG or WebP picture.";
  if (file.size > MAX_BYTES) return "That picture is too large. Try a smaller one.";
  return file;
}

/** Sets a picture for yourself ("me") or, for admins, for a staff member (their id). */
export async function uploadPicture(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  const target = String(form.get("target") ?? "");
  const file = readFile(form);
  if (typeof file === "string") return { error: file };
  const ext = TYPES[file.type];
  const supabase = await createClient();
  const admin = createAdminClient();

  // Pictures are added by people who look after staff profiles (owners, admins, HR), not by staff themselves.
  if (!active || !can(toAccessContext(active), "employees", "edit")) return { error: "Pictures are added by your HR team." };

  if (target === "me") {
    const path = `users/${user.id}/${randomUUID()}.${ext}`;
    const [{ data: profile }, { data: me }] = await Promise.all([
      supabase.from("profiles").select("avatar_path").eq("id", user.id).maybeSingle(),
      active?.employee_id ? supabase.from("employees").select("photo_path").eq("id", active.employee_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const { error: upErr } = await admin.storage.from("avatars").upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
    if (upErr) return { error: "Couldn't save the picture. Please try again." };
    const { error } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", user.id);
    if (error) {
      await removeFiles([path], [`users/${user.id}/`]);
      return { error: friendly(error.message) };
    }
    if (active?.employee_id) {
      const { error: empErr } = await supabase.rpc("set_my_photo", { p_business: active.business_id, p_path: path });
      if (empErr) return { error: friendly(empErr.message) };
    }
    const mine = [`users/${user.id}/`];
    if (active?.employee_id) mine.push(`${active.business_id}/${active.employee_id}/`);
    await removeFiles([profile?.avatar_path, me?.photo_path].filter((p) => p !== path), mine);
    revalidatePath("/", "layout");
    return { ok: true, message: "Picture updated." };
  }

  if (!UUID.test(target)) return { error: "Choose a person first." };
  const { data: emp } = await supabase.from("employees").select("id, photo_path").eq("id", target).eq("business_id", active.business_id).maybeSingle();
  if (!emp) return { error: "That person isn't in this company." };
  const path = `${active.business_id}/${emp.id}/${randomUUID()}.${ext}`;
  const { error: upErr } = await admin.storage.from("avatars").upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (upErr) return { error: "Couldn't save the picture. Please try again." };
  const { data: updated, error } = await supabase.from("employees").update({ photo_path: path }).eq("id", emp.id).eq("business_id", active.business_id).select("id");
  if (error || !updated?.length) {
    await removeFiles([path], [`${active.business_id}/${emp.id}/`]);
    return { error: error ? friendly(error.message) : "You can't change this person's picture." };
  }
  // Only files an admin added are removed here; a person's own upload stays as their account picture.
  await removeFiles([emp.photo_path], [`${active.business_id}/${emp.id}/`]);
  revalidatePath("/", "layout");
  return { ok: true, message: "Picture updated." };
}

/** Removes the picture, going back to initials. */
export async function removePicture(target: string): Promise<ActionResult> {
  const user = await requireUser();
  const active = await getActiveBusiness();
  const supabase = await createClient();
  if (!active || !can(toAccessContext(active), "employees", "edit")) return { error: "Pictures are added by your HR team." };

  if (target === "me") {
    const { data: profile } = await supabase.from("profiles").select("avatar_path").eq("id", user.id).maybeSingle();
    const { error } = await supabase.from("profiles").update({ avatar_path: null }).eq("id", user.id);
    if (error) return { error: friendly(error.message) };
    if (active?.employee_id) await supabase.rpc("set_my_photo", { p_business: active.business_id, p_path: null });
    await removeFiles([profile?.avatar_path], [`users/${user.id}/`]);
    revalidatePath("/", "layout");
    return { ok: true, message: "Picture removed." };
  }

  if (!UUID.test(target) || !active) return { error: "Choose a person first." };
  if (!can(toAccessContext(active), "employees", "edit")) return { error: "You can't change pictures for other people." };
  const { data: emp } = await supabase.from("employees").select("id, photo_path").eq("id", target).eq("business_id", active.business_id).maybeSingle();
  if (!emp) return { error: "That person isn't in this company." };
  const { error } = await supabase.from("employees").update({ photo_path: null }).eq("id", emp.id).eq("business_id", active.business_id);
  if (error) return { error: friendly(error.message) };
  await removeFiles([emp.photo_path], [`${active.business_id}/${emp.id}/`]);
  revalidatePath("/", "layout");
  return { ok: true, message: "Picture removed." };
}
