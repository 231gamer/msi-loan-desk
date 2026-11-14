"use client";

import { useLinkStatus } from "next/link";
import { useEffect, useRef, useState } from "react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/** Small turning ring in the current text colour. Decorative: the busy element carries the state. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-testid="spinner"
      className={cn(
        "inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent",
        className,
      )}
    />
  );
}

/**
 * Put inside a next/link <Link>: shows a spinner while the page the link opens is loading
 * (Next.js useLinkStatus). Renders nothing when the page is already prefetched and opens at once.
 */
export function LinkPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={className} /> : null;
}

/** Put inside a <Link> around its icon: the icon becomes a spinner while the page loads. */
export function LinkPendingIcon({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={className} /> : children;
}

/**
 * Submit button for plain HTML forms (GET filters, sign-out) that navigate instead of calling a
 * server action. When its form is submitted through it, it turns busy (spinner, aria-busy) and
 * stops a second click until the next page arrives. Coming back with the browser's Back button
 * (page restored from the cache) makes it ready again.
 */
export function SubmitButton({ children, onClick, ref: outerRef, ...props }: React.ComponentProps<"button">) {
  const ref = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (form === null || form === undefined) return;
    const onSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented) return;
      if (event.submitter === null || event.submitter === ref.current) setBusy(true);
    };
    const onShow = () => setBusy(false);
    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onShow);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  return (
    <button
      ref={(node) => {
        ref.current = node;
        // A wrapper (for example a tooltip trigger) may need the element too.
        if (typeof outerRef === "function") outerRef(node);
        else if (outerRef !== null && outerRef !== undefined) outerRef.current = node;
      }}
      type="submit"
      aria-busy={busy}
      {...props}
      onClick={(event) => {
        // A second click while the first submit is on its way would only send it again.
        if (busy) event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </button>
  );
}
