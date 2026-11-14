-- Installment loans (SPEC addendum "Installment loans", agreed with MSI on 2026-11-14).
--
-- A product is either "single" (one payment at the end, interest per month: every product so far)
-- or "installments" (equal monthly installments, interest charged once). Everything here only
-- adds: new columns default to the single / per-month behaviour, so existing products and loans
-- keep their rules, and the one-payment payout path is not touched (the schedule is written by a
-- trigger when an installment loan is paid out).
--
--  * Interest: per_month = principal x rate x months (unchanged, flat_interest);
--              once      = principal x rate, whatever the number of months.
--  * Schedule: n = term months; each installment = floor(total / n) cents, the last one takes the
--    remainder; installment k falls due k months after payout (add_months_clamped from the payout
--    date, so 31 Jan gives 28 Feb, 31 Mar, 30 Apr). The loan's due_date is the last installment's
--    date, so overdue marking, penalties and recovery keep counting from the final due date.
--  * No paid / unpaid flags are stored on installments: their status comes from the ledger (the
--    second migration of this feature).

-- 1. Products --------------------------------------------------------------------------------
alter table public.loan_products
  add column repayment_type text not null default 'single' check (repayment_type in ('single', 'installments')),
  add column interest_basis text not null default 'per_month' check (interest_basis in ('per_month', 'once')),
  add column min_term_months int not null default 1 check (min_term_months between 1 and 36),
  add constraint loan_product_min_term check (min_term_months <= default_term_months),
  add constraint loan_product_repayment check (
    (repayment_type = 'single' and interest_basis = 'per_month')
    or (repayment_type = 'installments' and interest_basis = 'once' and min_term_months >= 2));

comment on column public.loan_products.repayment_type is
  'single: one payment at the end; installments: equal monthly installments (term months = installments).';
comment on column public.loan_products.interest_basis is
  'per_month: principal x rate x months; once: principal x rate, charged once at payout.';
comment on column public.loan_products.min_term_months is 'Shortest term (months) the product allows.';

-- 2. Loan snapshot (copied from the product at submission, like the other terms) -------------
alter table public.loans
  add column repayment_type text not null default 'single' check (repayment_type in ('single', 'installments')),
  add column interest_basis text not null default 'per_month' check (interest_basis in ('per_month', 'once')),
  add column installment_count int check (installment_count between 2 and 36),
  add constraint loan_installment_snapshot check (
    (repayment_type = 'single' and installment_count is null)
    or (repayment_type = 'installments' and installment_count = term_months));

-- 3. Money helpers (the only place the formulas live) ----------------------------------------
create or replace function public.loan_interest(
  p_principal_cents bigint, p_rate_bps int, p_term_months int, p_basis text)
returns bigint
language sql
immutable
strict
set search_path = public
as $$
  select case p_basis
           when 'once' then pct(p_principal_cents, p_rate_bps)
           else flat_interest(p_principal_cents, p_rate_bps, p_term_months)
         end
$$;

create or replace function public.installment_schedule(p_total_cents bigint, p_count int, p_start date)
returns table (installment_no int, due_date date, amount_cents bigint)
language sql
immutable
strict
set search_path = public
as $$
  select k,
         add_months_clamped(p_start, k),
         case when k < p_count then p_total_cents / p_count
              else p_total_cents - (p_total_cents / p_count) * (p_count - 1) end
    from generate_series(1, p_count) as k
   where p_count >= 1 and p_total_cents > 0
$$;

revoke execute on function public.loan_interest(bigint, int, int, text),
  public.installment_schedule(bigint, int, date) from public, anon, authenticated, service_role;

-- 4. The schedule of a paid-out installment loan (immutable once written) --------------------
create table public.loan_installments (
  loan_id uuid not null references public.loans (id),
  installment_no int not null check (installment_no between 1 and 36),
  due_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default public.app_now(),
  primary key (loan_id, installment_no)
);

comment on table public.loan_installments is
  'Repayment schedule of an installment loan, written at payout and never changed. Paid / unpaid comes from the ledger (loan_installment_rows), never from here.';

create trigger loan_installments_immutable
  before update or delete on public.loan_installments
  for each row execute function public.trg_immutable();

