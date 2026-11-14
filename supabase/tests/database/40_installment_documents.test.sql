-- Installment loans, part 3 (SPEC addendum; SPEC 10.1): the schedule printed on the agreement,
-- before payout (amounts from the snapshot, no dates yet) and after (the stored schedule).
begin;
\ir _helpers.psql
select plan(6);

insert into public.branches (code, name) values ('TD', 'Test Documents');
select tests.create_staff('Officer TD', 'loan_officer', 'TD') as officer_id \gset
select tests.create_staff('Manager TD', 'manager') as manager_id \gset
select tests.create_staff('Cashier TD', 'cashier', 'TD') as cashier_id \gset
select id as product_id from public.loan_products where name = 'Installment loan (monthly)' \gset
select id as standard_id from public.loan_products where name = 'Standard 1-month' \gset
update public.settings set value = 'null' where key = 'migration.go_live_date';
update public.settings set value = 'false' where key = 'disbursement.check_funds';
update public.settings set value = 'false' where key = 'loans.collateral_required';
update public.settings set value = jsonb_build_object('at', '2026-01-31T09:00:00Z', 'frozen', true)
 where key = 'clock.override_at';
delete from public.period_locks;

create function tests.approved(p_officer uuid, p_manager uuid, p_id_number text, p_product uuid, p_principal bigint, p_months int)
returns uuid language plpgsql as $$
declare v_customer uuid; v_id uuid;
begin
  perform tests.become('authenticated', p_officer);
  perform public.create_customer(jsonb_build_object('type', 'individual', 'first_name', 'Document', 'last_name', p_id_number,
    'phone', '0988 ' || right(p_id_number, 6), 'id_type', 'national_id', 'id_number', p_id_number));
  select id into v_customer from public.customers where id_number = p_id_number;
  v_id := public.create_loan_draft(jsonb_build_object('customer_id', v_customer, 'product_id', p_product,
                                                      'principal_cents', p_principal, 'term_months', p_months));
  perform public.submit_loan(v_id);
  perform tests.become('authenticated', p_manager);
  perform public.decide_approval((select id from public.approval_requests where entity_id = v_id), 'approve', null);
  perform tests.unbecome();
  return v_id;
end $$;
create function tests.doc_schedule(p_user uuid, p_loan uuid) returns text language sql as $$
  select tests.value_as('authenticated', p_user, format($q$select string_agg(installment_no || ':' || coalesce(due_date::text, '-')
    || ':' || amount_cents, ' ' order by installment_no) from public.loan_document_schedule('%s')$q$, p_loan)) $$;

select tests.approved(:'officer_id', :'manager_id', 'TD-400001', :'product_id', 200000, 4) as loan_a \gset
select is(tests.doc_schedule(:'officer_id', :'loan_a'), '1:-:60000 2:-:60000 3:-:60000 4:-:60000',
  'approved, not paid out: 4 x $600.00, dates count from the payout day');
select tests.value_as('authenticated', :'cashier_id', format($$select public.disburse_loan('%s', 'cash')::text$$, :'loan_a'));
select is(tests.doc_schedule(:'officer_id', :'loan_a'),
  '1:2026-02-28:60000 2:2026-03-31:60000 3:2026-04-30:60000 4:2026-05-31:60000',
  'paid out 31 Jan: the stored schedule with its dates');
select tests.approved(:'officer_id', :'manager_id', 'TD-400002', :'standard_id', 100000, 1) as loan_s \gset
select is(tests.doc_schedule(:'officer_id', :'loan_s'), null, 'a one-payment loan has no schedule on its agreement');
select is(tests.try_as('anon', null, format($$select * from public.loan_document_schedule('%s')$$, :'loan_a')),
  'permission denied for function loan_document_schedule', 'not for anonymous users');
select ok((select value ? 'loan_agreement_installments' and value ? 'loan_agreement' from public.settings where key = 'templates'),
  'the installment agreement wording sits next to the standard one');
select ok((select value ->> 'loan_agreement_installments' like '%charged once%after the final due date%'
             from public.settings where key = 'templates'),
  'it says interest is charged once and penalties start only after the final due date');

select * from finish();
rollback;
