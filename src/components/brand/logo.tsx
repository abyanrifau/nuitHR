import Link from "next/link";
import { appConfig } from "@/config/app.config";
import { cn } from "@/lib/utils";

/** Text-only wordmark, e.g. "[BRAND]." The name comes from the config file. */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("font-display text-lg tracking-[-0.03em] text-foreground", className)}>{appConfig.brand.name}.</span>;
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center", className)} aria-label={`${appConfig.brand.name} home`}>
      <Wordmark />
    </Link>
  );
}
