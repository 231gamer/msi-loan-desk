"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { CheckboxRow, Field, Panel, describedBy, inputClass } from "@/components/forms/fields";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { ROLES, type Role } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { zodResolver } from "@/lib/zod-resolver";

import {
  createUser,
  requireNewPassword,
  requireNewPasswordForAll,
  resetPassword,
  updateUser,
} from "./actions";
import { StatusMessage, useStatus, useValidationText } from "./form-status";
import { newUserSchema, userSchema, type NewUserValues, type UserValues } from "./schemas";

export interface UserRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  role: Role;
  branchId: string;
  branchName: string;
  active: boolean;
  password: PasswordStatus;
}

/** "set": the user chose their own password; otherwise a temporary one is pending or has expired. */
export type PasswordStatus = { kind: "set" } | { kind: "mustSet"; expiresAt: string } | { kind: "expired" };

type Revealed = { name: string; password: string; expiresAt: string };
type Requiring = { mode: "one"; user: UserRow } | { mode: "all" } | null;

export interface BranchOption {
  id: string;
  label: string;
}

type Editing = { mode: "new" } | { mode: "edit"; user: UserRow } | null;

export function UsersPanel({
  users,
  branches,
  selfId,
}: {
  users: UserRow[];
  branches: BranchOption[];
  selfId: string;
}) {
  const t = useTranslations("settings");
  const tRoles = useTranslations("roles");
  const [editing, setEditing] = useState<Editing>(null);
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [requiring, setRequiring] = useState<Requiring>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { status, setStatus, pending, startTransition } = useStatus();

  const reset = (user: UserRow) => {
    if (!window.confirm(t("users.resetConfirm", { name: user.fullName }))) return;
    setStatus(null);
    setNotice(null);
    startTransition(async () => {
      const result = await resetPassword(user.id);
      if (result.ok)
        setRevealed({
          name: user.fullName,
          password: result.data.password,
          expiresAt: formatDateTime(result.data.expiresAt),
        });
      else setStatus({ tone: "error", code: result.code });
    });
  };

  return (
    <Panel id="users-heading" title={t("users.heading")} intro={t("users.intro")}>
      {revealed !== null ? <PasswordReveal {...revealed} onDone={() => setRevealed(null)} /> : null}
      {notice !== null ? (
        <p
          role="status"
          className="mb-4 rounded-control bg-primary-tint px-3 py-2.5 text-sm font-medium text-primary-dark"
        >
          {notice}
        </p>
      ) : null}
      {users.length === 0 ? (
        <p className="text-sm text-ink-muted">{t("users.empty")}</p>
      ) : (
        <ul className="-mx-4 divide-y divide-page border-y border-line sm:mx-0 sm:rounded-control sm:border">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {user.fullName}
                  {user.id === selfId ? (
                    <span className="font-normal text-ink-soft"> · {t("users.you")}</span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-ink-muted">
                  {user.email} · {tRoles(user.role)} ·{" "}
                  {user.branchName === "" ? t("users.noBranch") : user.branchName}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <StatusBadge user={user} />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing({ mode: "edit", user })}
                >
                  {t("edit")}
                  <span className="sr-only"> {user.fullName}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => reset(user)}
                >
                  {t("users.resetPassword")}
                  <span className="sr-only"> {user.fullName}</span>
                </Button>
                {user.active ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      setNotice(null);
                      setRequiring({ mode: "one", user });
                    }}
                  >
                    {t("users.requireNew")}
                    <span className="sr-only"> {user.fullName}</span>
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 grid gap-4">
        <StatusMessage status={status} />
        {requiring !== null ? (
          <RequireNewPasswordForm
            key={requiring.mode === "one" ? requiring.user.id : "all"}
            target={requiring}
            onCancel={() => setRequiring(null)}
            onDone={(message) => {
              setRequiring(null);
              setNotice(message);
            }}
          />
        ) : null}
        {editing === null ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing({ mode: "new" })}>
              {t("users.add")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setNotice(null);
                setRequiring({ mode: "all" });
              }}
            >
              {t("users.requireAll")}
            </Button>
          </div>
        ) : editing.mode === "new" ? (
          <NewUserForm
            branches={branches}
            onCancel={() => setEditing(null)}
            onCreated={(name, password, expiresAt) => {
              setEditing(null);
              setRevealed({ name, password, expiresAt: formatDateTime(expiresAt) });
            }}
          />
        ) : (
          <EditUserForm
            key={editing.user.id}
            user={editing.user}
            branches={branches}
            isSelf={editing.user.id === selfId}
            onDone={() => setEditing(null)}
          />
        )}
      </div>
    </Panel>
  );
}

