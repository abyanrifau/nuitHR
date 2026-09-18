"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ActionForm, SelectField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { cancelRequest, createDelegation, revokeDelegation } from "@/lib/requests/actions";

interface Delegation {
  id: string;
  who: string;
  from: string;
  to: string;
  reason: string | null;
}

export function CancelButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await cancelRequest(id);
          if (r.error) toast.error(r.error);
          else {
            toast.success("Request cancelled.");
            router.refresh();
          }
        })
      }
    >
      Cancel
    </Button>
  );
}

function EndButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={pending}
      onClick={() =>
        start(async () => {
          const r = await revokeDelegation(id);
          if (r.error) toast.error(r.error);
          else {
            toast.success("Stand-in ended.");
            router.refresh();
          }
        })
      }
    >
      End now
    </Button>
  );
}

/** Choose a colleague to decide your requests while you're away. */
export function StandInPanel({ today, people, mine, forOthers }: { today: string; people: { value: string; label: string }[]; mine: Delegation[]; forOthers: Delegation[] }) {
  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <section>
        <h2 className="text-lg">Going away?</h2>
        <p className="mb-5 text-sm text-muted-foreground">Pick someone to decide your requests between two dates. You can still decide them yourself too.</p>
        {people.length === 0 ? (
          <p className="text-sm text-subtle-foreground">Invite a colleague first. Only people who can sign in can stand in.</p>
        ) : (
          <ActionForm action={createDelegation} submitLabel="Set stand-in" resetOnSuccess>
            <SelectField name="delegate_user_id" label="Who will stand in" options={people} placeholder="Choose a person" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField name="starts_at" label="From" type="date" defaultValue={today} min={today} />
              <TextField name="ends_at" label="Until" type="date" min={today} />
            </div>
            <TextField name="reason" label="Reason" placeholder="For example annual leave" optional />
          </ActionForm>
        )}
      </section>
      <section className="space-y-8">
        <List title="Standing in for you" empty="Nobody is standing in for you." items={mine} canEnd />
        <List title="You're standing in for" empty="You aren't standing in for anyone." items={forOthers} />
      </section>
    </div>
  );
}

function List({ title, empty, items, canEnd }: { title: string; empty: string; items: Delegation[]; canEnd?: boolean }) {
  return (
    <div>
      <h2 className="mb-3 text-lg">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-subtle-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {items.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-foreground">{d.who}</p>
                <p className="text-[13px] text-muted-foreground tabular">
                  {d.from} to {d.to}
                  {d.reason && ` · ${d.reason}`}
                </p>
              </div>
              {canEnd && <EndButton id={d.id} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
