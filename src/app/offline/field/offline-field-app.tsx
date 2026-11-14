"use client";

import { CloudOff, Wifi } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { Field, describedBy, inputClass } from "@/components/forms/fields";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { parseDollarsToCents } from "@/lib/money-input";
import { APP_ERROR_CODES, RPC_ERROR_CODES, type ErrorCode } from "@/lib/rpc-errors";
import {
  OFFLINE_KEEP_HOURS,
  OFFLINE_REFERENCE_MAX,
  offlineReference,
  slipReference,
} from "@/lib/offline/rules";
import {
  addToQueue,
  dismissFailed,
  listQueue,
  onQueueChange,
  readSnapshot,
  requestSync,
  retryWhileWaiting,
  type QueueItem,
  type Snapshot,
  type SnapshotLoan,
} from "@/lib/offline/store";
import { cn } from "@/lib/utils";

const METHODS = ["cash", "mobile_money", "bank"] as const;
const KNOWN_CODES: ReadonlySet<string> = new Set<string>([...RPC_ERROR_CODES, ...APP_ERROR_CODES]);

function knownCode(code: string | undefined): ErrorCode {
  return code !== undefined && KNOWN_CODES.has(code) ? (code as ErrorCode) : "UNKNOWN";
}
type Method = (typeof METHODS)[number];

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** The offline Field cash screen: saved list, Collect form, provisional slip, queue. */
export function OfflineFieldApp() {
  const t = useTranslations("offline.field");
  const [snapshot, setSnapshot] = useState<Snapshot | null | undefined>(undefined);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const online = useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
  const [collecting, setCollecting] = useState<SnapshotLoan | null>(null);
  const [slip, setSlip] = useState<QueueItem | null>(null);

  const reload = useCallback(() => {
    void readSnapshot()
      .catch(() => null)
      .then(async (saved) => {
        const items = await listQueue(saved?.userId).catch(() => []);
        setSnapshot(saved);
        setQueue(items);
      });
  }, []);

  useEffect(() => {
    reload();
    return onQueueChange(reload);
  }, [reload]);

  // Send the queue whenever signal is back (and once on opening with signal).
  useEffect(() => {
    if (online) void requestSync().catch(() => undefined);
  }, [online]);

  const waiting = queue.some((item) => item.status === "pending");
  useEffect(() => (waiting ? retryWhileWaiting(() => true) : undefined), [waiting]);

  if (snapshot === undefined) return null;

  if (slip !== null) return <Slip item={slip} onDone={() => setSlip(null)} />;

  if (collecting !== null && snapshot !== null)
    return (
      <CollectForm
        loan={collecting}
        userId={snapshot.userId}
        onCancel={() => setCollecting(null)}
        onSaved={(item) => {
          setCollecting(null);
          setSlip(item);
          reload();
          void requestSync();
        }}
      />
    );

  return (
    <>
      <div
        role="status"
        className={cn(
          "flex items-start gap-3 rounded-card border p-4 text-sm",
          online
            ? "border-line bg-surface text-ink"
            : "border-warning-border bg-warning-bg text-status-overdue-fg",
        )}
      >
        {online ? (
          <Wifi aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        ) : (
          <CloudOff aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
        )}
        <div className="grid gap-2">
          <p>{online ? t("statusOnline") : t("statusOffline")}</p>
          {online ? (
            <a href="/field" className="font-semibold">
              {t("openOnline")}
            </a>
          ) : null}
        </div>
      </div>

      {snapshot === null ? (
        <p className="rounded-card border border-line bg-surface px-4 py-6 text-sm text-ink-muted">
          {t("noList", { hours: OFFLINE_KEEP_HOURS })}
        </p>
      ) : (
        <section aria-labelledby="offline-visits" className="grid gap-3">
          <div>
            <h2 id="offline-visits" className="text-base font-bold text-ink">
              {t("visitsHeading")}
            </h2>
            <p className="text-xs text-ink-muted">
              {t("savedAt", { when: formatDateTime(new Date(snapshot.savedAt)), name: snapshot.userName })}
            </p>
          </div>
          {snapshot.loans.length === 0 ? (
            <p className="rounded-card border border-line bg-surface px-4 py-6 text-center text-sm text-ink-muted">
              {t("empty")}
            </p>
          ) : (
            snapshot.loans.map((loan) => {
              const recorded = queue
                .filter(
                  (item) =>
                    item.loanId === loan.id &&
                    item.status !== "failed" &&
                    Date.parse(item.collectedAt) >= snapshot.savedAt,
                )
                .reduce((sum, item) => sum + BigInt(item.amountCents), 0n);
              return (
                <article
                  key={loan.id}
                  aria-labelledby={`offline-${loan.id}`}
                  className="grid gap-3 rounded-card border border-line bg-surface p-4"
                >
                  <div className="grid">
                    <h3 id={`offline-${loan.id}`} className="text-lg font-bold text-ink">
                      {loan.customer}
                    </h3>
                    <p className="tabular text-sm text-ink-muted">
                      {loan.loanNo}
                      {loan.dueDate !== null ? ` · ${formatDate(loan.dueDate)}` : ""}
                    </p>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <p className="text-sm text-ink-muted">
                      {t("owes", { amount: formatMoney(loan.owedCents) })}
                    </p>
                    <p className="tabular text-2xl font-bold text-ink">
                      {t("dueNow", { amount: formatMoney(loan.dueCents) })}
                    </p>
                  </div>
                  {recorded > 0n ? (
                    <p className="rounded-control bg-subtle px-3 py-2 text-sm font-medium text-ink">
                      {t("recordedHere", { amount: formatMoney(recorded) })}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    size="field"
                    aria-label={t("collectLabel", { name: loan.customer })}
                    onClick={() => setCollecting(loan)}
                  >
                    {t("collect")}
                  </Button>
                </article>
              );
            })
          )}
        </section>
      )}

      <QueueList items={queue} online={online} onChange={reload} />
    </>
  );
}

function CollectForm({
  loan,
  userId,
  onCancel,
  onSaved,
}: {
  loan: SnapshotLoan;
  userId: string;
  onCancel: () => void;
  onSaved: (item: QueueItem) => void;
}) {
  const t = useTranslations("offline.field.form");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("cash");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<{ field: "amount" | "reference" | "form"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const cents = parseDollarsToCents(amount);
  const tooMuch = cents !== null && cents > BigInt(loan.owedCents);

  const save = async () => {
    if (cents === null || cents <= 0n) {
      setError({ field: "amount", text: t("invalidAmount") });
      return;
    }
    if (method !== "cash" && reference.trim().length < 4) {
      setError({ field: "reference", text: t("referenceRequired") });
      return;
    }
    setError(null);
    setSaving(true);
    const collectedAt = new Date();
    const item: QueueItem = {
      key: crypto.randomUUID(),
      userId,
      loanId: loan.id,
      loanNo: loan.loanNo,
      customer: loan.customer,
      amountCents: cents.toString(),
      method,
      reference: offlineReference(method, reference, collectedAt),
      collectedAt: collectedAt.toISOString(),
      status: "pending",
    };
    try {
      await addToQueue(item);
      onSaved(item);
    } catch {
      setError({ field: "form", text: t("saveFailed") });
      setSaving(false);
    }
  };

  return (
    <form
      className="grid gap-4 rounded-card border border-line bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      aria-labelledby="offline-collect"
    >
      <h2 id="offline-collect" className="text-lg font-bold text-ink">
        {t("heading", { name: loan.customer })}
      </h2>
      <p className="tabular -mt-3 text-sm text-ink-muted">{loan.loanNo}</p>
      <Field
        id="offline-amount"
        label={t("amount")}
        error={error?.field === "amount" ? error.text : undefined}
        help={tooMuch ? t("moreThanOwed", { amount: formatMoney(loan.owedCents) }) : undefined}
      >
        <input
          id="offline-amount"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className={cn(inputClass, "min-h-[52px] text-lg")}
          {...describedBy(
            "offline-amount",
            tooMuch ? "help" : undefined,
            error?.field === "amount" ? error.text : undefined,
          )}
        />
      </Field>
      <Field id="offline-method" label={t("method")}>
        <select
          id="offline-method"
          value={method}
          onChange={(event) => setMethod(event.target.value as Method)}
          className={cn(inputClass, "min-h-[52px]")}
        >
          {METHODS.map((value) => (
            <option key={value} value={value}>
              {t(`methods.${value}`)}
            </option>
          ))}
        </select>
      </Field>
      {method !== "cash" ? (
        <Field
          id="offline-reference"
          label={t("reference")}
          error={error?.field === "reference" ? error.text : undefined}
        >
          <input
            id="offline-reference"
            value={reference}
            maxLength={OFFLINE_REFERENCE_MAX}
            autoComplete="off"
            onChange={(event) => setReference(event.target.value)}
            className={cn(inputClass, "min-h-[52px]")}
            {...describedBy(
              "offline-reference",
              undefined,
              error?.field === "reference" ? error.text : undefined,
            )}
          />
        </Field>
      ) : null}
      {error?.field === "form" ? (
        <p role="alert" className="text-sm font-medium text-status-overdue-strong">
          {error.text}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" size="field" onClick={onCancel} disabled={saving}>
          {t("cancel")}
        </Button>
        <Button type="submit" size="field" disabled={saving} aria-busy={saving}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}

function Slip({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const t = useTranslations("offline.field.slip");
  const tMethods = useTranslations("offline.field.form.methods");
  const rows: [string, string][] = [
    [t("reference"), slipReference(item.key)],
    [t("customer"), item.customer],
    [t("loan"), item.loanNo],
    [t("amount"), formatMoney(item.amountCents)],
    [t("method"), tMethods(item.method)],
    [t("collected"), formatDateTime(item.collectedAt)],
  ];
  return (
    <section
      aria-labelledby="offline-slip"
      className="grid gap-4 rounded-card border border-line bg-surface p-4"
      data-testid="offline-slip"
    >
      <h2 id="offline-slip" className="text-lg font-bold text-ink">
        {t("heading")}
      </h2>
      <dl className="grid gap-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-page pb-2">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="tabular text-right font-semibold text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-ink-muted">{t("note")}</p>
      <Button type="button" size="field" onClick={onDone}>
        {t("done")}
      </Button>
    </section>
  );
}

function QueueList({
  items,
  online,
  onChange,
}: {
  items: QueueItem[];
  online: boolean;
  onChange: () => void;
}) {
  const t = useTranslations("offline.field.queue");
  const tErrors = useTranslations("errors");
  const hasPending = items.some((item) => item.status === "pending");
  return (
    <section
      aria-labelledby="offline-queue"
      className="grid gap-3 rounded-card border border-line bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="offline-queue" className="text-base font-bold text-ink">
          {t("heading")}
        </h2>
        {online && hasPending ? (
          <Button type="button" size="sm" variant="secondary" onClick={() => void requestSync()}>
            {t("sendNow")}
          </Button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("none")}</p>
      ) : (
        <ul className="grid divide-y divide-page">
          {items.map((item) => (
            <li key={item.key} className="grid gap-1 py-3" data-testid="offline-queue-item">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-ink">{item.customer}</p>
                  <p className="tabular text-xs text-ink-muted">
                    {slipReference(item.key)} · {item.loanNo} · {formatDateTime(item.collectedAt)}
                  </p>
                </div>
                <p className="tabular shrink-0 font-semibold text-ink">{formatMoney(item.amountCents)}</p>
              </div>
              {item.status === "pending" ? (
                <div>
                  <StatusBadge tone="pending">{t("pending")}</StatusBadge>
                </div>
              ) : item.status === "sent" ? (
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge tone="active">{t("sent", { receipt: item.receiptNo ?? "" })}</StatusBadge>
                  {online && item.paymentId !== undefined ? (
                    <a href={`/receipts/${item.paymentId}`} className="text-sm font-semibold">
                      {t("openReceipt")}
                    </a>
                  ) : null}
                </div>
              ) : (
                <div className="grid justify-items-start gap-2">
                  <StatusBadge tone="overdue">
                    {t("failed", {
                      reason: tErrors(knownCode(item.errorCode)),
                    })}
                  </StatusBadge>
                  <p className="text-xs text-ink-muted">{t("failedHelp")}</p>
                  <button
                    type="button"
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "justify-self-start")}
                    onClick={() => {
                      if (window.confirm(t("dismissConfirm"))) void dismissFailed(item.key).then(onChange);
                    }}
                  >
                    {t("dismiss")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
