import type { ReactNode } from "react";
import { appConfig } from "@/config/app.config";
import { nuitWorksUrl, type NuitLocation } from "@/lib/brand";
import { cn } from "@/lib/utils";

/** A link to Nuit Works that opens in a new tab with tracking. Always small and muted. */
export function NuitLink({ location, children, className }: { location: NuitLocation; children?: ReactNode; className?: string }) {
  return (
    <a
      href={nuitWorksUrl(location)}
      target="_blank"
      rel="noopener"
      className={cn("underline-offset-4 transition-colors hover:text-foreground hover:underline", className)}
    >
      {children ?? appConfig.brand.byline.studio}
    </a>
  );
}

/** Small muted "by Nuit Works" line, e.g. under the wordmark. */
export function Byline({ location, className }: { location: NuitLocation; className?: string }) {
  return (
    <span className={cn("text-[12px] font-normal text-subtle-foreground", className)}>
      by <NuitLink location={location} />
    </span>
  );
}
