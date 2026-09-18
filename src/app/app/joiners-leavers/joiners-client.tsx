"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Plus, RotateCcw, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { setTaskStatus, startChecklist } from "@/lib/joiners/actions";

type Opt = { value: string; label: string };

export function StartChecklistButton({ people, templates }: { people: Opt[]; templates: (Opt & { kind: string })[] }) {
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [kind, setKind] = useState<"onboarding" | "offboarding">("onboarding");
  const [template, setTemplate] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const forKind = templates.filter((t) => t.kind === kind);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> Start a checklist
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Start a checklist" description="For someone already in People, for example staff who joined before you used this.">
        <div className="space-y-4">
          <Field label="Person" htmlFor="sc-person">
            <Select id="sc-person" options={people} placeholder="Choose a person" value={person} onChange={(e) => setPerson(e.target.value)} />
          </Field>
          <Field label="Joining or leaving" htmlFor="sc-kind">
            <Select
              id="sc-kind"
              options={[
                { value: "onboarding", label: "Joining" },
                { value: "offboarding", label: "Leaving" },
              ]}
              value={kind}
              onChange={(e) => (setKind(e.target.value as "onboarding" | "offboarding"), setTemplate(""))}
            />
          </Field>
          <Field label="Checklist" htmlFor="sc-tpl">
            <Select id="sc-tpl" options={forKind} placeholder="The usual one" value={template} onChange={(e) => setTemplate(e.target.value)} />
          </Field>
          <Button
            loading={pending}
            disabled={!person}
            onClick={() =>
              start(async () => {
                const r = await startChecklist(person, kind, template || undefined);
                if (r.error) return void toast.error(r.error);
                toast.success(r.message ?? "Started.");
                setOpen(false);
                if (r.id) router.push(`/app/joiners-leavers/${r.id}`);
              })
            }
          >
            Start
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** Tick a task off, skip it, or open it again. */
export function TaskButtons({ id, status, checklistId }: { id: string; status: string; checklistId?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (s: "todo" | "done" | "skipped") =>
    start(async () => {
      const r = await setTaskStatus(id, s, checklistId);
      if (r.error) return void toast.error(r.error);
      router.refresh();
    });
  if (status !== "todo") {
    return (
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => set("todo")} aria-label="Open again">
        <RotateCcw className="size-3.5" aria-hidden />
      </Button>
    );
  }
  return (
    <span className="flex gap-1">
      <Button variant="secondary" size="sm" loading={pending} onClick={() => set("done")}>
        <Check className="size-3.5" aria-hidden /> Done
      </Button>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => set("skipped")} aria-label="Skip" title="Doesn't apply">
        <SkipForward className="size-3.5" aria-hidden />
      </Button>
    </span>
  );
}
