"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Fades and lifts its content in when it scrolls into view. Content is
 * visible straight away for people who prefer reduced motion, and for
 * anyone without JavaScript.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li";
}) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<"idle" | "hidden" | "shown">("idle");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.9) return; // already on screen: show immediately
    // Hide only once we know JavaScript and motion are available.
    setState("hidden");
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setState("shown");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as never}
      className={cn(
        "transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)]",
        state === "hidden" && "translate-y-4 opacity-0",
        state === "shown" && "translate-y-0 opacity-100",
        className,
      )}
      style={{ transitionDelay: state === "shown" ? `${delay}ms` : undefined }}
    >
      {children}
    </Tag>
  );
}
