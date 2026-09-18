"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { saveChannel, sendTestEmail } from "@/lib/notifications/actions";

export function ChannelsPanel({ canEdit, emailOn, lastTested }: { canEdit: boolean; emailOn: boolean; lastTested: string | null }) {
  const [on, setOn] = useState(emailOn);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <section className="space-y-3">
      <div className="rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-foreground">In the app</p>
            <p className="text-[13px] text-muted-foreground">The bell at the top of every page. Always on.</p>
          </div>
          <Badge tone="success">On</Badge>
        </div>
      </div>
      <div className="rounded-xl border border-border p-5">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-foreground">Email</p>
            <p className="text-[13px] text-muted-foreground">Requests waiting for a decision, decisions, letters ready and exports ready.</p>
            {lastTested && <p className="mt-1 text-[12px] text-subtle-foreground">Last test: {lastTested}</p>}
          </div>
          <Switch
            checked={on}
            disabled={!canEdit || pending}
            label="Send emails"
            onChange={(v) => {
              setOn(v);
              start(async () => {
                const r = await saveChannel({ channel: "email", enabled: v });
                if (r.error) {
                  setOn(!v);
                  toast.error(r.error);
                } else toast.success(v ? "Emails are on." : "Emails are off.");
              });
            }}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await sendTestEmail();
              if (r.error) toast.error(r.error);
              else toast.success(r.message ?? "Sent.");
              router.refresh();
            })
          }
        >
          <Send className="size-3.5" aria-hidden /> Send me a test email
        </Button>
      </div>
      {[
        { key: "sms", label: "Text messages (SMS)" },
        { key: "whatsapp", label: "WhatsApp" },
      ].map((c) => (
        <div key={c.key} className="rounded-xl border border-border p-5 opacity-70">
          <div className="flex flex-wrap items-start gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-foreground">{c.label}</p>
              <p className="text-[13px] text-muted-foreground">Not available yet. We&apos;ll let you know when you can connect it.</p>
            </div>
            <Badge>Coming later</Badge>
          </div>
        </div>
      ))}
    </section>
  );
}
