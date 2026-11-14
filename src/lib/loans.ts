import type { BadgeTone } from "@/components/ui/status-badge";

/*
 * What a loan's status pill says (mock-ups 06, 07, 08). The stored status comes from the RPCs;
 * "due today" and "N days overdue" are read from the due date and the ledger balance, so the pill
 * is right even before the daily job (M5) has marked the loan overdue.
 */
export interface LoanStatusInput {
  status: string;
  dueDate: string | null;
  daysOverdue: number;
  totalOutCents: bigint;
  closedOn: string | null;
  today: string;
  /** required_role of the pending approval, when the user may see it. */
  pendingRole?: string | null;
}

export type LoanPill =
  | {
      key:
        | "draft"
        | "pendingApproval"
        | "pendingCeo"
        | "approved"
        | "active"
        | "dueToday"
        | "recovery"
        | "closed"
        | "rejected"
        | "cancelled"
        | "writtenOff";
      tone: BadgeTone;
    }
  | { key: "overdue"; tone: BadgeTone; days: number }
  | { key: "behind"; tone: BadgeTone; days: number }
  | { key: "closedOn"; tone: BadgeTone; date: string };

const RECENT_DAYS = 30;

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function loanPill(loan: LoanStatusInput): LoanPill {
  switch (loan.status) {
    case "draft":
      return { key: "draft", tone: "pending" };
    case "pending_approval":
      return loan.pendingRole === "ceo"
        ? { key: "pendingCeo", tone: "pending" }
        : { key: "pendingApproval", tone: "pending" };
    case "approved":
      return { key: "approved", tone: "due" };
    case "recovery":
      return { key: "recovery", tone: "recovery" };
    case "closed":
      return loan.closedOn !== null && daysBetween(loan.closedOn, loan.today) <= RECENT_DAYS
        ? { key: "closedOn", tone: "pending", date: loan.closedOn }
        : { key: "closed", tone: "pending" };
    case "rejected":
      return { key: "rejected", tone: "pending" };
    case "cancelled":
      return { key: "cancelled", tone: "pending" };
    case "written_off":
      return { key: "writtenOff", tone: "pending" };
    case "behind":
      // An installment loan inside its term with an installment unpaid: followed up, not overdue.
      return { key: "behind", tone: "due", days: loan.daysOverdue };
    default: {
      // active or overdue
      if (loan.totalOutCents > 0n && loan.daysOverdue > 0) {
        return { key: "overdue", tone: "overdue", days: loan.daysOverdue };
      }
      if (loan.dueDate === loan.today && loan.totalOutCents > 0n) return { key: "dueToday", tone: "due" };
      return { key: "active", tone: "active" };
    }
  }
}

/** Tabs on /loans (mock-up 06). */
export const LOAN_TABS = ["all", "active", "dueToday", "overdue", "recovery", "pending", "closed"] as const;
export type LoanTab = (typeof LOAN_TABS)[number];

/*
 * Installments (SPEC addendum "Installment loans"). Their status is worked out in SQL from the
 * ledger (loan_installment_rows); these map it to the words and colours on screen.
 */
export const INSTALLMENT_STATUSES = ["paid", "part_paid", "due", "behind", "not_due"] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];

export function installmentStatus(value: unknown): InstallmentStatus {
  return INSTALLMENT_STATUSES.find((status) => status === value) ?? "not_due";
}

export const INSTALLMENT_TONE: Record<InstallmentStatus, BadgeTone> = {
  paid: "active",
  part_paid: "due",
  due: "due",
  behind: "overdue",
  not_due: "pending",
};
