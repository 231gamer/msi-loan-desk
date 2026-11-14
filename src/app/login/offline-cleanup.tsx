"use client";

import { useEffect } from "react";

import { clearAfterSignOut, offlineStoreAvailable } from "@/lib/offline/store";

/*
 * The sign-in page is where every sign-out lands (the button, an expired or ended session), so it
 * wipes the saved Field cash list and sent payments from the phone (SPEC addendum B). Payments
 * not yet sent stay until they are.
 */
export function OfflineCleanup() {
  useEffect(() => {
    if (offlineStoreAvailable()) void clearAfterSignOut().catch(() => undefined);
  }, []);
  return null;
}
