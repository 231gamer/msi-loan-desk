-- Installment loans, part 1 (SPEC addendum): products, interest charged once, the schedule and its
-- rounding, month-end dates, the snapshot at submission, the schedule written at payout,
-- extensions refused. Expected values come from tools/vectors.py (section "Installment loans").
begin;
\ir _helpers.psql
select plan(40);

insert into public.branches (code, name) values ('TI', 'Test Installments');
select tests.create_staff('Officer TI', 'loan_officer', 'TI') as officer_id \gset
select tests.create_staff('Manager TI', 'manager') as manager_id \gset
select tests.create_staff('Cashier TI', 'cashier', 'TI') as cashier_id \gset
select tests.create_staff('Admin TI', 'admin') as admin_id \gset
select id as standard_id from public.loan_products where name = 'Standard 1-month' \gset
select id as product_id from public.loan_products where name = 'Installment loan (monthly)' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
delete from public.period_locks;

create function tests.set_day(p_day date) returns void language sql as $$
  update public.settings set value = jsonb_build_object('at', p_day::text || 'T09:00:00Z', 'frozen', true)
   where key = 'clock.override_at' $$;
-- Applies, approves and pays out a loan through the same RPCs staff use; returns the loan id.
create function tests.loan(p_officer uuid, p_manager uuid, p_cashier uuid, p_id_number text, p_product uuid,
                           p_principal bigint, p_months int, p_day date)
returns uuid language plpgsql as $$
declare v_customer uuid; v_id uuid;
begin
  perform tests.set_day(p_day);
  perform tests.become('authenticated', p_officer);
  perform public.create_customer(jsonb_build_object('type', 'individual', 'first_name', 'Installment', 'last_name', p_id_number,
    'phone', '0986 ' || right(p_id_number, 6), 'id_type', 'national_id', 'id_number', p_id_number));
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
create function tests.amounts(p_loan uuid) returns bigint[] language sql as $$
  select array_agg(amount_cents order by installment_no) from public.loan_installments where loan_id = p_loan $$;
create function tests.dates(p_loan uuid) returns date[] language sql as $$
  select array_agg(due_date order by installment_no) from public.loan_installments where loan_id = p_loan $$;

-- 1. The seeded product and the product rules.
select results_eq(format($$select repayment_type, interest_basis, interest_rate_bps, min_term_months, max_term_months,
                                  penalty_rate_bps, penalty_period_days, penalty_max_periods, recovery_after_days
                             from public.loan_products where id = '%s'$$, :'product_id'),
  $$values ('installments'::text, 'once'::text, 2000, 2, 6, 2000, 7, 4, 30)$$,
  'the installment product: 20% once, 2 to 6 months, the standard late-payment rules');
select results_eq(format($$select repayment_type, interest_basis, min_term_months from public.loan_products where id = '%s'$$,
                         :'standard_id'),
  $$values ('single'::text, 'per_month'::text, 1)$$, 'the standard product keeps one payment, interest per month');
select throws_ok($$insert into public.loan_products (name, interest_rate_bps, repayment_type, interest_basis, default_term_months,
                    max_term_months, penalty_rate_bps, penalty_period_days, penalty_max_periods, recovery_after_days)
                  values ('Mixed', 2000, 'installments', 'per_month', 2, 3, 2000, 7, 4, 30)$$,
  '23514', null, 'installments always go with interest charged once');
