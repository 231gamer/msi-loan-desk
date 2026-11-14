"use client";

import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState } from "react";
import type * as React from "react";

import { SubmitButton } from "@/components/ui/pending";
import { Tooltip } from "@/components/ui/tooltip";
import { SIDEBAR_COOKIE, isActive, type NavIcon } from "@/lib/navigation";
import { cn } from "@/lib/utils";

import { NavItemIcon } from "./nav-icon";

export interface NavLinkItem {
  key: NavIcon;
  href: string;
  label: string;
  /** Shorter label for the phone tab bar, where a long name would wrap. */
  shortLabel?: string;
  /** One line shown in the item's tooltip. */
  hint?: string;
  /** Count shown as a yellow pill (approvals waiting), with its accessible text. */
  badge?: { count: number; label: string };
}

const CollapsedContext = createContext(false);

export function CountBadge({ badge }: { badge: NavLinkItem["badge"] }) {
  if (badge === undefined || badge.count === 0) return null;
  return (
    <span className="inline-flex min-w-5 items-center justify-center rounded-badge bg-brand-accent px-1.5 text-xs leading-5 font-bold text-on-brand-accent">
      <span aria-hidden="true">{badge.count}</span>
      <span className="sr-only">{badge.label}</span>
    </span>
  );
}

/**
 * Desktop sidebar frame. Expanded it is 232px (mock-ups 05-15); collapsed it is a 72px rail of
 * icons whose labels move into tooltips. The choice is kept in a cookie for a year.
 */
export function SidebarFrame({
  initialCollapsed,
  labels,
  header,
  children,
  footer,
}: {
  initialCollapsed: boolean;
  labels: SidebarLabels;
  header: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  return (
    <SidebarLabelsContext.Provider value={labels}>
      <CollapsedContext.Provider value={collapsed}>
        <aside
          data-collapsed={collapsed}
          className={cn(
            "group/sidebar sticky top-0 hidden h-dvh shrink-0 flex-col gap-1 overflow-x-hidden overflow-y-auto bg-primary-dark py-5 text-white transition-[width] duration-200 ease-out lg:flex print:hidden",
            collapsed ? "w-18 px-2.5" : "w-58 px-3",
          )}
        >
          {header}
          {children}
          <div className="mt-auto grid gap-0.5 border-t border-white/18 pt-3">
            <CollapseToggle
              collapsed={collapsed}
              onToggle={() => {
                const next = !collapsed;
                setCollapsed(next);
                document.cookie = `${SIDEBAR_COOKIE}=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
              }}
            />
            {footer}
          </div>
        </aside>
      </CollapsedContext.Provider>
    </SidebarLabelsContext.Provider>
  );
}

const rowClass = (collapsed: boolean) =>
  cn(
    "flex min-h-10 w-full items-center gap-3 rounded-control text-sm font-medium transition-colors duration-150 ease-out",
    collapsed ? "justify-center px-0" : "px-3",
  );

function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const labels = useContext(SidebarLabelsContext);
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <Tooltip side="right" content={collapsed ? labels.expandHint : labels.collapseHint}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className={cn(rowClass(collapsed), "text-on-primary-muted hover:bg-white/10 hover:text-white")}
      >
        <Icon aria-hidden="true" className="size-4.5 shrink-0" />
        <span className={collapsed ? "sr-only" : undefined}>
          {collapsed ? labels.expand : labels.collapse}
        </span>
      </button>
    </Tooltip>
  );
}

export interface SidebarLabels {
  collapse: string;
  expand: string;
  collapseHint: string;
  expandHint: string;
  signOut: string;
  signOutHint: string;
}

const SidebarLabelsContext = createContext<SidebarLabels>({
  collapse: "",
  expand: "",
  collapseHint: "",
  expandHint: "",
  signOut: "",
  signOutHint: "",
});

/** Sign-out at the foot of the sidebar: icon and label, or the icon alone with a tooltip. */
export function SidebarSignOut() {
  const collapsed = useContext(CollapsedContext);
  const labels = useContext(SidebarLabelsContext);
  return (
    <form action="/auth/sign-out" method="post">
      <Tooltip side="right" content={labels.signOutHint}>
        <SubmitButton
          className={cn(rowClass(collapsed), "text-on-primary-muted hover:bg-white/10 hover:text-white")}
        >
          <LogOut aria-hidden="true" data-busy-hide="" className="size-4.5 shrink-0" />
          <span className={collapsed ? "sr-only" : undefined}>{labels.signOut}</span>
        </SubmitButton>
      </Tooltip>
    </form>
  );
}

/** Company name next to the logo: hidden when the sidebar is collapsed. */
export function WhenExpanded({ children }: { children: React.ReactNode }) {
  return useContext(CollapsedContext) ? null : children;
}

export function SidebarNav({ items, label }: { items: NavLinkItem[]; label: string }) {
  const pathname = usePathname();
  const collapsed = useContext(CollapsedContext);
  return (
    <nav aria-label={label} className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(item, pathname);
        const hasBadge = item.badge !== undefined && item.badge.count > 0;
        return (
          <Tooltip
            key={item.key}
            side="right"
            content={
              <>
                <span className="block font-semibold">
                  {item.label}
                  {hasBadge ? ` · ${item.badge?.label ?? ""}` : ""}
                </span>
                {item.hint !== undefined ? <span className="block text-white/80">{item.hint}</span> : null}
              </>
            }
          >
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-10 items-center gap-3 rounded-control text-sm font-medium transition-colors duration-150 ease-out",
                collapsed ? "justify-center px-0" : "px-3",
                active
                  ? "bg-white/16 font-semibold text-white hover:text-white"
                  : "text-on-primary-muted hover:bg-white/8 hover:text-white",
              )}
            >
              <NavItemIcon name={item.key} className="size-4.5" />
              <span className={collapsed ? "sr-only" : "flex-1 truncate"}>{item.label}</span>
              {collapsed ? (
                hasBadge ? (
                  <span className="absolute top-1.5 right-2.5 size-2.5 rounded-full bg-brand-accent ring-2 ring-primary-dark">
                    <span className="sr-only">{item.badge?.label}</span>
                  </span>
                ) : null
              ) : (
                <CountBadge badge={item.badge} />
              )}
            </Link>
          </Tooltip>
        );
      })}
    </nav>
  );
}
