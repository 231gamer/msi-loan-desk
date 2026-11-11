"use client";

import { Check, Circle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { Field, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { PASSWORD_PROBLEMS, passwordProblems, type PasswordProblem } from "@/lib/password-rules";
import { cn } from "@/lib/utils";

import { changePassword, type PasswordFormState } from "./actions";

const INITIAL: PasswordFormState = {};

/* The live list is a hint only; the server action applies the same rules (src/lib/password-rules.ts). */
export function PasswordForm({
  forced,
  email,
  fullName,
}: {
  forced: boolean;
  email: string;
  fullName: string;
}) {
  const t = useTranslations("account.password");
  const [state, formAction, pending] = useActionState(changePassword, INITIAL);
  const [password, setPassword] = useState("");
  const live = new Set<PasswordProblem>(passwordProblems(password, { email, fullName }));
  const serverProblems = state.problems ?? [];
  const newError =
    serverProblems.length > 0
      ? serverProblems.map((problem) => t(`problems.${problem}`)).join(" ")
      : undefined;
  const formError = state.error !== undefined ? t(`errors.${state.error}`) : undefined;

  return (
    <form action={formAction} noValidate className="mt-6 grid gap-4">
      {/* Lets password managers save the new password against the right account. */}
      <input type="text" name="username" autoComplete="username" value={email} readOnly hidden />
      {forced ? null : (
        <Field
          id="currentPassword"
          label={t("current")}
          error={state.error === "currentWrong" || state.error === "currentRequired" ? formError : undefined}
        >
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            className={inputClass}
            {...describedBy(
              "currentPassword",
              undefined,
              state.error === "currentWrong" || state.error === "currentRequired" ? formError : undefined,
            )}
          />
        </Field>
      )}
      <Field id="newPassword" label={t("new")} error={newError}>
        <input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={newError !== undefined ? true : undefined}
          aria-describedby={newError !== undefined ? "password-rules newPassword-error" : "password-rules"}
        />
      </Field>
      <div id="password-rules" className="rounded-control border border-line bg-surface px-3 py-2.5">
        <p className="text-xs font-semibold text-ink-muted">{t("rulesHeading")}</p>
        <ul className="mt-1.5 grid gap-1">
          {PASSWORD_PROBLEMS.map((rule) => {
            const met = password !== "" && !live.has(rule);
            return (
              <li
                key={rule}
                className={cn(
                  "flex items-start gap-2 text-xs leading-5",
                  met ? "text-status-active-fg" : "text-ink-soft",
                )}
              >
                {met ? (
                  <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <Circle aria-hidden="true" className="mt-1 size-2.5 shrink-0" />
                )}
                <span>
                  {t(`rules.${rule}`)}
                  {met ? <span className="sr-only"> {t("ruleMet")}</span> : null}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-1.5 text-xs leading-5 text-ink-soft">{t("rulesNote")}</p>
      </div>
      <Field
        id="confirmPassword"
        label={t("confirm")}
        error={state.error === "mismatch" ? formError : undefined}
      >
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          className={inputClass}
          {...describedBy("confirmPassword", undefined, state.error === "mismatch" ? formError : undefined)}
        />
      </Field>
      {formError !== undefined &&
      !["mismatch", "currentWrong", "currentRequired"].includes(state.error ?? "") ? (
        <p
          role="alert"
          className="rounded-control border border-warning-border bg-warning-bg px-3 py-2.5 text-sm text-status-overdue-fg"
        >
          {formError}
        </p>
      ) : null}
      {serverProblems.length > 0 ||
      ["mismatch", "currentWrong", "currentRequired"].includes(state.error ?? "") ? (
        <p role="alert" className="sr-only">
          {[newError, formError].filter(Boolean).join(" ")}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="mt-1 min-h-11">
        {pending ? t("saving") : forced ? t("submitForced") : t("submit")}
      </Button>
    </form>
  );
}