function StatusBadge({ user }: { user: UserRow }) {
  const t = useTranslations("settings");
  const { label, tone } = !user.active
    ? { label: t("users.inactive"), tone: "pending" as const }
    : user.password.kind === "expired"
      ? { label: t("users.tempExpired"), tone: "overdue" as const }
      : user.password.kind === "mustSet"
        ? { label: t("users.mustSet", { at: user.password.expiresAt }), tone: "due" as const }
        : { label: t("users.active"), tone: "active" as const };
  return (
    <span
      data-testid="user-status"
      className={cn(
        "inline-block rounded-badge px-2.5 py-0.5 text-xs font-semibold",
        tone === "active" && "bg-status-active-bg text-status-active-fg",
        tone === "pending" && "bg-status-pending-bg text-status-pending-fg",
        tone === "due" && "bg-status-due-bg text-status-due-fg",
        tone === "overdue" && "bg-status-overdue-bg text-status-overdue-fg",
      )}
    >
      {label}
    </span>
  );
}

function PasswordReveal({
  name,
  password,
  expiresAt,
  onDone,
}: {
  name: string;
  password: string;
  expiresAt: string;
  onDone: () => void;
}) {
  const t = useTranslations("settings");
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <div
      role="status"
      className="mb-4 grid gap-2 rounded-control border border-warning-border bg-warning-bg p-4"
    >
      <p className="text-sm font-bold text-status-overdue-fg">{t("users.passwordHeading")}</p>
      <p className="text-sm text-status-overdue-fg">{t("users.passwordIntro", { name })}</p>
      <p
        className="rounded-control bg-surface px-3 py-2 font-mono text-lg tracking-wider break-all text-ink select-all"
        data-testid="one-time-password"
      >
        {password}
      </p>
      <p className="text-sm text-status-overdue-fg" data-testid="one-time-password-expiry">
        {t("users.passwordExpires", { at: expiresAt })}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            navigator.clipboard.writeText(password).then(
              () => setCopy("copied"),
              () => setCopy("failed"),
            );
          }}
        >
          {copy === "copied" ? t("users.copied") : t("users.copy")}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          {t("users.passwordDone")}
        </Button>
      </div>
      {copy === "failed" ? <p className="text-sm text-status-overdue-fg">{t("users.copyFailed")}</p> : null}
    </div>
  );
}

function RequireNewPasswordForm({
  target,
  onCancel,
  onDone,
}: {
  target: Exclude<Requiring, null>;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const t = useTranslations("settings");
  const validation = useValidationText();
  const { status, setStatus, pending, startTransition } = useStatus();
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>(undefined);
  const name = target.mode === "one" ? target.user.fullName : "";

  return (
    <form
      noValidate
      className="grid gap-4 rounded-control border border-line p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = reason.trim();
        if (trimmed.length < 3) {
          setReasonError(validation("reason"));
          return;
        }
        setReasonError(undefined);
        setStatus(null);
        startTransition(async () => {
          if (target.mode === "one") {
            const result = await requireNewPassword(target.user.id, trimmed);
            if (result.ok)
              onDone(t("users.requireDone", { name, at: formatDateTime(result.data.expiresAt) }));
            else setStatus({ tone: "error", code: result.code });
          } else {
            const result = await requireNewPasswordForAll(trimmed);
            if (result.ok) onDone(t("users.requireAllDone", { count: result.data.count }));
            else setStatus({ tone: "error", code: result.code });
          }
        });
      }}
    >
      <h3 className="text-sm font-bold text-ink">
        {target.mode === "one" ? t("users.requireNewHeading", { name }) : t("users.requireAllHeading")}
      </h3>
      <p className="text-sm text-ink-muted">
        {target.mode === "one" ? t("users.requireNewIntro", { name }) : t("users.requireAllIntro")}
      </p>
      <Field id="require-reason" label={t("users.reason")} help={t("users.reasonHelp")} error={reasonError}>
        <input
          id="require-reason"
          className={inputClass}
          maxLength={300}
          autoComplete="off"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          {...describedBy("require-reason", t("users.reasonHelp"), reasonError)}
        />
      </Field>
      <StatusMessage status={status} />
      <div className="flex flex-wrap gap-2">
        <Button aria-busy={pending} type="submit" disabled={pending}>
          {pending
            ? t("saving")
            : target.mode === "one"
              ? t("users.requireConfirm")
              : t("users.requireAllConfirm")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function UserFields({
  form,
  branches,
  isSelf = false,
  withEmail = false,
}: {
  form: ReturnType<typeof useForm<NewUserValues>> | ReturnType<typeof useForm<UserValues>>;
  branches: BranchOption[];
  isSelf?: boolean;
  withEmail?: boolean;
}) {
  const t = useTranslations("settings");
  const tRoles = useTranslations("roles");
  const validation = useValidationText();
  // Both forms share these field names; the union of form types is narrowed to them here.
  const shared = form as unknown as ReturnType<typeof useForm<NewUserValues>>;
  const errors = shared.formState.errors;
  const error = (name: keyof NewUserValues) => validation(errors[name]?.message);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="user-fullName" label={t("users.name")} error={error("fullName")}>
          <input
            id="user-fullName"
            className={inputClass}
            autoComplete="off"
            {...describedBy("user-fullName", undefined, error("fullName"))}
            {...shared.register("fullName")}
          />
        </Field>
        {withEmail ? (
          <Field id="user-email" label={t("users.email")} error={error("email")}>
            <input
              id="user-email"
              type="email"
              autoComplete="off"
              className={inputClass}
              {...describedBy("user-email", undefined, error("email"))}
              {...shared.register("email")}
            />
          </Field>
        ) : null}
        <Field id="user-phone" label={t("users.phone")} error={error("phone")}>
          <input
            id="user-phone"
            type="tel"
            className={inputClass}
            {...describedBy("user-phone", undefined, error("phone"))}
            {...shared.register("phone")}
          />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="user-role" label={t("users.role")} error={error("role")}>
          <select id="user-role" className={inputClass} disabled={isSelf} {...shared.register("role")}>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {tRoles(role)}
              </option>
            ))}
          </select>
        </Field>
        <Field id="user-branchId" label={t("users.branch")} error={error("branchId")}>
          <select
            id="user-branchId"
            className={inputClass}
            {...describedBy("user-branchId", undefined, error("branchId"))}
            {...shared.register("branchId")}
          >
            <option value="">{t("users.noBranch")}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {isSelf ? <p className="text-xs text-ink-muted">{t("users.selfNote")}</p> : null}
    </>
  );
}

