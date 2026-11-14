-- Installment loans, part 2 (SPEC addendum): installment status from the ledger, arrears inside
-- the term (no charge), default after the final due date (the default example in tools/vectors.py:
-- penalties 120.00, 144.00, 172.80, 207.36 from 22 May; recovery from 14 Jun), due list, dashboard,
-- receipts, statement = ledger, trial balance.
begin;
\ir _helpers.psql
select plan(45);

insert into public.branches (code, name) values ('TS', 'Test Schedule');
select tests.create_staff('Officer TS', 'loan_officer', 'TS') as officer_id \gset
select tests.create_staff('Manager TS', 'manager') as manager_id \gset
select tests.create_staff('Cashier TS', 'cashier', 'TS') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Installment loan (monthly)' \gset
select id as standard_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
update public.settings set value = '["penalty", "interest", "principal"]' where key = 'payments.allocation_order';
update public.settings set value = '7' where key = 'due.upcoming_days';
delete from public.period_locks;

create function tests.set_day(p_day date) returns void language sql as $$
  update public.settings set value = jsonb_build_object('at', p_day::text || 'T09:00:00Z', 'frozen', true)
   where key = 'clock.override_at' $$;
create function tests.loan(p_officer uuid, p_manager uuid, p_cashier uuid, p_id_number text, p_product uuid,
                           p_principal bigint, p_months int, p_day date)
returns uuid language plpgsql as $$
declare v_customer uuid; v_id uuid;
begin
  perform tests.set_day(p_day);
  perform tests.become('authenticated', p_officer);
  perform public.create_customer(jsonb_build_object('type', 'individual', 'first_name', 'Schedule', 'last_name', p_id_number,
    'phone', '0987 ' || right(p_id_number, 6), 'id_type', 'national_id', 'id_number', p_id_number));
  select id into v_customer from public.customers where id_number = p_id_number;
  v_id := public.create_loan_draft(jsonb_build_object('customer_id', v_customer, 'product_id', p_product,
                                                      'principal_cents', p_principal, 'term_months', p_months));
  perform public.submit_loan(v_id);
  perform tests.become('authenticated', p_manager);
  perform public.decide_approval((select id from public.approval_requests where entity_id = v_id), 'approve', null);
  perform tests.become('authenticated', p_cashier);
  perform public.disburse_loan(v_id, 'cash', null, null);
  perform tests.unbecome();
  return v_id;
end $$;
-- Takes a payment at the counter on a day; returns the payment id.
create function tests.pay(p_cashier uuid, p_loan uuid, p_amount bigint, p_day date, p_key text) returns uuid
language plpgsql as $$
declare v_result jsonb;
begin
  perform tests.set_day(p_day);
  perform tests.become('authenticated', p_cashier);
  v_result := public.receive_payment(p_loan, p_amount, 'cash', null, null, p_key);
  perform tests.unbecome();
  return (v_result ->> 'payment_id')::uuid;
end $$;
-- Runs the daily job on each day from p_from to p_to (as the scheduler would).
create function tests.run_days(p_manager uuid, p_from date, p_to date) returns void language plpgsql as $$
declare d date := p_from;
begin
  while d <= p_to loop
    perform tests.set_day(d);
    perform tests.value_as('authenticated', p_manager, 'select public.run_daily_accruals()::text');
    d := d + 1;
  end loop;
end $$;
create function tests.statuses(p_loan uuid) returns text[] language sql as $$
  select array_agg(status order by installment_no)
    from public.installment_coverage(p_loan, public.installment_paid_cents(p_loan), public.business_today()) $$;
create function tests.owed_on(p_loan uuid) returns bigint[] language sql as $$
  select array_agg(owed_cents order by installment_no)
    from public.installment_coverage(p_loan, public.installment_paid_cents(p_loan), public.business_today()) $$;
create function tests.summary(p_manager uuid, p_loan uuid) returns jsonb language sql as $$
  select tests.value_as('authenticated', p_manager,
    format($q$select row_to_json(s)::text from public.loan_schedule_status s where loan_id = '%s'$q$, p_loan))::jsonb $$;
