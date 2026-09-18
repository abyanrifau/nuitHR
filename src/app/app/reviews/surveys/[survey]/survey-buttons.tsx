"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteSurvey, setSurveyStatus } from "@/lib/reviews/actions";

export function SurveyButtons({ id, status }: { id: string; status: string }) {
  const [confirm, setConfirm] = useState<"open" | "close" | "delete" | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const act = () =>
    start(async () => {
      const r = confirm === "delete" ? await deleteSurvey(id) : await setSurveyStatus(id, confirm === "open" ? "open" : "closed");
      const was = confirm;
      setConfirm(null);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Done.");
      if (was === "delete") router.push("/app/reviews/surveys");
      else router.refresh();
    });
  return (
    <>
      {status === "draft" && (
        <>
          <Button variant="ghost" disabled={pending} onClick={() => setConfirm("delete")}>
            Delete
          </Button>
          <Button disabled={pending} onClick={() => setConfirm("open")}>
            Open survey
          </Button>
        </>
      )}
      {status === "open" && (
        <Button variant="secondary" disabled={pending} onClick={() => setConfirm("close")}>
          Close survey
        </Button>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={confirm === "open" ? "Open this survey?" : confirm === "close" ? "Close this survey?" : "Delete this survey?"}
        confirmLabel={confirm === "open" ? "Open" : confirm === "close" ? "Close" : "Delete"}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => act()}
      >
        {confirm === "open"
          ? "Everyone it's for gets a notification. Save any changes first; questions can't be changed once it's open."
          : confirm === "close"
            ? "Nobody can reply after this. The results stay."
            : "It hasn't been sent, so nothing is lost."}
      </ConfirmDialog>
    </>
  );
}
