"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { duplicatePayItem, setPayItemActive } from "@/lib/payroll/component-actions";

/** Duplicate and archive (or bring back) from the list. Editing opens the item. */
export function ItemActions({ id, isActive }: { id: string; isActive: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <span className="flex shrink-0 gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await duplicatePayItem(id);
            if (r.error) return void toast.error(r.error);
            toast.success(r.message ?? "Copied.");
            router.push(`/app/payroll/allowances/${r.id}`);
          })
        }
      >
        <Copy className="size-3.5" aria-hidden /> Duplicate
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await setPayItemActive(id, !isActive);
            if (r.error) return void toast.error(r.error);
            toast.success(r.message ?? "Saved.");
            router.refresh();
          })
        }
      >
        {isActive ? <Archive className="size-3.5" aria-hidden /> : <ArchiveRestore className="size-3.5" aria-hidden />} {isActive ? "Archive" : "Bring back"}
      </Button>
    </span>
  );
}
