"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setCelebrationsEnabled } from "@/lib/company/actions";

/** Company setting: show the Celebrations card on Home for everyone. */
export function CelebrationsSetting({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const [on, setOn] = useOptimistic(enabled);
  const [, start] = useTransition();
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4"
        checked={on}
        disabled={!canEdit}
        onChange={(e) =>
          start(async () => {
            setOn(e.target.checked);
            const r = await setCelebrationsEnabled(e.target.checked);
            if (r.error) toast.error(r.error);
            else toast.success(r.message ?? "Saved.");
          })
        }
      />
      <span>
        <span className="block text-foreground">Show Celebrations on Home</span>
        <span className="block text-[13px] text-muted-foreground">
          Birthdays this week (day and month only), work anniversaries, new joiners and company news, for everyone including staff. Staff can hide their own birthday.
        </span>
      </span>
    </label>
  );
}
