"use server";

import { revalidatePath } from "next/cache";
import { getActiveBusiness, requireUser } from "@/lib/auth/session";
import { friendly, type ActionResult } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

/** Whether colleagues see your birthday in Celebrations on Home. */
export async function setBirthdayHidden(hidden: boolean): Promise<ActionResult> {
  await requireUser();
  const active = await getActiveBusiness();
  if (!active) return { error: "Choose a company first." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_my_birthday_hidden", { p_business: active.business_id, p_hidden: hidden });
  if (error) return { error: friendly(error.message) };
  revalidatePath("/", "layout");
  return { ok: true, message: hidden ? "Your birthday is hidden from colleagues." : "Colleagues will see your birthday (day and month only)." };
}