select is(tests.try_as('authenticated', :'admin_id', $$select public.upsert_loan_product('{"name": "Bad installments",
  "interest_rate_bps": 2000, "repayment_type": "installments", "min_term_months": 1, "default_term_months": 2,
  "max_term_months": 6, "penalty_rate_bps": 2000, "penalty_period_days": 7, "penalty_max_periods": 4,
  "recovery_after_days": 30}'::jsonb)$$),
  'INVALID_STATE: an installment product needs at least 2 months', 'an installment product needs at least 2 months');
select tests.value_as('authenticated', :'admin_id', $$select public.upsert_loan_product('{"name": "Installments up to 12",
  "interest_rate_bps": 2000, "repayment_type": "installments", "interest_basis": "per_month", "min_term_months": 2,
  "default_term_months": 4, "max_term_months": 12, "penalty_rate_bps": 2000, "penalty_period_days": 7,
  "penalty_max_periods": 4, "recovery_after_days": 30}'::jsonb)::text$$) as long_product_id \gset
select is((select interest_basis from public.loan_products where id = :'long_product_id'), 'once',
  'the admin creates an installment product; its interest is charged once whatever was sent');
select ok(exists (select 1 from public.audit_log where action = 'loan_product.created' and entity_id = :'long_product_id'
                  and after ->> 'repayment_type' = 'installments'), 'the new product is audited with its repayment type');

-- 2. Interest once versus per month, and the four worked examples (vectors.py).
select is(public.loan_interest(200000, 2000, 4, 'once'), 40000::bigint, '$2,000 over 4 months, once: $400.00');
select is(public.loan_interest(200000, 2000, 4, 'per_month'), 160000::bigint, 'per month it would be $1,600.00 (unchanged rule)');
select is(public.loan_interest(100000, 2000, 1, 'per_month'), public.flat_interest(100000, 2000, 1),
  'one-payment loans: the same formula as before');
select is(array(select amount_cents from public.installment_schedule(240000, 4, '2026-01-15') order by 1),
  array[60000, 60000, 60000, 60000]::bigint[], '$2,400 in 4 installments of $600.00');
select is(array(select amount_cents from public.installment_schedule(180000, 3, '2026-01-15') order by installment_no),
  array[60000, 60000, 60000]::bigint[], '$1,800 in 3 installments of $600.00');
select is(array(select amount_cents from public.installment_schedule(120000, 7, '2026-01-15') order by installment_no),
  array[17142, 17142, 17142, 17142, 17142, 17142, 17148]::bigint[], '$1,200 in 7: six of $171.42, the last $171.48');
select is(array(select amount_cents from public.installment_schedule(90000, 2, '2026-01-15') order by installment_no),
  array[45000, 45000]::bigint[], '$900 in 2 installments of $450.00');
select is((select sum(amount_cents) from public.installment_schedule(120000, 7, '2026-01-15'))::bigint, 120000::bigint,
  'the installments add up exactly to the total');
select is(array(select due_date from public.installment_schedule(180000, 4, '2026-01-31') order by installment_no),
  array['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']::date[],
  'paid out 31 Jan: 28 Feb, 31 Mar, 30 Apr, 31 May (month-end clamping from the payout day)');

-- 3. The preview the wizard shows comes from the same helpers.
select tests.set_day('2026-01-15');
select is((tests.value_as('authenticated', :'officer_id',
            format($$select public.preview_loan_terms(200000, '%s', 4)::text$$, :'product_id'))::jsonb)
           - 'penalty_rate_bps' - 'penalty_period_days' - 'penalty_base' - 'penalty_max_periods' - 'first_penalty_on'
           - 'first_penalty_cents' - 'recovery_after_days' - 'interest_rate_bps',
  '{"principal_cents": 200000, "term_months": 4, "repayment_type": "installments", "interest_basis": "once",
    "interest_cents": 40000, "total_due_cents": 240000, "disbursed_on": "2026-01-15", "due_date": "2026-05-15",
    "installments": [{"installment_no": 1, "due_date": "2026-02-15", "amount_cents": 60000},
                     {"installment_no": 2, "due_date": "2026-03-15", "amount_cents": 60000},
                     {"installment_no": 3, "due_date": "2026-04-15", "amount_cents": 60000},
                     {"installment_no": 4, "due_date": "2026-05-15", "amount_cents": 60000}]}'::jsonb,
  'preview: interest $400.00, total $2,400.00, 4 x $600.00 from 15 Feb to 15 May');
select matches(tests.try_as('authenticated', :'officer_id',
                 format($$select public.preview_loan_terms(200000, '%s', 1)$$, :'product_id')),
  '^INVALID_STATE: the term must be 2 to 6 months', 'one month is too short for installments');
select matches(tests.try_as('authenticated', :'officer_id',
                 format($$select public.preview_loan_terms(200000, '%s', 7)$$, :'product_id')),
  '^INVALID_STATE: the term must be 2 to 6 months', 'seven months is longer than the product allows');
select is((tests.value_as('authenticated', :'officer_id',
            format($$select public.preview_loan_terms(100000, '%s', 1)::text$$, :'standard_id'))::jsonb) -> 'installments',
  null::jsonb, 'a one-payment preview has no schedule (and keeps its earlier shape)');

-- 4. Through the workflow: submit (snapshot), approve, pay out (schedule written).
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TI-200001', :'product_id', 200000, 4, '2026-01-15') as loan_a \gset
select results_eq(format($$select repayment_type, interest_basis, installment_count, interest_cents, term_months, due_date, status
                             from public.loans where id = '%s'$$, :'loan_a'),
  $$values ('installments'::text, 'once'::text, 4, 40000::bigint, 4, '2026-05-15'::date, 'active'::text)$$,
  'snapshot: installments, once, 4; interest $400.00; due date = the last installment');
select is(tests.amounts(:'loan_a'), array[60000, 60000, 60000, 60000]::bigint[], 'payout writes 4 installments of $600.00');
select is(tests.dates(:'loan_a'), array['2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15']::date[],
  'due 15 Feb, 15 Mar, 15 Apr and 15 May 2026');
select results_eq(format($$select principal_cents, interest_cents, penalty_cents from public.loan_owed('%s')$$, :'loan_a'),
  $$values (200000::bigint, 40000::bigint, 0::bigint)$$, 'the ledger holds $2,000.00 principal and $400.00 interest (R1 unchanged)');
select is((select payload ->> 'installment_cents' from public.approval_requests where entity_id = :'loan_a'), '60000',
  'the approval card shows the monthly installment');
select ok(exists (select 1 from public.audit_log where action = 'loan.schedule_created' and entity_id = :'loan_a'
                  and (after ->> 'installments')::int = 4), 'the schedule is audited');
select throws_ok(format($$update public.loan_installments set amount_cents = 1 where loan_id = '%s'$$, :'loan_a'),
  '42501', 'IMMUTABLE_RECORD: UPDATE on loan_installments is not allowed', 'the schedule cannot be changed');
select throws_ok(format($$delete from public.loan_installments where loan_id = '%s'$$, :'loan_a'),
  '42501', 'IMMUTABLE_RECORD: DELETE on loan_installments is not allowed', 'nor deleted');
select is(tests.try_as('authenticated', :'officer_id', format($$insert into public.loan_installments
  (loan_id, installment_no, due_date, amount_cents) values ('%s', 9, '2027-01-01', 1)$$, :'loan_a')),
  'permission denied for table loan_installments', 'staff cannot write a schedule');
select is(tests.value_as('authenticated', :'officer_id',
  format($$select count(*)::text from public.loan_installments where loan_id = '%s'$$, :'loan_a')), '4', 'staff can read it');
select is(tests.try_as('anon', null, $$select count(*) from public.loan_installments$$),
  'permission denied for table loan_installments', 'anonymous users cannot read schedules');

-- The other examples through the workflow (a 12-month product for the 7-month example).
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TI-200002', :'product_id', 150000, 3, '2026-01-15') as loan_b \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TI-200003', :'long_product_id', 100000, 7, '2026-01-31') as loan_c \gset
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TI-200004', :'product_id', 75000, 2, '2026-01-15') as loan_d \gset
select is(tests.amounts(:'loan_b'), array[60000, 60000, 60000]::bigint[], '$1,500 over 3: 3 x $600.00');
select is(tests.amounts(:'loan_c'), array[17142, 17142, 17142, 17142, 17142, 17142, 17148]::bigint[],
  '$1,000 over 7: 6 x $171.42 and $171.48');
