/*
 * The phone's offline store (SPEC addendum B), in IndexedDB. Browser only.
 *
 *  - snapshot: the officer's own Field cash list (loan number, name, amounts, due date; no phone
 *    numbers, addresses or documents), saved each time /field opens with signal. Shown offline for
 *    OFFLINE_KEEP_HOURS, wiped on sign-out.
 *  - queue: payments taken offline. Each has the request key the server uses to record it once.
 *    An unsent payment is cash already collected, so it is never deleted automatically.
 *
 * public/sw.js opens the same database (same name, version and stores) to send the queue.
 */
import { isExpired } from "./rules";

const DB_NAME = "loandesk-offline";
const DB_VERSION = 1;
const SNAPSHOTS = "snapshots";
const QUEUE = "queue";

export interface SnapshotLoan {
  id: string;
  loanNo: string;
  customer: string;
  /** What to collect now (the installment due, or everything owed), in cents. */
  dueCents: string;
  /** Everything owed when the list was saved, in cents. */
  owedCents: string;
  dueDate: string | null;
}

export interface Snapshot {
  userId: string;
  userName: string;
  savedAt: number;
  loans: SnapshotLoan[];
}

export type QueueStatus = "pending" | "sent" | "failed";

export interface QueueItem {
  /** The request key (a UUID): the server records a key once, however often it is sent. */
  key: string;
  userId: string;
  loanId: string;
  loanNo: string;
  customer: string;
  amountCents: string;
  method: "cash" | "mobile_money" | "bank";
  /** Sent as the payment reference: the typed reference plus the collection time. */
  reference: string;
  collectedAt: string;
  status: QueueStatus;
  receiptNo?: string;
  paymentId?: string;
  errorCode?: string;
  sentAt?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: "userId" });
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is not available"));
  });
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (objects: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(store, mode);
      const request = work(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request === undefined ? undefined : request.result);
      transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export function offlineStoreAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

/** Saves this officer's list and removes any other user's list from the phone. */
export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await run(SNAPSHOTS, "readwrite", (objects) => {
    objects.clear();
    objects.put(snapshot);
  });
}

/** The saved list if it is recent enough; an expired list is deleted on the way. */
export async function readSnapshot(now = Date.now()): Promise<Snapshot | null> {
  const all = (await run<Snapshot[]>(SNAPSHOTS, "readonly", (objects) => objects.getAll())) ?? [];
  const current = all[0];
  if (current === undefined) return null;
  if (isExpired(current.savedAt, now)) {
    await clearSnapshots();
    return null;
  }
  return current;
}

/** Removes the saved list. */
export async function clearSnapshots(): Promise<void> {
  await run(SNAPSHOTS, "readwrite", (objects) => {
    objects.clear();
  });
}

/** Sign-out: the list and the sent payments go; unsent payments stay until they are sent. */
export async function clearAfterSignOut(): Promise<void> {
  await clearSnapshots();
  const items = await listQueue();
  const sent = items.filter((item) => item.status === "sent").map((item) => item.key);
  if (sent.length > 0)
    await run(QUEUE, "readwrite", (objects) => {
      for (const key of sent) objects.delete(key);
    });
}

export async function addToQueue(item: QueueItem): Promise<void> {
  await run(QUEUE, "readwrite", (objects) => {
    objects.add(item);
  });
}

/** Queued payments, newest first; for one user when `userId` is given. */
export async function listQueue(userId?: string): Promise<QueueItem[]> {
  const all = (await run<QueueItem[]>(QUEUE, "readonly", (objects) => objects.getAll())) ?? [];
  return all
    .filter((item) => userId === undefined || item.userId === userId)
    .sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
}

/** Removes a payment the server refused, once the officer has dealt with it. Never a pending one. */
export async function dismissFailed(key: string): Promise<void> {
  const items = await listQueue();
  if (items.find((item) => item.key === key)?.status !== "failed") return;
  await run(QUEUE, "readwrite", (objects) => {
    objects.delete(key);
  });
}

/** Asks the service worker to send the queue now (and again when signal returns, on Android). */
export async function requestSync(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const sync = (
    registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    }
  ).sync;
  await sync?.register("field-queue").catch(() => undefined);
  registration.active?.postMessage({ type: "sync" });
}

/** While there is signal and something waits to be sent, asks again every 20 seconds. */
export function retryWhileWaiting(hasWaiting: () => boolean): () => void {
  const timer = window.setInterval(() => {
    if (navigator.onLine && hasWaiting()) void requestSync().catch(() => undefined);
  }, 20_000);
  return () => window.clearInterval(timer);
}

/** Calls `onChange` whenever the service worker has updated the queue. Returns the unsubscribe. */
export function onQueueChange(onChange: () => void): () => void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return () => undefined;
  const listener = (event: MessageEvent) => {
    if ((event.data as { type?: string } | null)?.type === "queue-changed") onChange();
  };
  navigator.serviceWorker.addEventListener("message", listener);
  return () => navigator.serviceWorker.removeEventListener("message", listener);
}
