import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/** The amount to suggest when taking a payment on an installment loan (SPEC addendum). */
export interface InstallmentSuggestion {
  amountCents: string;
  installmentNo: number;
  dueDate: string;
  behind: boolean;
}

/*
 * From loan_schedule_status (worked out in SQL from the ledger): everything due by today when the
 * loan is behind or an installment is due today, otherwise the next installment. Only inside the
 * term: after the final due date the loan is overdue and the whole balance is what is owed. The
 * cashier can still enter any amount.
 */
export async function installmentSuggestion(
  supabase: Client,
  loanId: string,
): Promise<InstallmentSuggestion | null> {
  const { data } = await supabase
    .from("loan_schedule_status")
    .select("*")
    .eq("loan_id", loanId)
    .maybeSingle();
  if (data === null || data.in_term !== true || data.next_no === null || data.next_due_date === null)
    return null;
  const dueNow = data.due_now_cents ?? 0;
  return {
    amountCents: String(dueNow > 0 ? dueNow : (data.next_owed_cents ?? 0)),
    installmentNo: data.next_no,
    dueDate: dueNow > 0 ? (data.behind_since ?? data.next_due_date) : data.next_due_date,
    behind: (data.arrears_cents ?? 0) > 0,
  };
}
