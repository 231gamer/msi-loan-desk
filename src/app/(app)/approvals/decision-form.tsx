"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { FormMessage, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import type { ErrorCode } from "@/lib/rpc-errors";
import { cn } from "@/lib/utils";

import { decideApproval } from "./actions";

/*
 * Approve, or reject with a reason (mock-up 12). The reason field appears only when it is needed:
 * pressing Reject without a reason opens it, and a rejection asks for confirmation (SPEC 9). A
 * write-off needs the board reference to approve (SPEC 5.8), so its field is always shown.
 */
export function DecisionForm({
  requestId,
  title,
  boardReference = false,
}: {
  requestId: string;
  title: string;
  /** A write-off: the note is the board reference and is required to approve (SPEC 5.8). */
  boardReference?: boolean;
}) {
  const t = useTranslations("approvals.decision");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(boardReference);
  const [confirming, setConfirming] = useState(false);
  const [missingNote, setMissingNote] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const noteId = `note-${requestId}`;

  const decide = (decision: "approve" | "reject") => {
    setError(null);
    startTransition(async () => {
      const result = await decideApproval(requestId, decision, note);
      if (result.ok) {
        router.refresh();
      } else {
        setConfirming(false);
        setError(result.code);
      }
    });
  };

  if (confirming) {
    return (
      <div
        role="alertdialog"
        aria-labelledby={`${noteId}-confirm`}
        className="grid gap-3 rounded-control border border-warning-border bg-warning-bg p-3 text-status-overdue-fg"
      >
        <p id={`${noteId}-confirm`} className="text-sm font-semibold">
          {t("confirmReject", { title })}
        </p>
        <p className="text-sm break-words">{t("confirmReason", { reason: note.trim() })}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            aria-busy={pending}
            type="button"
            variant="danger"
            disabled={pending}
            onClick={() => decide("reject")}
          >
            {pending ? t("sending") : t("yesReject")}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
            {t("cancel")}
          </Button>
        </div>
        {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <Button
          aria-busy={pending}
          type="button"
          disabled={pending}
          onClick={() => {
            if (boardReference && note.trim() === "") {
              setShowNote(true);
              setMissingNote("approve");
              return;
            }
            setMissingNote(null);
            decide("approve");
          }}
        >
          <Check aria-hidden="true" data-busy-hide="" />
          {pending ? t("sending") : t("approve")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => {
            if (note.trim() === "") {
              setShowNote(true);
              setMissingNote("reject");
              return;
            }
            setMissingNote(null);
            setConfirming(true);
          }}
        >
          <X aria-hidden="true" />
          {t("reject")}
        </Button>
      </div>
      {showNote ? (
        <div className="grid gap-1">
          <label htmlFor={noteId} className="text-xs font-medium text-ink-muted">
            {t(boardReference ? "boardLabel" : "noteFieldLabel")}
          </label>
          <input
            id={noteId}
            value={note}
            maxLength={500}
            autoFocus={!boardReference}
            placeholder={t(boardReference ? "boardPlaceholder" : "notePlaceholder")}
            onChange={(event) => setNote(event.target.value)}
            className={cn(inputClass)}
            aria-label={t("noteLabel", { title })}
            {...describedBy(noteId, undefined, missingNote !== null ? t("noteRequired") : undefined)}
          />
          {missingNote !== null ? (
            <p id={`${noteId}-error`} className="text-xs font-medium text-status-overdue-strong">
              {t(missingNote === "approve" ? "boardRequired" : "noteRequired")}
            </p>
          ) : null}
        </div>
      ) : null}
      {error !== null ? <FormMessage tone="error">{tErrors(error)}</FormMessage> : null}
    </div>
  );
}
