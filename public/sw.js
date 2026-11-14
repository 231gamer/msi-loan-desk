/*
 * LoanDesk service worker (SPEC addendum B: installable app and offline field cash).
 *
 * What it caches: only the two offline pages (/offline and /offline/field), the files they need to
 * run, and the app icons. Pages with data are never cached: a page that cannot load offline shows
 * /offline instead (or /offline/field under /field), and those pages read nothing from the server.
 *
 * What it sends: payments a loan officer took offline, from the IndexedDB queue that
 * src/lib/offline/store.ts writes (same database name, version and stores). Each goes to
 * POST /api/field/payments with its request key, so sending twice records it once.
 */
const CACHE = "loandesk-offline-v1";
const OFFLINE_PAGES = ["/offline", "/offline/field"];
const STATIC_FILES = ["/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png"];
const DB_NAME = "loandesk-offline";
const DB_VERSION = 1;

self.addEventListener("install", (event) => {
  event.waitUntil(refreshOfflinePages().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Downloads the offline pages and every script, style and font they use into a fresh cache, then
 * swaps it in. If anything fails, the cache in use is kept as it is.
 */
async function refreshOfflinePages() {
  const files = new Set(STATIC_FILES);
  const responses = new Map();
  for (const page of OFFLINE_PAGES) {
    const response = await fetch(page, { cache: "no-store", credentials: "omit", redirect: "error" });
    if (!response.ok) throw new Error(`Could not download ${page}`);
    responses.set(page, response.clone());
    for (const asset of assetsIn(await response.text())) files.add(asset);
  }
  for (const asset of [...files]) {
    if (!asset.endsWith(".css")) continue;
    const css = await fetch(asset).then((response) => (response.ok ? response.text() : ""));
    for (const font of assetsIn(css)) files.add(font);
  }
  const next = await caches.open(`${CACHE}-next`);
  for (const [page, response] of responses) await next.put(page, response);
  await next.addAll([...files]);
  // Swap: copy the complete new set into the live cache name, replacing it.
  await caches.delete(CACHE);
  const live = await caches.open(CACHE);
  for (const request of await next.keys()) await live.put(request, await next.match(request));
  await caches.delete(`${CACHE}-next`);
}

function assetsIn(text) {
  const found = new Set();
  for (const match of text.matchAll(/\/_next\/static\/[^"'()\s\\]+/g)) found.add(match[0]);
  return found;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const field = /^\/(offline\/)?field(\/|$)/.test(url.pathname);
        return (await caches.match(field ? "/offline/field" : "/offline")) ?? Response.error();
      }),
    );
    return;
  }

  // Hashed build files never change, so the cached copy is used when there is one.
  if (url.pathname.startsWith("/_next/static/") || STATIC_FILES.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
  }
});

self.addEventListener("message", (event) => {
  // Only this site's own pages can reach a service worker; check anyway.
  if (event.origin !== self.location.origin) return;
  const type = event.data && event.data.type;
  if (type === "sync") event.waitUntil(sendQueue());
  if (type === "refresh") event.waitUntil(refreshOfflinePages().catch(() => undefined));
});

self.addEventListener("sync", (event) => {
  if (event.tag === "field-queue") event.waitUntil(sendQueue());
});

let sending = null;
let again = false;

/** Sends every pending payment; one run at a time, and once more if asked again meanwhile. */
function sendQueue() {
  if (sending !== null) {
    again = true;
    return sending;
  }
  sending = (async () => {
    do {
      again = false;
      await sendPending();
    } while (again);
  })().finally(() => {
    sending = null;
  });
  return sending;
}

async function sendPending() {
  const db = await openDb();
  try {
    const pending = (await getAll(db)).filter((item) => item.status === "pending");
    let changed = false;
    for (const item of pending) {
      const outcome = await send(item);
      if (outcome === null) continue;
      await put(db, { ...item, ...outcome });
      changed = true;
    }
    if (changed) await tellPages();
  } finally {
    db.close();
  }
}

/** Returns the fields to update, or null to try again later (no signal, signed out, other user). */
async function send(item) {
  let response;
  try {
    response = await fetch("/api/field/payments", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: { "content-type": "application/json", "x-loandesk-offline": "1" },
      // A weak signal can leave a request hanging; give up and try again on the next round.
      signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        key: item.key,
        userId: item.userId,
        loanId: item.loanId,
        amountCents: item.amountCents,
        method: item.method,
        reference: item.reference,
      }),
    });
  } catch {
    return null;
  }
  if (response.type === "opaqueredirect" || !response.ok) {
    if (response.status !== 422) return null;
  }
  const body = await response.json().catch(() => null);
  if (body === null) return null;
  if (body.result === "sent") {
    return {
      status: "sent",
      receiptNo: body.receiptNo,
      paymentId: body.paymentId,
      sentAt: new Date().toISOString(),
      errorCode: undefined,
    };
  }
  if (body.result === "failed") return { status: "failed", errorCode: body.code };
  return null;
}

async function tellPages() {
  for (const client of await self.clients.matchAll({ includeUncontrolled: true })) {
    client.postMessage({ type: "queue-changed" });
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "userId" });
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAll(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction("queue", "readonly").objectStore("queue").getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function put(db, item) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("queue", "readwrite");
    transaction.objectStore("queue").put(item);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
