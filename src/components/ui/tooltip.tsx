"use client";

import { Tooltip as Primitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/* One provider at the root: a short delay before the first tooltip, then instant while moving. */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <Primitive.Provider delayDuration={350} skipDelayDuration={250}>
      {children}
    </Primitive.Provider>
  );
}

/**
 * Hover and keyboard-focus hint for a link or button (the child must accept a ref and props).
 * The child keeps its own accessible name; the tip is linked to it with aria-describedby while
 * shown. Touch screens do not show tips, so a tip only ever adds to what the control already says.
 */
export function Tooltip({
  content,
  side = "bottom",
  align = "center",
  hidden = false,
  children,
}: {
  content: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** Skip the tip (for example, a sidebar label that is already visible). */
  hidden?: boolean;
  children: React.ReactElement;
}) {
  if (hidden) return children;
  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>{children}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "z-50 max-w-64 rounded-control bg-ink px-2.5 py-1.5 text-xs leading-snug font-medium text-white shadow-lg",
            "animate-in duration-150 fade-in-0 zoom-in-95",
          )}
        >
          {content}
          <Primitive.Arrow className="fill-ink" width={10} height={5} />
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