select is(tests.dates(:'loan_c'), array['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31',
  '2026-08-31']::date[], 'paid out 31 Jan: every date clamps to the month end');
select is((select due_date from public.loans where id = :'loan_c'), '2026-08-31'::date, 'its due date is the last installment');
select is(tests.amounts(:'loan_d'), array[45000, 45000]::bigint[], '$750 over 2: 2 x $450.00');
select is((select interest_cents from public.loans where id = :'loan_d'), 15000::bigint, '$750: interest $150.00 once');

-- 5. One-payment loans are unchanged.
select tests.loan(:'officer_id', :'manager_id', :'cashier_id', 'TI-200005', :'standard_id', 100000, 1, '2026-01-05') as loan_s \gset
select results_eq(format($$select repayment_type, interest_basis, installment_count, interest_cents, due_date
                             from public.loans where id = '%s'$$, :'loan_s'),
  $$values ('single'::text, 'per_month'::text, null::int, 20000::bigint, '2026-02-05'::date)$$,
  'a standard loan: one payment, $200.00 interest, due a month later (T-02)');
select is(tests.amounts(:'loan_s'), null::bigint[], 'a one-payment loan has no schedule rows');

-- 6. Extensions are refused for installment loans, still possible for one-payment loans.
select is(tests.try_as('authenticated', :'officer_id',
            format($$select public.request_extension('%s', 1, 'Asked for more time')$$, :'loan_a')),
  'INVALID_STATE: installment loans cannot be extended; the repayment schedule stays as agreed',
  'an installment loan cannot be extended');
select is(tests.try_as('authenticated', :'officer_id',
            format($$select public.request_extension('%s', 1, 'Asked for more time')$$, :'loan_s')),
  null, 'a one-payment loan can still be extended');

select * from finish();
rollback;
