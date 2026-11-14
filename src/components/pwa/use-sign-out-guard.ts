"use client";

import { useTranslations } from "next-intl";
import type { FormEvent } from "react";

import { listQueue, offlineStoreAvailable } from "@/lib/offline/store";

/*
 * Sign-out forms (SPEC addendum B): when payments taken offline have not been sent, say so before
 * signing out. They stay on the phone either way and send at the next sign-in here.
 */
export function useSignOutGuard(): (event: FormEvent<HTMLFormElement>) => void {
  const t = useTranslations("offline.sync");
  return (event) => {
    const form = event.currentTarget;
    if (form.dataset.checked === "1" || !offlineStoreAvailable()) return;
    event.preventDefault();
    void listQueue()
      .then((items) => items.filter((item) => item.status === "pending").length)
      .catch(() => 0)
      .then((waiting) => {
        if (waiting > 0 && !window.confirm(t("signOutWarning", { count: waiting }))) return;
        form.dataset.checked = "1";
        form.requestSubmit();
      });
  };
}
