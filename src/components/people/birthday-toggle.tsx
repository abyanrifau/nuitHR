"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { setBirthdayHidden } from "@/lib/people/self-actions";

/** Staff choose whether their birthday shows in Celebrations. Only the day and month are ever shown. */
export function BirthdayToggle({ hidden }: { hidden: boolean }) {
  const [value, setValue] = useOptimistic(hidden);
  const [, start] = useTransition();
  return (
    <label className="flex items-start gap-3 text-sm">
      <input
        type="checkbox"
        className="mt-0.5 size-4"
        checked={!value}
        onChange={(e) =>
          start(async () => {
            setValue(!e.target.checked);
            const r = await setBirthdayHidden(!e.target.checked);
            if (r.error) toast.error(r.error);
            else toast.success(r.message ?? "Saved.");
          })
        }
      />
      <span>
        <span className="block text-foreground">Show my birthday to colleagues</span>
        <span className="block text-[13px] text-muted-foreground">It appears in Celebrations on Home in the week of your birthday, with the day and month only, never the year.</span>
      </span>
    </label>
  );
}