alter table public.loan_installments enable row level security;
create policy loan_installments_read on public.loan_installments
  for select to authenticated using ((select public.is_staff()));
revoke all on public.loan_installments from anon;
revoke insert, update, delete, truncate, references, trigger on public.loan_installments from authenticated, service_role;

-- Written when an installment loan is paid out (approved -> active), from the snapshot taken at
-- submission, so the schedule always adds up to the principal and interest posted by R1.
create or replace function public.trg_loan_installment_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last date;
begin
  if new.repayment_type <> 'installments' or old.status <> 'approved' or new.status <> 'active' then
    return new;
  end if;
  insert into loan_installments (loan_id, installment_no, due_date, amount_cents)
  select new.id, s.installment_no, s.due_date, s.amount_cents
    from installment_schedule(new.principal_cents + new.interest_cents, new.installment_count, new.disbursed_on) s;
  select max(due_date) into v_last from loan_installments where loan_id = new.id;
  if v_last is distinct from new.due_date then
    raise exception 'INVALID_STATE: the last installment must fall on the loan''s due date' using errcode = '22023';
  end if;
  perform write_audit('loan.schedule_created', 'loan', new.id::text, null,
    jsonb_build_object('loan_no', new.loan_no, 'installments', new.installment_count,
                       'total_cents', new.principal_cents + new.interest_cents,
                       'schedule', (select jsonb_agg(jsonb_build_object('no', installment_no, 'due_date', due_date,
                                                                        'amount_cents', amount_cents)
                                                     order by installment_no)
                                      from loan_installments where loan_id = new.id)));
  return new;
end
$$;

revoke execute on function public.trg_loan_installment_schedule() from public, anon, authenticated, service_role;

create trigger loans_installment_schedule
  after update of status on public.loans
  for each row execute function public.trg_loan_installment_schedule();

