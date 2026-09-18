import type { Metadata } from "next";
import { Wordmark } from "@/components/brand/logo";
import { RetryButton } from "./retry-button";

export const metadata: Metadata = { title: "No connection" };

/** Shown by the staff app when the phone has no internet. Kept on the phone by the service worker. */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <Wordmark />
      <div className="space-y-2">
        <h1 className="text-3xl">You&apos;re offline</h1>
        <p className="measure text-sm text-muted-foreground">Your phone isn&apos;t connected to the internet. Check your data or Wi-Fi, then try again.</p>
      </div>
      <RetryButton />
    </main>
  );
}
