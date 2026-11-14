import { getTranslations } from "next-intl/server";

import { ScrollRegion } from "@/components/ui/scroll-region";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate, formatMoney } from "@/lib/format";
import { INSTALLMENT_TONE, installmentStatus } from "@/lib/loans";

export interface InstallmentRow {
  installment_no: number;
  due_date: string;
  amount_cents: number;
  paid_cents: number;
  owed_cents: number;
  status: string;
}

/*
 * "Repayment schedule" on the loan page (SPEC addendum "Installment loans"): each installment's
 * date, amount and status. Status and amounts come from loan_installment_rows, which works them
 * out from the ledger; nothing here adds up money.
 */
export async function RepaymentSchedule({ rows }: { rows: InstallmentRow[] }) {
  const t = await getTranslations("loans.detail.schedule");
  const total = rows.reduce((sum, row) => sum + BigInt(row.amount_cents), 0n);
  const badge = (row: InstallmentRow) => {
    const status = installmentStatus(row.status);
    return <StatusBadge tone={INSTALLMENT_TONE[status]}>{t(`status.${status}`)}</StatusBadge>;
  };

  return (
    <section
      aria-labelledby="schedule-heading"
      className="min-w-0 rounded-card border border-line bg-surface"
      data-testid="repayment-schedule"
    >
      <div className="px-4 pt-4 sm:px-6 sm:pt-6">
        <h3 id="schedule-heading" className="text-base font-bold text-ink">
          {t("heading")}
        </h3>
        <p className="mt-1 text-sm text-ink-muted">{t("intro", { count: rows.length })}</p>
      </div>

      <ul className="mt-3 divide-y divide-page border-t border-page md:hidden" aria-label={t("label")}>
        {rows.map((row) => (
          <li key={row.installment_no} className="grid gap-1 px-4 py-3">
            <span className="flex items-center justify-between gap-3">
              <span className="tabular font-semibold">
                {t("line", {
                  number: row.installment_no,
                  amount: formatMoney(row.amount_cents),
                  date: formatDate(row.due_date),
                })}
              </span>
              <span className="shrink-0">{badge(row)}</span>
            </span>
            {row.owed_cents > 0 && row.paid_cents > 0 ? (
              <span className="tabular text-sm text-ink-muted">
                {t("owedOn", { amount: formatMoney(row.owed_cents) })}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      <ScrollRegion label={t("label")} className="mt-3 hidden md:block">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-subtle text-left text-[13px] text-ink-strong-muted">
            <tr>
              {(["no", "due", "amount", "paid", "owed", "status"] as const).map((column) => (
                <th
                  key={column}
                  scope="col"
                  className={
                    ["amount", "paid", "owed"].includes(column)
                      ? "px-4 py-2.5 text-right font-semibold"
                      : "px-4 py-2.5 font-semibold sm:px-6"
                  }
                >
                  {t(`columns.${column}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.installment_no} className="border-t border-page">
                <td className="tabular px-4 py-3 sm:px-6">{row.installment_no}</td>
                <td className="tabular px-4 py-3 whitespace-nowrap sm:px-6">{formatDate(row.due_date)}</td>
                <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                  {formatMoney(row.amount_cents)}
                </td>
                <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                  {formatMoney(row.paid_cents)}
                </td>
                <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                  {formatMoney(row.owed_cents)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap sm:px-6">{badge(row)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-line font-bold">
              <th scope="row" colSpan={2} className="px-4 py-3 text-left sm:px-6">
                {t("total")}
              </th>
              <td className="tabular px-4 py-3 text-right whitespace-nowrap">{formatMoney(total)}</td>
              <td colSpan={3} />
            </tr>
          </tfoot>
        </table>
      </ScrollRegion>
      <div className="pb-2 md:pb-4" />
    </section>
  );
}
