import { Skeleton } from "@/components/ui/page";

/**
 * What a page shows the moment you click through to it, while its data
 * loads. One shape per kind of page, so the layout doesn't jump when the
 * real content arrives. Used by the loading.tsx file in each route folder.
 */
function Status({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-6">
      {children}
    </div>
  );
}

function Header() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-64 max-w-full" />
    </div>
  );
}

/** A list or table page: heading, filters, rows. */
export function ListLoading() {
  return (
    <Status>
      <Header />
      <div className="flex gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-7 w-20 rounded-full" />
        ))}
      </div>
      <div className="space-y-px overflow-hidden rounded-xl border border-border">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-none" />
        ))}
      </div>
    </Status>
  );
}

/** One record: heading, then details beside a side panel. */
export function DetailLoading() {
  return (
    <Status>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-9 w-72 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
        <Skeleton className="h-56" />
      </div>
    </Status>
  );
}

/** A form or settings page. */
export function FormLoading() {
  return (
    <Status>
      <Header />
      <div className="max-w-2xl space-y-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-10" />
          </div>
        ))}
        <Skeleton className="h-10 w-32" />
      </div>
    </Status>
  );
}

/** Calendars, rosters and charts. */
export function GridLoading() {
  return (
    <Status>
      <Header />
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 35 }, (_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    </Status>
  );
}

/** Staff app pages (phone layout): stacked cards. */
export function StaffLoading() {
  return (
    <Status>
      <Skeleton className="h-8 w-40" />
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </Status>
  );
}
