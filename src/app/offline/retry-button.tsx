"use client";

import { Button } from "@/components/ui/button";

export function RetryButton() {
  return (
    <Button size="lg" onClick={() => window.location.reload()}>
      Try again
    </Button>
  );
}