-- 5. Product management: the admin sets the repayment type, interest basis and minimum term --
create or replace function public.upsert_loan_product(p_product jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := nullif(p_product ->> 'id', '')::uuid;
  v_before loan_products;
  v_row loan_products;
  v_key text;
begin
  perform require_role('admin');
  foreach v_key in array array['interest_rate_bps', 'default_term_months', 'min_term_months', 'max_term_months',
                               'penalty_rate_bps', 'penalty_period_days', 'penalty_max_periods', 'recovery_after_days'] loop
    if p_product ? v_key and (jsonb_typeof(p_product -> v_key) <> 'number' or (p_product ->> v_key) !~ '^[0-9]+$') then
      raise exception 'INVALID_STATE: % must be a whole number', v_key using errcode = '22023';
    end if;
  end loop;

  if v_id is not null then
    select * into v_before from loan_products where id = v_id for update;
    if not found then
      raise exception 'INVALID_STATE: the product does not exist' using errcode = 'P0002';
    end if;
  end if;
  if v_before.id is null then
    v_row := jsonb_populate_record(null::loan_products, jsonb_build_object(
      'id', gen_random_uuid(), 'rate_period', 'month', 'interest_method', 'flat',
      'penalty_base', 'outstanding_total', 'active', true, 'repayment_type', 'single', 'interest_basis', 'per_month',
      'min_term_months', 1)
      || (p_product - 'id' - 'created_at' - 'updated_at' - 'updated_by'));
  else
    v_row := jsonb_populate_record(v_before, p_product - 'id' - 'created_at' - 'updated_at' - 'updated_by');
  end if;
  v_row.name := btrim(coalesce(v_row.name, ''));
  -- The two kinds of product, each with its interest basis (SPEC addendum).
  if v_row.repayment_type = 'installments' then
    v_row.interest_basis := 'once';
    if v_row.min_term_months < 2 then
      raise exception 'INVALID_STATE: an installment product needs at least 2 months' using errcode = '22023';
    end if;
  elsif v_row.repayment_type = 'single' then
    v_row.interest_basis := 'per_month';
  end if;

  begin
    if v_before.id is null then
      insert into loan_products (id, name, interest_rate_bps, rate_period, interest_method, default_term_months,
                                 max_term_months, penalty_rate_bps, penalty_period_days, penalty_base,
                                 penalty_max_periods, recovery_after_days, active, updated_by,
                                 repayment_type, interest_basis, min_term_months)
      values (v_row.id, v_row.name, v_row.interest_rate_bps, v_row.rate_period, v_row.interest_method,
              v_row.default_term_months, v_row.max_term_months, v_row.penalty_rate_bps, v_row.penalty_period_days,
              v_row.penalty_base, v_row.penalty_max_periods, v_row.recovery_after_days, coalesce(v_row.active, true),
              auth.uid(), v_row.repayment_type, v_row.interest_basis, v_row.min_term_months)
      returning * into v_row;
    else
      update loan_products set
        name = v_row.name, interest_rate_bps = v_row.interest_rate_bps, rate_period = v_row.rate_period,
        interest_method = v_row.interest_method, default_term_months = v_row.default_term_months,
        max_term_months = v_row.max_term_months, penalty_rate_bps = v_row.penalty_rate_bps,
        penalty_period_days = v_row.penalty_period_days, penalty_base = v_row.penalty_base,
        penalty_max_periods = v_row.penalty_max_periods, recovery_after_days = v_row.recovery_after_days,
        active = coalesce(v_row.active, true), repayment_type = v_row.repayment_type,
        interest_basis = v_row.interest_basis, min_term_months = v_row.min_term_months,
        updated_at = app_now(), updated_by = auth.uid()
      where id = v_before.id
      returning * into v_row;
    end if;
  exception
    when unique_violation then
      raise exception 'INVALID_STATE: another product already has this name' using errcode = '23505';
    when check_violation or not_null_violation then
      raise exception 'INVALID_STATE: a product value is missing or out of range' using errcode = '22023';
  end;

  if v_before.id is null then
    perform write_audit('loan_product.created', 'loan_product', v_row.id::text, null,
                        to_jsonb(v_row) - 'created_at' - 'updated_at' - 'updated_by');
  elsif to_jsonb(v_before) - 'updated_at' - 'updated_by' is distinct from to_jsonb(v_row) - 'updated_at' - 'updated_by' then
    perform write_audit('loan_product.updated', 'loan_product', v_row.id::text,
                        to_jsonb(v_before) - 'created_at' - 'updated_at' - 'updated_by',
                        to_jsonb(v_row) - 'created_at' - 'updated_at' - 'updated_by');
  end if;
  return v_row.id;
end
$$;

revoke execute on function public.upsert_loan_product(jsonb) from public, anon, service_role;
grant execute on function public.upsert_loan_product(jsonb) to authenticated;

-- 6. Application checks: the term must be within the product's minimum and maximum -----------
create or replace function public.check_loan_application(p_loan jsonb, p_role app_role)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_customer customers;
  v_product loan_products;
  v_principal bigint;
  v_term int;
  v_purpose text := nullif(btrim(coalesce(p_loan ->> 'purpose', '')), '');
  v_officer uuid;
begin
  select * into v_customer from customers where id = nullif(p_loan ->> 'customer_id', '')::uuid;
  if not found then
    raise exception 'INVALID_STATE: choose a customer' using errcode = '22023';
  end if;
  if v_customer.status <> 'active' then
    raise exception 'INVALID_STATE: the customer is % and cannot get a new loan', v_customer.status using errcode = '22023';
  end if;
  if p_role = 'loan_officer' and v_customer.branch_id is distinct from auth_branch() then
    raise exception 'FORBIDDEN: a loan officer applies for customers of their own branch' using errcode = '42501';
  end if;
  select * into v_product from loan_products where id = nullif(p_loan ->> 'product_id', '')::uuid and active;
  if not found then
    raise exception 'INVALID_STATE: choose an active loan product' using errcode = '22023';
  end if;
  if jsonb_typeof(p_loan -> 'principal_cents') <> 'number' or (p_loan ->> 'principal_cents') !~ '^[0-9]+$'
     or (p_loan ->> 'principal_cents')::numeric <= 0 or (p_loan ->> 'principal_cents')::numeric > 100000000000 then
    raise exception 'INVALID_STATE: the amount must be a positive whole number of cents' using errcode = '22023';
  end if;
  v_principal := (p_loan ->> 'principal_cents')::bigint;
  if jsonb_typeof(p_loan -> 'term_months') <> 'number' or (p_loan ->> 'term_months') !~ '^[0-9]+$' then
    raise exception 'INVALID_STATE: the term must be a whole number of months' using errcode = '22023';
  end if;
  v_term := (p_loan ->> 'term_months')::int;
  if v_term < v_product.min_term_months or v_term > v_product.max_term_months then
    raise exception 'INVALID_STATE: the term must be % to % months', v_product.min_term_months, v_product.max_term_months
      using errcode = '22023';
  end if;
  if length(v_purpose) > 300 then
    raise exception 'INVALID_STATE: the purpose is too long (300 characters at most)' using errcode = '22023';
  end if;
  v_officer := case when p_role = 'loan_officer' then auth.uid()
                    else coalesce(nullif(p_loan ->> 'officer_id', '')::uuid, v_customer.assigned_officer_id) end;
  if v_officer is not null and not exists (
       select 1 from profiles where id = v_officer and active and role = 'loan_officer' and branch_id = v_customer.branch_id) then
    raise exception 'INVALID_STATE: the loan officer must be active and work at the customer''s branch' using errcode = '22023';
  end if;
  return jsonb_build_object('customer_id', v_customer.id, 'product_id', v_product.id, 'principal_cents', v_principal,
                            'term_months', v_term, 'purpose', v_purpose, 'branch_id', v_customer.branch_id,
                            'officer_id', v_officer);
end
$$;

revoke execute on function public.check_loan_application(jsonb, app_role) from public, anon, authenticated, service_role;

-- 7. Preview (the wizard): the same helpers as submission and payout --------------------------
create or replace function public.preview_loan_terms(
  p_principal_cents bigint, p_product_id uuid, p_term_months int, p_disbursed_on date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_product loan_products;
  v_on date := coalesce(p_disbursed_on, business_today());
  v_interest bigint;
  v_total bigint;
  v_due date;
  v_schedule jsonb;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  select * into v_product from loan_products where id = p_product_id and active;
  if not found then
    raise exception 'INVALID_STATE: choose an active loan product' using errcode = '22023';
  end if;
  if p_principal_cents is null or p_principal_cents <= 0 then
    raise exception 'INVALID_STATE: the amount must be more than zero' using errcode = '22023';
  end if;
  if p_term_months is null or p_term_months < v_product.min_term_months or p_term_months > v_product.max_term_months then
    raise exception 'INVALID_STATE: the term must be % to % months', v_product.min_term_months, v_product.max_term_months
      using errcode = '22023';
  end if;
  v_interest := loan_interest(p_principal_cents, v_product.interest_rate_bps, p_term_months, v_product.interest_basis);
  v_total := p_principal_cents + v_interest;
  v_due := add_months_clamped(v_on, p_term_months);
  if v_product.repayment_type = 'installments' then
    select jsonb_agg(jsonb_build_object('installment_no', s.installment_no, 'due_date', s.due_date,
                                        'amount_cents', s.amount_cents) order by s.installment_no)
      into v_schedule
      from installment_schedule(v_total, p_term_months, v_on) s;
  end if;
  -- A one-payment preview keeps exactly its earlier shape; installment products add the schedule.
  return jsonb_build_object(
    'principal_cents', p_principal_cents,
    'interest_rate_bps', v_product.interest_rate_bps,
    'term_months', p_term_months,
    'interest_cents', v_interest,
    'total_due_cents', v_total,
    'disbursed_on', v_on,
    'due_date', v_due,
    'penalty_rate_bps', v_product.penalty_rate_bps,
    'penalty_period_days', v_product.penalty_period_days,
    'penalty_base', v_product.penalty_base,
    'penalty_max_periods', v_product.penalty_max_periods,
    'first_penalty_on', case when v_product.penalty_max_periods > 0
                             then v_due + v_product.penalty_period_days end,
    'first_penalty_cents', case when v_product.penalty_max_periods > 0
                                then pct(v_total, v_product.penalty_rate_bps) end,
    'recovery_after_days', v_product.recovery_after_days)
    || case when v_product.repayment_type = 'installments'
            then jsonb_build_object('repayment_type', v_product.repayment_type,
                                    'interest_basis', v_product.interest_basis, 'installments', v_schedule)
            else '{}'::jsonb end;
end
$$;

revoke execute on function public.preview_loan_terms(bigint, uuid, int, date) from public, anon, service_role;
grant execute on function public.preview_loan_terms(bigint, uuid, int, date) to authenticated;

-- 8. Submission: snapshot of the repayment type, interest basis and installment count ---------
create or replace function public.submit_loan(p_loan_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
  v_product loan_products;
  v_customer customers;
  v_limit bigint;
  v_role app_role;
  v_interest bigint;
  v_installments int;
  v_request uuid;
  v_payload jsonb;
begin
  perform require_role('loan_officer', 'manager');
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.created_by <> auth.uid() then
    raise exception 'FORBIDDEN: only the person who created the draft can submit it' using errcode = '42501';
  end if;
  if v_loan.status <> 'draft' then
    raise exception 'INVALID_STATE: only a draft can be submitted' using errcode = '22023';
  end if;
  select * into v_customer from customers where id = v_loan.customer_id;
  if v_customer.status <> 'active' then
    raise exception 'INVALID_STATE: the customer is % and cannot get a new loan', v_customer.status using errcode = '22023';
  end if;
  select * into v_product from loan_products where id = v_loan.product_id and active;
  if not found then
    raise exception 'INVALID_STATE: the loan product is no longer offered; choose another' using errcode = '22023';
  end if;
  if v_loan.term_months > v_product.max_term_months then
    raise exception 'INVALID_STATE: the term is longer than the product allows' using errcode = '22023';
  end if;
  if v_loan.term_months < v_product.min_term_months then
    raise exception 'INVALID_STATE: the term is shorter than the product allows (at least % months)',
      v_product.min_term_months using errcode = '22023';
  end if;

  select (value #>> '{}')::bigint into v_limit from settings where key = 'approvals.loan_manager_limit_cents';
  v_role := (case when v_loan.principal_cents > v_limit then 'ceo' else 'manager' end)::app_role;
  v_interest := loan_interest(v_loan.principal_cents, v_product.interest_rate_bps, v_loan.term_months,
                              v_product.interest_basis);
  v_installments := case when v_product.repayment_type = 'installments' then v_loan.term_months end;

  update loans set
    status = 'pending_approval', submitted_at = app_now(), updated_at = app_now(),
    interest_rate_bps = v_product.interest_rate_bps, interest_cents = v_interest,
    repayment_type = v_product.repayment_type, interest_basis = v_product.interest_basis,
    installment_count = v_installments,
    penalty_rate_bps = v_product.penalty_rate_bps, penalty_period_days = v_product.penalty_period_days,
    penalty_base = v_product.penalty_base, penalty_max_periods = v_product.penalty_max_periods,
    recovery_after_days = v_product.recovery_after_days,
    collateral_required = coalesce((select (value #>> '{}')::boolean from settings where key = 'loans.collateral_required'), true)
  where id = v_loan.id;

  v_payload := jsonb_build_object(
    'loan_id', v_loan.id, 'loan_no', v_loan.loan_no, 'customer_id', v_customer.id, 'customer_code', v_customer.code,
    'customer_name', customer_display_name(v_customer), 'product', v_product.name,
    'principal_cents', v_loan.principal_cents, 'interest_cents', v_interest,
    'total_due_cents', v_loan.principal_cents + v_interest, 'term_months', v_loan.term_months,
    'interest_rate_bps', v_product.interest_rate_bps, 'limit_cents', v_limit, 'purpose', v_loan.purpose,
    'repayment_type', v_product.repayment_type, 'interest_basis', v_product.interest_basis,
    'installment_count', v_installments,
    'installment_cents', case when v_installments is not null
                              then (v_loan.principal_cents + v_interest) / v_installments end);
  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values ('loan_approval', 'loan', v_loan.id, v_payload, v_role, v_loan.purpose, auth.uid())
  returning id into v_request;

  perform write_audit('loan.submitted', 'loan', v_loan.id::text, jsonb_build_object('status', 'draft'),
    jsonb_build_object('status', 'pending_approval', 'required_role', v_role, 'interest_cents', v_interest,
                       'repayment_type', v_product.repayment_type, 'installment_count', v_installments,
                       'approval_request_id', v_request));
  perform write_audit('approval.requested', 'approval_request', v_request::text, null,
    jsonb_build_object('type', 'loan_approval', 'required_role', v_role, 'payload', v_payload));
  return v_request;
end
$$;

revoke execute on function public.submit_loan(uuid) from public, anon, service_role;
grant execute on function public.submit_loan(uuid) to authenticated;

-- 9. Extensions are not offered on installment loans in this version ---------------------------
create or replace function public.request_extension(p_loan_id uuid, p_extra_months int, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('loan_officer', 'manager');
  v_loan loans;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_max int;
  v_payload jsonb;
  v_id uuid;
begin
  if not coalesce((select (value #>> '{}')::boolean from settings where key = 'extension.enabled'), true) then
    raise exception 'INVALID_STATE: loan extensions are switched off' using errcode = '22023';
  end if;
  select * into v_loan from loans where id = p_loan_id for update;
  if not found then
    raise exception 'INVALID_STATE: the loan does not exist' using errcode = 'P0002';
  end if;
  if v_loan.repayment_type = 'installments' then
    raise exception 'INVALID_STATE: installment loans cannot be extended; the repayment schedule stays as agreed'
      using errcode = '22023';
  end if;
  if v_role = 'loan_officer' and v_loan.branch_id is distinct from auth_branch() then
    raise exception 'FORBIDDEN: a loan officer asks for extensions of loans of their own branch' using errcode = '42501';
  end if;
  if v_loan.status = 'recovery' then
    raise exception 'INVALID_STATE: a loan in recovery cannot be extended' using errcode = '22023';
  end if;
  if v_loan.status not in ('active', 'overdue') then
    raise exception 'INVALID_STATE: only a paid-out, open loan can be extended' using errcode = '22023';
  end if;
  select max_term_months into v_max from loan_products where id = v_loan.product_id;
  if p_extra_months is null or p_extra_months < 1 or p_extra_months > v_max then
    raise exception 'INVALID_STATE: extend by 1 to % months', v_max using errcode = '22023';
  end if;
  if v_reason is null or length(v_reason) > 300 then
    raise exception 'INVALID_STATE: give the reason for the extension (up to 300 characters)' using errcode = '22023';
  end if;
  if exists (select 1 from approval_requests where type = 'loan_extension' and entity_id = v_loan.id and status = 'pending') then
    raise exception 'INVALID_STATE: an extension of this loan is already waiting for approval' using errcode = '22023';
  end if;
  v_payload := extension_terms(v_loan, p_extra_months) || jsonb_build_object(
    'loan_id', v_loan.id, 'loan_no', v_loan.loan_no, 'due_date_version', v_loan.due_date_version,
    'customer_name', (select customer_display_name(c) from customers c where c.id = v_loan.customer_id),
    'next_penalty_on', (select next_penalty_on from loan_balance_rows() where loan_id = v_loan.id));
  insert into approval_requests (type, entity_type, entity_id, payload, required_role, reason, requested_by)
  values ('loan_extension', 'loan', v_loan.id, v_payload, 'manager', v_reason, auth.uid())
  returning id into v_id;
  perform write_audit('approval.requested', 'approval_request', v_id::text, null,
    jsonb_build_object('type', 'loan_extension', 'required_role', 'manager', 'payload', v_payload, 'reason', v_reason));
  return v_id;
end
$$;

revoke execute on function public.request_extension(uuid, int, text) from public, anon, service_role;
grant execute on function public.request_extension(uuid, int, text) to authenticated;

-- 10. The installment product (data only; editable in Settings -> Loan products) ---------------
-- 20% charged once, 2 to 6 monthly installments, the same late-payment rules as the standard
-- product (copied from it when it exists, otherwise the SPEC defaults it was seeded with).
insert into public.loan_products (name, interest_rate_bps, repayment_type, interest_basis, min_term_months,
                                  default_term_months, max_term_months, penalty_rate_bps, penalty_period_days,
                                  penalty_base, penalty_max_periods, recovery_after_days)
select 'Installment loan (monthly)', 2000, 'installments', 'once', 2, 3, 6,
       coalesce(s.penalty_rate_bps, 2000), coalesce(s.penalty_period_days, 7),
       coalesce(s.penalty_base, 'outstanding_total'), coalesce(s.penalty_max_periods, 4),
       coalesce(s.recovery_after_days, 30)
  from (select 1) one
  left join public.loan_products s on s.name = 'Standard 1-month'
on conflict (name) do nothing;
