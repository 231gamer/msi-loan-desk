"use client";

import { KeyRound, LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { SubmitButton } from "@/components/ui/pending";
import { isActive } from "@/lib/navigation";
import { InstallAppItem } from "@/components/pwa/install-app-item";
import { useSignOutGuard } from "@/components/pwa/use-sign-out-guard";
import { cn } from "@/lib/utils";

import { NavItemIcon } from "./nav-icon";
import { CountBadge, type NavLinkItem } from "./sidebar-nav";

const MAX_TABS = 4;

/*
 * Phone navigation (SPEC 9: bottom tab bar on phones; mock-up 01). The first pages of the role's
 * navigation are tabs; "More" opens a sheet with every page and sign-out. 44px+ touch targets.
 */
export function BottomNav({
  items,
  labels,
  account,
}: {
  items: NavLinkItem[];
  labels: {
    nav: string;
    more: string;
    moreTitle: string;
    close: string;
    signOut: string;
    changePassword: string;
  };
  account: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const guardSignOut = useSignOutGuard();
  const tabs = items.slice(0, MAX_TABS);

  const tabClass = (active: boolean) =>
    cn(
      "flex min-h-14 min-w-0 flex-1 basis-0 flex-col items-center justify-center gap-1 rounded-control text-xs font-semibold transition-colors duration-150 ease-out",
      active ? "text-primary" : "text-ink-muted hover:text-ink",
    );

  return (
    <nav
      aria-label={labels.nav}
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-surface px-2 pt-1 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden print:hidden"
    >
      {tabs.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            // The full name stays the link's name for screen readers when the tab shows a short one.
            aria-label={item.shortLabel === undefined ? undefined : item.label}
            className={tabClass(active)}
          >
            <NavItemIcon name={item.key} className="size-5.5" />
            <span className="max-w-full truncate px-0.5 whitespace-nowrap">
              {item.shortLabel ?? item.label}
            </span>
          </Link>
        );
      })}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className={tabClass(false)}>
          <Menu aria-hidden="true" className="size-5.5" />
          <span className="max-w-full truncate px-0.5 whitespace-nowrap">{labels.more}</span>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          closeLabel={labels.close}
          className="max-h-[85dvh] overflow-y-auto rounded-t-card pb-6"
        >
          <SheetHeader className="pr-14">
            <SheetTitle>{labels.moreTitle}</SheetTitle>
            <SheetDescription>{account}</SheetDescription>
          </SheetHeader>
          <ul className="grid gap-1 px-3">
            {items.map((item) => {
              const active = isActive(item, pathname);
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-control px-3 text-sm font-semibold",
                      active ? "bg-primary-tint text-primary-dark" : "text-ink hover:bg-page",
                    )}
                  >
                    <NavItemIcon name={item.key} className="size-5" />
                    <span className="flex-1">{item.label}</span>
                    <CountBadge badge={item.badge} />
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mx-3 border-t border-line pt-3">
            <Link
              href="/account/password"
              onClick={() => setOpen(false)}
              className="flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-sm font-semibold text-ink hover:bg-page"
            >
              <KeyRound aria-hidden="true" className="size-5" />
              {labels.changePassword}
            </Link>
            <InstallAppItem />
          </div>
          <form action="/auth/sign-out" method="post" onSubmit={guardSignOut} className="mx-3">
            <SubmitButton className="flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-sm font-semibold text-ink hover:bg-page">
              <LogOut aria-hidden="true" data-busy-hide="" className="size-5" />
              {labels.signOut}
            </SubmitButton>
          </form>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