create function tests.due_row(p_manager uuid, p_loan uuid) returns jsonb language sql as $$
  select tests.value_as('authenticated', p_manager,
    format($q$select row_to_json(d)::text from public.due_list d where loan_id = '%s'$q$, p_loan))::jsonb $$;
create function tests.penalties(p_loan uuid) returns bigint[] language sql as $$
  select coalesce(array_agg(penalty_cents order by period_no), '{}') from public.loan_penalty_events where loan_id = p_loan $$;
create function tests.owed(p_loan uuid) returns bigint language sql as $$
  select penalty_cents + interest_cents + principal_cents from public.loan_owed(p_loan) $$;

-- A: the default example. $2,000 over 4 months paid out 15 Jan 2026 (4 x $600.00 from 15 Feb).
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TS-300001', :'product_id', 200000, 4, '2026-01-15') as loan_a \gset

-- Before anything is due.
select tests.set_day('2026-01-20');
select is(tests.statuses(:'loan_a'), array['due', 'not_due', 'not_due', 'not_due'], 'after payout: the first is due, the rest later');
select is(tests.summary(:'manager_id', :'loan_a') - 'loan_id',
  '{"installments": 4, "paid_count": 0, "part_paid_count": 0, "behind_count": 0, "not_due_count": 4, "next_no": 1,
    "next_due_date": "2026-02-15", "next_owed_cents": 60000, "arrears_cents": 0, "behind_since": null, "days_behind": 0,
    "due_now_cents": 0, "in_term": true}'::jsonb, 'summary: next installment 1, $600.00 on 15 Feb; nothing behind');
select is(tests.due_row(:'manager_id', :'loan_a'), null, 'not on the due list yet (15 Feb is more than 7 days away)');

-- A part payment of $300.00 on 10 Feb covers half of installment 1.
select tests.pay(:'cashier_id', :'loan_a', 30000, '2026-02-10', 'ts-key-a-1') as pay_a1 \gset
select is(tests.statuses(:'loan_a'), array['part_paid', 'not_due', 'not_due', 'not_due'], 'part payment: installment 1 part paid');
select is(tests.owed_on(:'loan_a'), array[30000, 60000, 60000, 60000]::bigint[], '$300.00 still owed on installment 1');
select is((select (d ->> 'bucket') || ' ' || (d ->> 'amount_due_cents') || ' ' || (d ->> 'due_date') || ' #' || (d ->> 'installment_no')
             from tests.due_row(:'manager_id', :'loan_a') d), 'due_7d 30000 2026-02-15 #1',
  'due list: the rest of installment 1 ($300.00) due on 15 Feb, not the whole balance');
select is((select d ->> 'total_out' from tests.due_row(:'manager_id', :'loan_a') d), '210000', 'the balance is still shown alongside');
select is(tests.value_as('authenticated', :'cashier_id', format($$select public.receipt_next_installment('%s')::text$$, :'pay_a1'))::jsonb,
  '{"installment_no": 1, "due_date": "2026-02-15", "amount_cents": 30000, "installment_cents": 60000, "installments": 4}'::jsonb,
  'receipt: next installment $300.00 due 15 Feb');

-- Installment 1 not completed by 15 Feb: behind from 16 Feb, no penalty inside the term.
select tests.run_days(:'manager_id', '2026-02-15', '2026-03-10');
select is(tests.statuses(:'loan_a'), array['behind', 'due', 'not_due', 'not_due'], '10 Mar: installment 1 behind, 2 due next');
select is((select status from public.loans where id = :'loan_a'), 'active', 'still active, not overdue (inside the term)');
select is(tests.penalties(:'loan_a'), '{}'::bigint[], 'mid-term arrears: no penalty charged');
select is(tests.owed(:'loan_a'), 210000::bigint, 'nothing was added to what is owed');
select is((select (s ->> 'arrears_cents') || ' ' || (s ->> 'days_behind') || ' ' || (s ->> 'behind_since')
             from tests.summary(:'manager_id', :'loan_a') s), '30000 23 2026-02-15', 'arrears $300.00, 23 days behind since 15 Feb');
