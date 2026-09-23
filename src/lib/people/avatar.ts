/**
 * Profile pictures live in the public "avatars" storage bucket under
 * random file names: `{business}/{employee}/{uuid}.webp` for pictures an
 * admin adds, `users/{user}/{uuid}.webp` for pictures people add themselves.
 */
export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return base ? `${base.replace(/\/$/, "")}/storage/v1/object/public/avatars/${path}` : null;
}

/** Two letters for when there's no picture: "Aishath Nasheed" → "AN". */
export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}
