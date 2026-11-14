"use client";

import { useEffect } from "react";

import { captureInstallPrompt } from "./install";

const REFRESH_EVERY_MS = 30 * 60 * 1000;

/*
 * Registers public/sw.js (SPEC addendum B) in production builds and catches Chrome's install
 * prompt for the More menu's "Install app". While online, it also asks the
 * service worker to refresh its copy of the offline pages now and then, so after a deploy the
 * offline screens match the app. Development builds never register it (no stale caches there).
 */
export function ServiceWorker() {
  useEffect(() => captureInstallPrompt(), []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(async () => {
        const registration = await navigator.serviceWorker.ready;
        const last = Number(sessionStorage.getItem("loandesk-offline-refresh") ?? 0);
        if (navigator.onLine && Date.now() - last > REFRESH_EVERY_MS) {
          sessionStorage.setItem("loandesk-offline-refresh", String(Date.now()));
          registration.active?.postMessage({ type: "refresh" });
        }
      })
      .catch(() => undefined);
  }, []);
  return null;
}
