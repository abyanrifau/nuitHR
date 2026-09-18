"use client";

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "staff-install-dismissed";

/**
 * Registers the service worker, and offers to add the app to the home
 * screen. Android shows an Install button; iPhone needs Share → Add to
 * Home Screen, so we explain that instead.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {}
    if (standalone || dismissed) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as InstallEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    const t = setTimeout(() => {
      if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
        setIos(true);
        setHidden(false);
      }
    }, 0);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  if (hidden) return null;
  return (
    <div className="mb-6 flex items-start gap-3 rounded-xl border border-border-strong p-4">
      <div className="min-w-0 flex-1 text-sm">
        <p className="text-foreground">Add this app to your home screen</p>
        {ios ? (
          <p className="mt-1 text-muted-foreground">
            Tap <Share className="inline size-3.5 align-[-2px]" aria-label="Share" /> at the bottom of Safari, then <span className="text-foreground">Add to Home Screen</span>.
          </p>
        ) : (
          <p className="mt-1 text-muted-foreground">Open it with one tap, like any other app. No app store needed.</p>
        )}
        {event && (
          <Button
            size="sm"
            className="mt-3"
            onClick={async () => {
              await event.prompt();
              await event.userChoice;
              dismiss();
            }}
          >
            <Download className="size-3.5" aria-hidden /> Install
          </Button>
        )}
      </div>
      <button type="button" onClick={dismiss} aria-label="Not now" className="rounded-md p-1 text-muted-foreground hover:text-foreground">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
