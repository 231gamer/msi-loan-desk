"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  listQueue,
  offlineStoreAvailable,
  onQueueChange,
  requestSync,
  retryWhileWaiting,
  saveSnapshot,
  type QueueItem,
  type SnapshotLoan,
} from "@/lib/offline/store";

/*
 * On /field with signal (SPEC addendum B): saves this officer's list on the phone for offline use,
 * sends any payments taken offline, and says how many are still waiting or were refused.
 */
export function FieldOfflineSync({
  userId,
  userName,
  loans,
}: {
  userId: string;
  userName: string;
  loans: SnapshotLoan[];
}) {
  const t = useTranslations("offline.sync");
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const reload = useCallback(() => {
    listQueue(userId)
      .then(setQueue)
      .catch(() => setQueue([]));
  }, [userId]);

  useEffect(() => {
    if (!offlineStoreAvailable()) return;
    void saveSnapshot({ userId, userName, savedAt: Date.now(), loans }).catch(() => undefined);
    reload();
    void requestSync().catch(() => undefined);
    return onQueueChange(reload);
  }, [userId, userName, loans, reload]);

  const waiting = queue.filter((item) => item.status === "pending").length;
  useEffect(() => (waiting > 0 ? retryWhileWaiting(() => true) : undefined), [waiting]);
  const failed = queue.filter((item) => item.status === "failed").length;
  if (waiting === 0 && failed === 0) return null;

  return (
    <div
      role="status"
      data-testid="offline-sync"
      className="grid gap-1 rounded-card border border-warning-border bg-warning-bg p-4 text-sm text-status-overdue-fg"
    >
      {waiting > 0 ? <p className="font-semibold">{t("waiting", { count: waiting })}</p> : null}
      {failed > 0 ? <p className="font-semibold">{t("failed", { count: failed })}</p> : null}
      <a href="/offline/field" className="font-semibold text-status-overdue-fg underline">
        {t("review")}
      </a>
    </div>
  );
}