function NewUserForm({
  branches,
  onCancel,
  onCreated,
}: {
  branches: BranchOption[];
  onCancel: () => void;
  onCreated: (name: string, password: string, expiresAt: string) => void;
}) {
  const t = useTranslations("settings");
  const { status, setStatus, pending, startTransition } = useStatus();
  const form = useForm<NewUserValues>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { fullName: "", email: "", phone: "", role: "loan_officer", branchId: "" },
  });

  return (
    <form
      noValidate
      className="grid gap-4 rounded-control border border-line p-4"
      onSubmit={form.handleSubmit((values) => {
        setStatus(null);
        startTransition(async () => {
          const result = await createUser(values);
          if (result.ok) onCreated(values.fullName, result.data.password, result.data.expiresAt);
          else setStatus({ tone: "error", code: result.code });
        });
      })}
    >
      <h3 className="text-sm font-bold text-ink">{t("users.addHeading")}</h3>
      <UserFields form={form} branches={branches} withEmail />
      <StatusMessage status={status} />
      <div className="flex flex-wrap gap-2">
        <Button aria-busy={pending} type="submit" disabled={pending}>
          {pending ? t("saving") : t("users.create")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function EditUserForm({
  user,
  branches,
  isSelf,
  onDone,
}: {
  user: UserRow;
  branches: BranchOption[];
  isSelf: boolean;
  onDone: () => void;
}) {
  const t = useTranslations("settings");
  const { status, setStatus, pending, startTransition } = useStatus();
  const form = useForm<UserValues>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      branchId: user.branchId,
      active: user.active,
    },
  });

  return (
    <form
      noValidate
      className="grid gap-4 rounded-control border border-line p-4"
      onSubmit={form.handleSubmit((values) => {
        setStatus(null);
        startTransition(async () => {
          // A disabled select is not submitted by the browser; keep the admin's own role.
          const result = await updateUser(isSelf ? { ...values, role: user.role, active: true } : values);
          if (result.ok) onDone();
          else setStatus({ tone: "error", code: result.code });
        });
      })}
    >
      <h3 className="text-sm font-bold text-ink">{t("users.editHeading", { name: user.fullName })}</h3>
      <UserFields form={form} branches={branches} isSelf={isSelf} />
      <CheckboxRow
        id="user-active"
        label={t("users.activeLabel")}
        disabled={isSelf}
        {...form.register("active")}
      />
      <StatusMessage status={status} />
      <div className="flex flex-wrap gap-2">
        <Button aria-busy={pending} type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
