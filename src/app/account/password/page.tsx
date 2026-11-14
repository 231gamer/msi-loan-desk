import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { getCurrentStaff } from "@/lib/auth/staff";
import { formatDateTime } from "@/lib/format";

import { PasswordForm } from "./password-form";
import { SubmitButton } from "@/components/ui/pending";

/*
 * /account/password: the only page an account that must set a new password can open (besides
 * signing out), and the voluntary "Change password" page for everyone else. It sits outside the
 * app shell because a flagged account can read nothing else.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account.password");
  return { title: t("metaTitle") };
}

export default function PasswordPage() {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-md">
        <Suspense fallback={<PasswordSkeleton />}>
          <PasswordContent />
        </Suspense>
      </div>
    </main>
  );
}

async function PasswordContent() {
  const [t, result] = await Promise.all([getTranslations("account.password"), getCurrentStaff()]);
  if (result.status === "signed-out") redirect("/login");
  if (result.status === "inactive") redirect("/auth/sign-out?notice=inactive");
  if (result.status === "must-change" && result.account.expired)
    redirect("/auth/sign-out?notice=temp-expired");
  if (result.status === "must-change" && result.account.signInAgain)
    redirect("/auth/sign-out?notice=sign-in-again");

  const forced = result.status === "must-change";
  const email = forced ? result.account.email : result.email;
  const fullName = forced ? result.account.fullName : result.staff.fullName;
  const expiresAt = forced ? result.account.expiresAt : null;

  return (
    <section className="rounded-card border border-line bg-surface p-6 sm:p-8">
      <h1 className="text-2xl font-bold text-ink">{forced ? t("forcedTitle") : t("changeTitle")}</h1>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        {forced ? t("forcedIntro", { name: fullName }) : t("changeIntro")}
      </p>
      {expiresAt !== null ? (
        <p className="mt-3 text-xs text-ink-soft">{t("expires", { at: formatDateTime(expiresAt) })}</p>
      ) : null}
      <PasswordForm forced={forced} email={email} fullName={fullName} />
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        {forced ? (
          <span />
        ) : (
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center text-sm font-semibold text-primary hover:underline"
          >
            {t("back")}
          </Link>
        )}
        <form action="/auth/sign-out" method="post">
          <SubmitButton className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-muted hover:text-ink hover:underline">
            {t("signOut")}
          </SubmitButton>
        </form>
      </div>
    </section>
  );
}

function PasswordSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-card border border-line bg-surface p-6 sm:p-8">
      <div className="h-7 w-48 animate-pulse rounded bg-page" />
      <div className="mt-3 h-4 w-64 animate-pulse rounded bg-page" />
      <div className="mt-6 h-11 animate-pulse rounded-[10px] bg-page" />
      <div className="mt-4 h-11 animate-pulse rounded-[10px] bg-page" />
      <div className="mt-6 h-11 animate-pulse rounded-[10px] bg-page" />
    </div>
  );
}
