import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";

import { getCurrentStaff } from "@/lib/auth/staff";
import { getCompany } from "@/lib/company";
import { approvalsWaiting } from "@/lib/approvals";
import { SIDEBAR_COOKIE, navigationFor } from "@/lib/navigation";

import { LogoTile } from "./logo-tile";
import { SidebarFrame, SidebarNav, SidebarSignOut, WhenExpanded } from "./sidebar-nav";

/*
 * Desktop navigation (SPEC 9: left nav on desktop). Mock-ups 05-15, 232px wide, primary-dark,
 * with an icon on every item. It collapses to a 72px icon rail (remembered in a cookie). The
 * signed-in user and the password link sit in the top bar; the foot holds collapse and sign-out.
 */
export async function AppSidebar() {
  const result = await getCurrentStaff();
  if (result.status !== "ok") return null;
  const { staff } = result;
  const [company, t, tNav, cookieStore] = await Promise.all([
    getCompany(),
    getTranslations("shell"),
    getTranslations("nav"),
    cookies(),
  ]);
  const waiting = await approvalsWaiting(staff);
  const items = navigationFor(staff.role).map((item) => ({
    key: item.key,
    href: item.href,
    label: tNav(item.key),
    hint: tNav(`hints.${item.key}`),
    badge:
      item.key === "approvals" && waiting > 0
        ? { count: waiting, label: tNav("waiting", { count: waiting }) }
        : undefined,
  }));
  const companyName = company?.name ?? "";

  return (
    <SidebarFrame
      initialCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === "collapsed"}
      labels={{
        collapse: t("collapse"),
        expand: t("expand"),
        collapseHint: t("collapseHint"),
        expandHint: t("expandHint"),
        signOut: t("signOut"),
        signOutHint: t("signOutHint"),
      }}
      header={
        <div className="pb-4 group-data-[collapsed=false]/sidebar:px-1">
          <div className="flex items-center gap-2.5 rounded-tile bg-surface px-3 py-2.5 group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-1">
            <LogoTile
              logoUrl={company?.logoUrl ?? null}
              alt={t("logoAlt", { company: companyName })}
              shortName={company?.shortName ?? ""}
            />
            <WhenExpanded>
              <div className="min-w-0 leading-tight">
                <p className="line-clamp-2 text-sm font-extrabold text-primary">{companyName}</p>
                <p className="text-[11px] font-semibold text-ink-muted">{t("product")}</p>
              </div>
            </WhenExpanded>
          </div>
        </div>
      }
      footer={<SidebarSignOut />}
    >
      <SidebarNav items={items} label={tNav("label")} />
    </SidebarFrame>
  );
}

export function AppSidebarSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="sticky top-0 hidden h-dvh w-58 shrink-0 flex-col gap-2 bg-primary-dark px-3 py-5 lg:flex"
    >
      <div className="mx-1 mb-4 h-15 rounded-tile bg-white/90" />
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="h-10 animate-pulse rounded-control bg-white/8" />
      ))}
    </div>
  );
}
