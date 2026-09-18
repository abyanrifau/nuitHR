import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page";
import { StatusDot } from "@/components/ui/table";
import { getStaffContext } from "@/lib/staff/context";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Surveys" };

interface MySurvey {
  id: string;
  title: string;
  description: string | null;
  is_anonymous: boolean;
  closes_at: string | null;
  answered: boolean;
}

export default async function StaffSurveys() {
  const { active, me, supabase } = await getStaffContext();
  if (!me) return <Alert tone="warning">Your login isn&apos;t linked to a staff profile yet. Ask HR to link it.</Alert>;
  const { data } = await supabase.rpc("my_surveys", { p_business: active.business_id });
  const surveys = (data ?? []) as MySurvey[];

  return (
    <div className="space-y-6">
      <PageHeader back={{ href: "/staff", label: "Home" }} title="Surveys" description="Tell your company how things are going. Anonymous surveys never show your name." />
      {surveys.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {surveys.map((s) => (
            <li key={s.id}>
              {s.answered ? (
                <div className="flex min-h-16 items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground">{s.title}</span>
                    <span className="mt-1 block">
                      <StatusDot tone="success">You&apos;ve answered, thank you</StatusDot>
                    </span>
                  </span>
                </div>
              ) : (
                <Link href={`/staff/surveys/${s.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-accent-soft">
                  <span className="min-w-0 flex-1">
                    <span className="block text-foreground">{s.title}</span>
                    <span className="block text-[12px] text-subtle-foreground">
                      {s.is_anonymous ? "Anonymous" : "Your name is shown"}
                      {s.closes_at && ` · closes ${formatDate(new Date(new Date(s.closes_at).getTime() - 1000).toISOString(), active.date_format, active.timezone)}`}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-subtle-foreground" aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-border-strong p-6 text-center text-sm text-muted-foreground">No surveys open right now.</p>
      )}
    </div>
  );
}
