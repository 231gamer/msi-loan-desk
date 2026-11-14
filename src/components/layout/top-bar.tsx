import { getTranslations } from "next-intl/server";
import type * as React from "react";

import { KeyRound } from "lucide-react";
import Link from "next/link";

import { LinkPending, LinkPendingIcon } from "@/components/ui/pending";
import { Tooltip } from "@/components/ui/tooltip";
import { approvalsWaiting } from "@/lib/approvals";
import type { Staff } from "@/lib/auth/staff";
import { getCompany } from "@/lib/company";
import { initials } from "@/lib/text";

import { LogoTile } from "./logo-tile";

/*
 * Page header. Desktop (mock-ups 05-15): white bar with the page title and the branch, then the
 * signed-in user (initials, name, role) and the change-password link at the right end.
 * Phone (mock-ups 02-03): purple header with "name · role · branch", the title and the logo tile.
 * One <h1> serves both layouts.
 */
export async function TopBar({
  title,
  staff,
  actions,
}: {
  title: string;
  staff: Staff;
  actions?: React.ReactNode;
}) {
  const [company, t, tRoles, waiting] = await Promise.all([
    getCompany(),
    getTranslations("shell"),
    getTranslations("roles"),
    approvalsWaiting(staff),
  ]);
  const decides = staff.role === "manager" || staff.role === "ceo";
  const branch = staff.branch?.name ?? t("allBranches");

  return (
    <header className="flex items-center justify-between gap-3 bg-primary px-4 pt-5 pb-4 text-white lg:border-b lg:border-line lg:bg-surface lg:px-6 lg:py-3.5 lg:text-inherit print:hidden">
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-primary-tint lg:hidden">
          {staff.fullName} · {tRoles(staff.role)} · {branch}
        </p>
        <h1 className="mt-0.5 truncate text-[22px] font-bold lg:mt-0 lg:text-xl">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        {actions}
        <p className="hidden text-sm font-medium text-ink-muted lg:block">{branch}</p>
        {decides ? (
          <Tooltip content={waiting > 0 ? t("approvalsWaiting", { count: waiting }) : t("approvalsHint")}>
            <Link
              href="/approvals"
              className="hidden min-h-10 items-center gap-2 rounded-control border border-line-input bg-surface px-3.5 text-sm font-semibold text-ink hover:bg-page hover:text-ink lg:inline-flex"
            >
              <LinkPending />
              {t("approvals")}
              {waiting > 0 ? (
                <span className="inline-flex min-w-5 items-center justify-center rounded-badge bg-brand-accent px-1.5 text-xs leading-5 font-bold text-on-brand-accent">
                  <span aria-hidden="true">{waiting}</span>
                  <span className="sr-only">{t("approvalsWaiting", { count: waiting })}</span>
                </span>
              ) : null}
            </Link>
          </Tooltip>
        ) : null}
        <div
          className="ml-1 hidden items-center gap-2.5 border-l border-line pl-3.5 lg:flex"
          data-testid="top-bar-user"
        >
          <span
            aria-hidden="true"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-tint text-[13px] font-bold text-primary-dark"
          >
            {initials(staff.fullName)}
          </span>
          <div className="leading-tight">
            <p className="text-[13px] font-semibold whitespace-nowrap text-ink">
              <span className="sr-only">{t("you", { name: "" })}</span>
              {staff.fullName}
            </p>
            <p className="text-xs text-ink-muted">{tRoles(staff.role)}</p>
          </div>
          <Tooltip content={t("changePasswordHint")} align="end">
            <Link
              href="/account/password"
              className="inline-flex size-10 items-center justify-center rounded-control border border-line-input text-ink-muted transition-colors duration-150 ease-out hover:bg-page hover:text-ink"
            >
              <LinkPendingIcon>
                <KeyRound aria-hidden="true" className="size-4" />
              </LinkPendingIcon>
              <span className="sr-only">{t("changePassword")}</span>
            </Link>
          </Tooltip>
        </div>
        <LogoTile
          size="sm"
          className="lg:hidden"
          logoUrl={company?.logoUrl ?? null}
          alt={t("logoAlt", { company: company?.name ?? "" })}
          shortName={company?.shortName ?? ""}
        />
      </div>
    </header>
  );
}
