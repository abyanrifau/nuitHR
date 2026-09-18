"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Globe } from "lucide-react";
import { ActionForm, CheckboxField, TextareaField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { saveCareersPage } from "@/lib/hiring/actions";

/** The public careers page: switch it on, write a short intro, copy the link. */
export function CareersSettings({ slug, enabled, intro, canEdit }: { slug: string; enabled: boolean; intro: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-border p-4">
      <Globe className="size-5 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-foreground">{enabled ? "Your careers page is live" : "Your careers page is off"}</p>
        <p className="text-[13px] text-subtle-foreground">{enabled ? "Share the link on social media or your website. Open roles marked for the careers page show there." : "Switch it on to let people apply online."}</p>
      </div>
      {enabled && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(`${window.location.origin}/careers/${slug}`);
            toast.success("Link copied.");
          }}
        >
          <Copy className="size-3.5" aria-hidden /> Copy link
        </Button>
      )}
      {canEdit && (
        <Button variant={enabled ? "ghost" : "primary"} size="sm" onClick={() => setOpen(true)}>
          {enabled ? "Settings" : "Switch on"}
        </Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Careers page">
        <ActionForm
          action={saveCareersPage}
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        >
          <CheckboxField name="careers_page_enabled" label="Careers page is live" defaultChecked />
          <TextareaField name="careers_intro" label="A few words about working with you" rows={4} defaultValue={intro} placeholder="For example: we're a family-run resort in Baa Atoll. Staff housing, meals and a day off a week." optional />
        </ActionForm>
      </Modal>
    </div>
  );
}
