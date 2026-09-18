import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { safeNextPath } from "@/lib/utils";
import { TwoStepForm } from "./two-step-form";

export const metadata: Metadata = { title: "Enter your code" };

export default async function TwoStepPage({ searchParams }: PageProps<"/two-step">) {
  const params = await searchParams;
  return (
    <>
      <div className="space-y-2">
        <h1 className="text-3xl sm:text-4xl">Enter your code</h1>
        <p className="text-sm text-muted-foreground">Open your authenticator app and type the 6-digit code for this account.</p>
      </div>
      <Card>
        <CardContent className="p-6">
          <TwoStepForm next={safeNextPath(params.next)} />
        </CardContent>
      </Card>
    </>
  );
}
