"use client";

import {
  Banknote,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  FileText,
  HandCoins,
  Gavel,
  History,
  LayoutDashboard,
  ListChecks,
  Lock,
  Package,
  Receipt,
  Settings,
  Users,
  Wallet,
  type LucideProps,
} from "lucide-react";

import { useLinkStatus } from "next/link";

import { Spinner } from "@/components/ui/pending";
import type { NavIcon as NavIconKey } from "@/lib/navigation";

const ICONS = {
  dashboard: LayoutDashboard,
  field: ListChecks,
  customers: Users,
  loans: Wallet,
  payments: Banknote,
  remittance: HandCoins,
  due: CalendarClock,
  collateral: Package,
  recovery: Gavel,
  approvals: ClipboardCheck,
  dayClose: Lock,
  expenses: Receipt,
  reports: FileText,
  ledger: BookOpen,
  audit: History,
  settings: Settings,
} satisfies Record<NavIconKey, React.ComponentType<LucideProps>>;

export function NavIcon({ name, ...props }: { name: NavIconKey } & LucideProps) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" strokeWidth={2} {...props} />;
}

/**
 * A menu item's icon inside its <Link>. While the page it opens is loading, the icon turns into a
 * spinner of the same size, so a tap or click is acknowledged at once.
 */
export function NavItemIcon({ name, className }: { name: NavIconKey; className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <Spinner className={className} /> : <NavIcon name={name} className={className} />;
}
