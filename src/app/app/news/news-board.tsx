"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Pin, Plus, Trash2 } from "lucide-react";
import { ActionForm, CheckboxField, SelectField, TextareaField, TextField } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/ui/page";
import { deletePost, savePost } from "@/lib/news/actions";
import type { ActionResult } from "@/lib/errors";

type Opt = { value: string; label: string };

interface Post {
  id: string;
  title: string;
  body: string;
  branch_id: string | null;
  department_id: string | null;
  is_pinned: boolean;
  state: string;
  publishedText: string;
  publishLocal: string;
  expiresLocal: string;
}

const STATE: Record<string, { label: string; tone: "success" | "info" | "neutral" }> = {
  live: { label: "Live", tone: "success" },
  scheduled: { label: "Scheduled", tone: "info" },
  draft: { label: "Draft", tone: "neutral" },
  ended: { label: "Ended", tone: "neutral" },
};

export function NewsBoard({
  canCreate,
  canEdit,
  canDelete,
  branches,
  departments,
  posts,
}: {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  branches: Opt[];
  departments: Opt[];
  posts: Post[];
}) {
  const [editing, setEditing] = useState<Post | "new" | null>(null);
  const [removing, setRemoving] = useState<Post | null>(null);
  const [when, setWhen] = useState("now");
  const router = useRouter();
  const current = editing === "new" ? null : editing;
  const action = useCallback((s: ActionResult, f: FormData) => savePost(current?.id ?? null, s, f), [current]);
  const audience = (p: Post) =>
    [p.branch_id && branches.find((b) => b.value === p.branch_id)?.label, p.department_id && departments.find((d) => d.value === p.department_id)?.label].filter(Boolean).join(" · ") || "Everyone";

  const open = (p: Post | "new") => {
    setWhen(p === "new" ? "now" : p.state === "draft" ? "draft" : p.state === "scheduled" ? "later" : "now");
    setEditing(p);
  };

  return (
    <div>
      {canCreate && (
        <Button className="mb-6" onClick={() => open("new")}>
          <Plus className="size-4" aria-hidden /> Post news
        </Button>
      )}
      {posts.length === 0 ? (
        <EmptyState title="No news yet" description="Share rosters, holidays, welcomes and reminders. Staff see it first when they open the app." />
      ) : (
        <ul className="space-y-3">
          {posts.map((p) => (
            <li key={p.id} className="rounded-xl border border-border p-5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-foreground">
                    {p.is_pinned && <Pin className="size-3.5 text-muted-foreground" aria-label="Pinned" />}
                    {p.title}
                    <Badge tone={STATE[p.state].tone}>{STATE[p.state].label}</Badge>
                  </p>
                  <p className="mt-0.5 text-[12px] text-subtle-foreground">
                    {audience(p)}
                    {p.publishedText && ` · ${p.state === "scheduled" ? "posts" : "posted"} ${p.publishedText}`}
                  </p>
                  <p className="mt-3 line-clamp-4 text-sm whitespace-pre-line text-muted-foreground">{p.body}</p>
                </div>
                <span className="flex shrink-0">
                  {canEdit && (
                    <Button variant="ghost" size="sm" aria-label={`Edit ${p.title}`} onClick={() => open(p)}>
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" size="sm" aria-label={`Remove ${p.title}`} onClick={() => setRemoving(p)}>
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={current ? "Edit news" : "Post news"} wide>
        {editing && (
          <ActionForm key={current?.id ?? "new"} action={action} onSuccess={() => setEditing(null)} submitLabel={when === "now" ? "Post" : when === "later" ? "Schedule" : "Save draft"}>
            <TextField name="title" label="Headline" defaultValue={current?.title} autoFocus />
            <TextareaField name="body" label="News" rows={7} defaultValue={current?.body} />
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField name="branch_id" label="Location" options={branches} placeholder="All locations" defaultValue={current?.branch_id ?? ""} optional />
              <SelectField name="department_id" label="Team" options={departments} placeholder="All teams" defaultValue={current?.department_id ?? ""} optional />
              <SelectField
                name="when"
                label="When"
                options={[
                  { value: "now", label: "Post now" },
                  { value: "later", label: "Schedule for later" },
                  { value: "draft", label: "Save as draft" },
                ]}
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
              {when === "later" ? <TextField name="publish_at" label="Post on" type="datetime-local" defaultValue={current?.publishLocal ?? ""} /> : <div className="hidden sm:block" />}
              <TextField name="expires_at" label="Take down after" type="date" hint="Leave empty to keep it up." defaultValue={current?.expiresLocal ?? ""} optional />
              <div className="flex items-end pb-2">
                <CheckboxField name="is_pinned" label="Keep at the top" defaultChecked={current?.is_pinned} />
              </div>
            </div>
            {when === "now" && <p className="text-[13px] text-subtle-foreground">Everyone it&apos;s for gets a notification.</p>}
          </ActionForm>
        )}
      </Modal>
      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove "${removing?.title}"?`}
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          const r = await deletePost(removing!.id);
          setRemoving(null);
          if (r.error) toast.error(r.error);
          else {
            toast.success("Removed.");
            router.refresh();
          }
        }}
      />
    </div>
  );
}
