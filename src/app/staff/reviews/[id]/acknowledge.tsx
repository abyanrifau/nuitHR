"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { acknowledgeReview } from "@/lib/reviews/actions";

export function AcknowledgeForm({ reviewId }: { reviewId: string }) {
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <h2 className="text-lg">Sign off</h2>
      <p className="text-sm text-muted-foreground">Signing off means you&apos;ve read it, not that you agree with everything. Add a comment if you want to.</p>
      <Field label="Your comment" htmlFor="ack-comment" optional>
        <Textarea id="ack-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
      </Field>
      <Button
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await acknowledgeReview(reviewId, comment.trim());
            if (r.error) return void toast.error(r.error);
            toast.success(r.message ?? "Done.");
            router.refresh();
          })
        }
      >
        I&apos;ve read my review
      </Button>
    </section>
  );
}