select is((select (d ->> 'bucket') || ' ' || (d ->> 'amount_due_cents') || ' ' || (d ->> 'days')
             from tests.due_row(:'manager_id', :'loan_a') d), 'behind 30000 23', 'due list: "behind", $300.00, 23 days');
select ok(tests.value_as('authenticated', :'manager_id',
  $$select public.dashboard_data()::text$$)::jsonb -> 'due_now' @> jsonb_build_array(jsonb_build_object(
    'loan_id', :'loan_a', 'status', 'behind', 'owes_cents', 30000, 'due_date', '2026-02-15')),
  'dashboard: behind, $300.00 since 15 Feb');

-- Catch up: $900.00 on 10 Mar covers installment 1 and 2 ($1,200.00 in all).
select tests.pay(:'cashier_id', :'loan_a', 90000, '2026-03-10', 'ts-key-a-2') as pay_a2 \gset
select is(tests.statuses(:'loan_a'), array['paid', 'paid', 'due', 'not_due'], 'after catching up: 1 and 2 paid, 3 due');
select is(tests.due_row(:'manager_id', :'loan_a'), null, 'off the due list (15 Apr is not within 7 days)');
select is(tests.value_as('authenticated', :'cashier_id', format($$select public.receipt_next_installment('%s')::text$$, :'pay_a2'))::jsonb ->> 'due_date',
  '2026-04-15', 'receipt: next installment due 15 Apr');
select is(tests.value_as('authenticated', :'cashier_id', format($$select public.receipt_next_installment('%s')::text$$, :'pay_a1'))::jsonb ->> 'amount_cents',
  '30000', 'an older receipt still shows what was next at the time');

-- $600.00 on 15 Apr: $1,800.00 paid in total; nothing more by 15 May.
select tests.pay(:'cashier_id', :'loan_a', 60000, '2026-04-15', 'ts-key-a-3') as pay_a3 \gset
select tests.run_days(:'manager_id', '2026-03-11', '2026-05-15');
select is(tests.statuses(:'loan_a'), array['paid', 'paid', 'paid', 'due'], '15 May: installment 4 due today');
select is((select (d ->> 'bucket') || ' ' || (d ->> 'amount_due_cents') from tests.due_row(:'manager_id', :'loan_a') d),
  'due_today 60000', 'due list: $600.00 due today');
select results_eq(format($$select principal_cents, interest_cents, penalty_cents from public.loan_owed('%s')$$, :'loan_a'),
  $$values (60000::bigint, 0::bigint, 0::bigint)$$, '$1,800.00 paid interest first: $600.00 of principal left');
select is((select status from public.loans where id = :'loan_a'), 'active', 'on the final due date the loan is not overdue');

-- Default: 16 May overdue with $600.00 owed; penalties from 22 May exactly as one-payment loans.
select tests.run_days(:'manager_id', '2026-05-16', '2026-05-16');
select is((select status from public.loans where id = :'loan_a'), 'overdue', '16 May: overdue');
select is((select (d ->> 'bucket') || ' ' || (d ->> 'amount_due_cents') || ' ' || (d ->> 'days')
             from tests.due_row(:'manager_id', :'loan_a') d), 'overdue_1_7 60000 1', 'due list: an ordinary overdue loan, $600.00, 1 day');
select is(tests.statuses(:'loan_a'), array['paid', 'paid', 'paid', 'behind'], 'installment 4 behind');
select tests.run_days(:'manager_id', '2026-05-17', '2026-05-21');
select is(tests.penalties(:'loan_a'), '{}'::bigint[], 'no penalty before day 7');
select tests.run_days(:'manager_id', '2026-05-22', '2026-05-22');
select is(tests.penalties(:'loan_a'), '{12000}'::bigint[], '22 May: first penalty 20% of $600.00 = $120.00');
select is((select charged_on from public.loan_penalty_events where loan_id = :'loan_a' and period_no = 1), '2026-05-22'::date,
  'charged on the final due date + 7');
