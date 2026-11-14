-- Installment loans, part 3: documents (SPEC addendum; SPEC 10.1).
--
--  * loan_document_schedule: the schedule printed on the loan agreement. After payout it is the
--    stored schedule; before payout (an agreement can be printed once the loan is approved) the
--    amounts come from the loan's snapshot through installment_schedule, and the dates are left
--    empty because they count from the payout day.
--  * templates.loan_agreement_installments: the agreement wording for installment loans (interest
--    charged once, no further interest or penalty within the term, penalties only after the final
--    due date). It is a separate text, added only when missing, so an admin's own loan_agreement
--    wording is never replaced.

create or replace function public.loan_document_schedule(p_loan_id uuid)
returns table (installment_no int, due_date date, amount_cents bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_loan loans;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  select * into v_loan from loans where id = p_loan_id;
  if not found or v_loan.repayment_type <> 'installments' or v_loan.installment_count is null
     or v_loan.interest_cents is null then
    return;
  end if;
  if exists (select 1 from loan_installments i where i.loan_id = p_loan_id) then
    return query select i.installment_no, i.due_date, i.amount_cents
                   from loan_installments i where i.loan_id = p_loan_id order by i.installment_no;
  else
    return query select s.installment_no, null::date, s.amount_cents
                   from installment_schedule(v_loan.principal_cents + v_loan.interest_cents, v_loan.installment_count,
                                             business_today()) s
                  order by s.installment_no;
  end if;
end
$$;

revoke execute on function public.loan_document_schedule(uuid) from public, anon, service_role;
grant execute on function public.loan_document_schedule(uuid) to authenticated;

update public.settings
   set value = value || jsonb_build_object('loan_agreement_installments',
'1. Repayment. The borrower shall repay the total of {total} (the amount lent plus interest) to {company} in {installments} monthly installments as shown in the repayment schedule above, the last one on the final due date. Part payments and early payments may be made at any time. Payments are applied first to penalties, then to interest, then to the amount lent, and cover the oldest unpaid installment first.
2. Interest and fees. Interest is charged once, when the loan is paid out, and is included in the total above. No further interest is charged during the term, and paying early does not reduce the interest. No other fee is charged.
3. Late payment. While the loan is within its term, no penalty or extra interest is charged, even if an installment is paid late or in part; the borrower is then behind schedule and will be contacted. If any amount remains unpaid after the final due date, a penalty of {penalty_rate} of the amount then owed is added every {penalty_days} days, up to {penalty_max} times. After that, {company} may begin recovery.
4. Collateral. The borrower pledges the collateral listed below as security for this loan. {company} holds it until the loan is repaid in full and then returns it to the borrower. If the loan is not repaid, {company} may, after written notice, recover the debt under its recovery procedure, including by selling the collateral. Any amount left after the debt and the costs of recovery are paid is returned to the borrower; any shortfall remains owed.
5. Guarantors. Each guarantor named below agrees to pay what the borrower owes under this agreement if the borrower does not.
6. Borrower''s statements. The borrower confirms that the information given is true, that the collateral is the borrower''s own property and free of other claims, and that the borrower will tell {company} of any change of address or phone number.
7. Governing law. This agreement is governed by the laws of the Republic of Liberia. By signing below, the parties confirm that they have read and understood it.')
 where key = 'templates' and not (value ? 'loan_agreement_installments');
