"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Coffee, MapPin } from "lucide-react";
import { ActionForm, CheckboxField, TextareaField, TextField } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { clockIn, clockOut, requestTimeFix, toggleBreak } from "@/lib/time/actions";
import { cn } from "@/lib/utils";

type Loc = { lat: number; lng: number; accuracy: number | null } | null;

/** Asks the phone for its location. Resolves to null if the person says no or it takes too long. */
function getLocation(): Promise<Loc> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  });
}

function Elapsed({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60000));
  return (
    <span className="tabular">
      {Math.floor(mins / 60)}h {String(mins % 60).padStart(2, "0")}m
    </span>
  );
}

/** The big button: clock in, break, clock out. */
export function ClockPanel({
  businessId,
  employeeId,
  state,
  since,
  sinceText,
  shiftText,
  needsLocation,
  needsSelfie,
  allowBreaks,
  doneText,
}: {
  businessId: string;
  employeeId: string;
  state: "out" | "in" | "break" | "done";
  since: string | null;
  sinceText: string;
  shiftText: string;
  needsLocation: boolean;
  needsSelfie: boolean;
  allowBreaks: boolean;
  doneText: string;
}) {
  const [pending, start] = useTransition();
  const [step, setStep] = useState<string | null>(null);
  const photo = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const doClockIn = (file?: File) =>
    start(async () => {
      setStep("Checking where you are…");
      const location = await getLocation();
      if (!location && needsLocation) {
        setStep(null);
        toast.error("Turn on location for this site in your phone settings, then try again.");
        return;
      }
      let selfiePath: string | null = null;
      if (file) {
        setStep("Uploading your photo…");
        const ext = file.type === "image/png" ? "png" : "jpg";
        selfiePath = `${businessId}/attendance/${employeeId}/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.${ext}`;
        const { error } = await createClient().storage.from("tenant-files").upload(selfiePath, file, { contentType: file.type || "image/jpeg" });
        if (error) {
          setStep(null);
          toast.error("The photo didn't upload. Check your connection and try again.");
          return;
        }
      }
      setStep("Clocking in…");
      const r = await clockIn({ location, selfiePath });
      setStep(null);
      if (r.error) return void toast.error(r.error);
      if (r.flagged) toast.warning("You're outside your work location, so your manager will see a note.");
      toast.success(r.message ?? "Clocked in.");
      router.refresh();
    });

  const doClockOut = () =>
    start(async () => {
      setStep("Clocking out…");
      const location = await getLocation();
      const r = await clockOut({ location });
      setStep(null);
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Clocked out.");
      router.refresh();
    });

  const doBreak = () =>
    start(async () => {
      const r = await toggleBreak();
      if (r.error) return void toast.error(r.error);
      toast.success(r.message ?? "Done.");
      router.refresh();
    });

  return (
    <section className="rounded-2xl border border-border-strong p-6 text-center">
      <p className="text-sm text-muted-foreground">{shiftText ? `Today: ${shiftText}` : "No shift on your roster today"}</p>
      {state === "done" ? (
        <>
          <p className="mt-6 font-display text-2xl">Done for today</p>
          <p className="mt-1 text-sm text-muted-foreground tabular">{doneText}</p>
        </>
      ) : state === "out" ? (
        <>
          <input
            ref={photo}
            type="file"
            accept="image/*"
            capture="user"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) doClockIn(f);
            }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => (needsSelfie ? photo.current?.click() : doClockIn())}
            className="mx-auto mt-6 grid size-44 place-items-center rounded-full bg-accent font-display text-2xl text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            <span className="flex flex-col items-center gap-2">
              {needsSelfie && <Camera className="size-6" aria-hidden />}
              Clock in
            </span>
          </button>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-subtle-foreground">
            <MapPin className="size-3.5" aria-hidden />
            {needsSelfie ? "Takes a quick photo and checks your location" : "Checks your location if your phone allows it"}
          </p>
        </>
      ) : (
        <>
          <p className={cn("mt-6 font-display text-4xl", state === "break" && "text-muted-foreground")}>{since && <Elapsed since={since} />}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {state === "break" ? "On a break" : "Working"} since {sinceText}
          </p>
          <div className="mt-6 grid gap-3">
            <Button size="lg" className="h-14 text-lg" loading={pending && step === "Clocking out…"} disabled={pending} onClick={doClockOut}>
              Clock out
            </Button>
            {allowBreaks && (
              <Button size="lg" variant="secondary" className="h-12" disabled={pending} onClick={doBreak}>
                <Coffee className="size-4" aria-hidden /> {state === "break" ? "End break" : "Start break"}
              </Button>
            )}
          </div>
        </>
      )}
      {step && (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          {step}
        </p>
      )}
    </section>
  );
}

export function TimeFixForm({ today }: { today: string }) {
  const router = useRouter();
  return (
    <ActionForm action={requestTimeFix} submitLabel="Send to my manager" pendingLabel="Sending…" resetOnSuccess onSuccess={() => router.refresh()}>
      <TextField name="work_date" label="Day" type="date" max={today} defaultValue={today} />
      <div className="grid grid-cols-2 gap-3">
        <TextField name="clock_in" label="Started" type="time" optional />
        <TextField name="clock_out" label="Finished" type="time" optional />
      </div>
      <CheckboxField name="next_day" label="Finished after midnight" />
      <TextareaField name="reason" label="What happened" placeholder="For example forgot to clock out after the dinner shift" />
    </ActionForm>
  );
}