select tests.run_days(:'manager_id', '2026-05-23', '2026-06-13');
select is(tests.penalties(:'loan_a'), '{12000,14400,17280,20736}'::bigint[], 'four weekly penalties: $120.00, $144.00, $172.80, $207.36');
select is(tests.owed(:'loan_a'), 124416::bigint, 'owed $1,244.16 (vectors.py)');
select is(tests.owed_on(:'loan_a'), array[0, 0, 0, 60000]::bigint[], 'penalties do not change the schedule: $600.00 left on installment 4');
select is((select recovery_eligible from public.loans where id = :'loan_a'), false, '13 Jun: not yet eligible for recovery');
select tests.run_days(:'manager_id', '2026-06-14', '2026-06-14');
select is((select recovery_eligible from public.loans where id = :'loan_a'), true, '14 Jun (final due date + 30): eligible for recovery');

-- A penalty payment clears penalties, not installments.
select tests.pay(:'cashier_id', :'loan_a', 12000, '2026-06-14', 'ts-key-a-4') as pay_a4 \gset
select is(tests.owed_on(:'loan_a'), array[0, 0, 0, 60000]::bigint[], 'a $120.00 payment goes to penalties: installment 4 unchanged');

-- Statement and ledger agree; the books balance.
select is((tests.value_as('authenticated', :'manager_id', format($$select public.loan_statement('%s')::text$$, :'loan_a'))::jsonb
            ->> 'closing_cents')::bigint, tests.owed(:'loan_a'), 'statement closing balance = ledger balance');
select is((select sum(debit_cents) - sum(credit_cents) from public.trial_balance('2026-06-14'))::bigint, 0::bigint,
  'trial balance still balanced');

-- B: paid off early (no discount: interest was charged once at payout).
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TS-300002', :'product_id', 150000, 3, '2026-01-15') as loan_b \gset
select tests.pay(:'cashier_id', :'loan_b', 180000, '2026-01-25', 'ts-key-b-1') as pay_b1 \gset
select is((select status from public.loans where id = :'loan_b'), 'closed', 'paying $1,800.00 early closes the loan');
select is(tests.statuses(:'loan_b'), array['paid', 'paid', 'paid'], 'every installment paid');
select is(tests.value_as('authenticated', :'cashier_id', format($$select public.receipt_next_installment('%s')::text$$, :'pay_b1')),
  null, 'the receipt shows no next installment');
select matches(tests.try_as('authenticated', :'cashier_id', format($$select public.receive_payment('%s', 1, 'cash', null, null, 'ts-key-b-2')$$, :'loan_b')),
  '^(INVALID_STATE|OVERPAYMENT)', 'nothing more can be paid (no overpayment)');

-- C: one-payment loans on the due list exactly as before (amount due = what is owed).
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TS-300003', :'standard_id', 100000, 1, '2026-05-10') as loan_c \gset
select tests.set_day('2026-06-09');
select is((select (d ->> 'bucket') || ' ' || (d ->> 'amount_due_cents') || ' ' || (d ->> 'total_out') || ' ' || (d ->> 'repayment_type')
             from tests.due_row(:'manager_id', :'loan_c') d), 'due_7d 120000 120000 single', 'one-payment loan: unchanged');
select is(tests.value_as('authenticated', :'cashier_id',
  format($$select count(*)::text from public.loan_schedule_status where loan_id = '%s'$$, :'loan_c')), '0',
  'a one-payment loan has no schedule status');

-- Reminders: the installment text is a known kind and is audited.
select is(tests.try_as('authenticated', :'officer_id', format($$select public.log_reminder_opened('%s', 'reminder_installment')$$, :'loan_a')),
  null, 'an installment reminder is logged');
select ok((select value ? 'reminder_installment' from public.settings where key = 'templates'), 'the installment reminder text exists');

select * from finish();
rollback;
