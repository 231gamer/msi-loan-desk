/*
 * Offline field cash (SPEC addendum B): the rules shared by the phone (IndexedDB queue, provisional
 * slip) and the server (sync route). Pure functions only, so they are unit-tested.
 *
 * The phone never decides anything about money: a queued payment is only a request. The server
 * records it through record_field_payment, dated the day it arrives, and the request key makes a
 * second send return the same payment.
 */
import { formatDateTime } from "@/lib/format";

/** How long the officer's saved list stays on the phone without a sync (agreed with Foday). */
export const OFFLINE_KEEP_HOURS = 72;
const KEEP_MS = OFFLINE_KEEP_HOURS * 60 * 60 * 1000;

/** The longest transaction reference an officer can type offline; the rest is the collection time. */
export const OFFLINE_REFERENCE_MAX = 60;

/** True when a list saved at `savedAt` (ms) is too old to show, or comes from a clock in the future. */
export function isExpired(savedAt: number, now: number): boolean {
  return !Number.isFinite(savedAt) || now - savedAt > KEEP_MS || savedAt - now > KEEP_MS;
}

/** The short reference printed on the provisional slip: "OFF-3F9A2C" from the request key. */
export function slipReference(key: string): string {
  return `OFF-${key
    .replace(/[^0-9a-f]/gi, "")
    .slice(0, 6)
    .toUpperCase()}`;
}

/**
 * The payment reference sent to the server. It records when the money was really collected, because
 * the payment itself is dated the day it reaches the server:
 *   cash  -> "Collected offline 14 Nov 2026, 10:32"
 *   other -> "MM-12345 · collected offline 14 Nov 2026, 10:32"
 */
export function offlineReference(method: string, reference: string, collectedAt: Date): string {
  const when = formatDateTime(collectedAt);
  if (method === "cash") return `Collected offline ${when}`;
  return `${reference.trim().slice(0, OFFLINE_REFERENCE_MAX)} · collected offline ${when}`;
}

/** What the phone does with a queued payment after the server answered. */
export type SyncResult = "sent" | "retry" | "failed";

/**
 * Server errors that will never succeed on a retry (the loan closed, more than owed, another
 * branch's loan...). Anything else, including an outage, is retried later.
 */
const PERMANENT = new Set([
  "FORBIDDEN",
  "OVERPAYMENT",
  "INVALID_STATE",
  "INVALID_INPUT",
  "REFERENCE_REQUIRED",
  "DATE_NOT_ALLOWED",
  "PERIOD_LOCKED",
]);

export function syncResultFor(code: string): SyncResult {
  return PERMANENT.has(code) ? "failed" : "retry";
}
