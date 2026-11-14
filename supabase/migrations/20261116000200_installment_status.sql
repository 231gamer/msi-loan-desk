-- Installment loans, part 2: where each installment stands, from the ledger only.
--
-- Nothing about "paid" is stored. Installments are covered, oldest first, only by what has been
-- paid toward principal and interest: (scheduled total) - (principal + interest still owed in
-- journal_lines). Penalty payments clear penalties, never installments, so the schedule always
-- agrees with the Outstanding card (Foday, 2026-11-14). Inside the term no penalty exists, so this
-- is simply "everything paid so far".
--
-- Status of an installment on a day:
--   paid      nothing left on it
--   behind    its date has passed and something is left (arrears; no charge inside the term)
--   part_paid partly covered, date not passed
--   due       the next installment to pay (not covered, date not passed)
--   not_due   later installments
-- Inside its term (today <= final due date) an installment loan is listed by its installment due
-- (due list, Due report, dashboard, Today, reminders), or in the new "behind" group when it has
-- arrears. After the final due date it is an ordinary overdue loan: same buckets, same amounts.
-- One-payment loans are listed exactly as before.

-- Coverage of a loan's schedule by an amount paid toward principal and interest (internal).
create or replace function public.installment_coverage(p_loan_id uuid, p_paid_cents bigint, p_today date)
returns table (installment_no int, due_date date, amount_cents bigint, paid_cents bigint, owed_cents bigint, status text)
language sql
stable
security definer
set search_path = public
as $$
  with s as (
    select i.installment_no, i.due_date, i.amount_cents,
           coalesce(sum(i.amount_cents) over (order by i.installment_no
                                              rows between unbounded preceding and 1 preceding), 0)::bigint as before_cents
      from loan_installments i
     where i.loan_id = p_loan_id
  ), c as (
    select s.*, least(s.amount_cents, greatest(0, p_paid_cents - s.before_cents))::bigint as covered
      from s
  ), n as (
    select min(c.installment_no) as next_no from c where c.covered < c.amount_cents and c.due_date >= p_today
  )
  select c.installment_no, c.due_date, c.amount_cents, c.covered, c.amount_cents - c.covered,
         case when c.covered = c.amount_cents then 'paid'
              when c.due_date < p_today then 'behind'
              when c.covered > 0 then 'part_paid'
              when c.installment_no = n.next_no then 'due'
              else 'not_due' end
    from c cross join n
   order by c.installment_no
$$;

-- Paid toward principal and interest, as of a journal chain position (null: everything posted).
create or replace function public.installment_paid_cents(p_loan_id uuid, p_chain_no bigint default null)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select (select coalesce(sum(amount_cents), 0) from loan_installments where loan_id = p_loan_id)
       - coalesce((select sum(l.debit_cents - l.credit_cents)
                     from journal_lines l join journals j on j.id = l.journal_id
                    where l.loan_id = p_loan_id and l.component in ('principal', 'interest')
                      and (p_chain_no is null or j.chain_no <= p_chain_no)), 0)
$$;

revoke execute on function public.installment_coverage(uuid, bigint, date), public.installment_paid_cents(uuid, bigint)
  from public, anon, authenticated, service_role;

-- The schedule of one loan with each installment's status today (loan page, statement, agreement).
create or replace function public.loan_installment_rows(p_loan_id uuid)
returns table (installment_no int, due_date date, amount_cents bigint, paid_cents bigint, owed_cents bigint, status text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  return query
    select * from installment_coverage(p_loan_id, installment_paid_cents(p_loan_id), business_today());
end
$$;

revoke execute on function public.loan_installment_rows(uuid) from public, anon, service_role;
grant execute on function public.loan_installment_rows(uuid) to authenticated;

-- One row per paid-out installment loan: counts, the next installment, arrears and the amount due
-- now. Read through the loan_schedule_status view (all staff, like loan_balances).
create or replace function public.loan_schedule_rows()
returns table (
  loan_id uuid,
  installments int,
  paid_count int,
  part_paid_count int,
  behind_count int,
  not_due_count int,
  next_no int,
  next_due_date date,
  next_owed_cents bigint,
  arrears_cents bigint,
  behind_since date,
  days_behind int,
  due_now_cents bigint,
  in_term boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with p as (select business_today() as today),
  paid as (
    select ln.id as loan_id, ln.due_date, installment_paid_cents(ln.id) as paid_cents
      from loans ln
     where ln.repayment_type = 'installments'
       and exists (select 1 from loan_installments i where i.loan_id = ln.id)
  ),
  rows_ as (
    select paid.loan_id, paid.due_date as final_due, c.*
      from paid cross join p
      cross join lateral installment_coverage(paid.loan_id, paid.paid_cents, p.today) c
  )
  select r.loan_id,
         count(*)::int,
         count(*) filter (where r.status = 'paid')::int,
         count(*) filter (where r.status = 'part_paid')::int,
         count(*) filter (where r.status = 'behind')::int,
         count(*) filter (where r.status in ('due', 'not_due'))::int,
         min(r.installment_no) filter (where r.owed_cents > 0),
         min(r.due_date) filter (where r.owed_cents > 0),
         (array_agg(r.owed_cents order by r.installment_no) filter (where r.owed_cents > 0))[1],
         coalesce(sum(r.owed_cents) filter (where r.status = 'behind'), 0)::bigint,
         min(r.due_date) filter (where r.status = 'behind'),
         coalesce(max(p.today - r.due_date) filter (where r.status = 'behind'), 0)::int,
         coalesce(sum(r.owed_cents) filter (where r.due_date <= p.today), 0)::bigint,
         p.today <= max(r.final_due)
    from rows_ r cross join p
   where is_staff()
   group by r.loan_id, p.today
$$;

revoke execute on function public.loan_schedule_rows() from public, anon, service_role;
grant execute on function public.loan_schedule_rows() to authenticated;

create view public.loan_schedule_status with (security_invoker = true) as
  select * from public.loan_schedule_rows();
revoke all on public.loan_schedule_status from anon, service_role;
grant select on public.loan_schedule_status to authenticated;

-- The next installment after a payment, for its receipt: the oldest installment not covered once
-- this payment is counted (null for a one-payment loan or when nothing is left).
create or replace function public.receipt_next_installment(p_payment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_chain bigint;
  v_next record;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  select * into v_payment from payments where id = p_payment_id;
  if not found then
    raise exception 'INVALID_STATE: the payment does not exist' using errcode = 'P0002';
  end if;
  if (select repayment_type from loans where id = v_payment.loan_id) <> 'installments' then
    return null;
  end if;
  select chain_no into v_chain from journals where id = v_payment.journal_id;
  select c.installment_no, c.due_date, c.owed_cents, c.amount_cents into v_next
    from installment_coverage(v_payment.loan_id, installment_paid_cents(v_payment.loan_id, v_chain),
                              v_payment.received_on) c
   where c.owed_cents > 0
   order by c.installment_no
   limit 1;
  if v_next.installment_no is null then
    return null;
  end if;
  return jsonb_build_object('installment_no', v_next.installment_no, 'due_date', v_next.due_date,
                            'amount_cents', v_next.owed_cents, 'installment_cents', v_next.amount_cents,
                            'installments', (select count(*) from loan_installments where loan_id = v_payment.loan_id));
end
$$;

revoke execute on function public.receipt_next_installment(uuid) from public, anon, service_role;
grant execute on function public.receipt_next_installment(uuid) to authenticated;

-- Due list (due list page, Due report, Today): installment loans inside their term show the
-- installment due, or the "behind" group; everything else exactly as before. New columns are added
-- at the end: repayment_type, amount_due_cents (what to collect now) and installment_no.
drop view public.due_list;
drop function public.due_list_rows();

create function public.due_list_rows()
returns table (
  loan_id uuid,
  bucket text,
  days int,
  due_date date,
  total_out bigint,
  penalty_out bigint,
  next_penalty_on date,
  last_penalty boolean,
  repayment_type text,
  amount_due_cents bigint,
  installment_no int
)
language sql
stable
security definer
set search_path = public
as $$
  with params as (
    select business_today() as today,
           coalesce((select (value #>> '{}')::int from settings where key = 'due.upcoming_days'), 7) as ahead
  ),
  base as (
    select ln.*, b.total_out, b.penalty_out, b.next_penalty_on,
           s.next_no, s.next_due_date, s.next_owed_cents, s.arrears_cents, s.behind_since, s.days_behind,
           s.due_now_cents,
           (ln.repayment_type = 'installments' and s.loan_id is not null and p.today <= ln.due_date) as in_term,
           p.today, p.ahead
      from loans ln
      join loan_balance_rows() b on b.loan_id = ln.id
      left join loan_schedule_rows() s on s.loan_id = ln.id
      cross join params p
     where ln.status in ('active', 'overdue') and ln.due_date is not null and b.total_out > 0
  )
  select x.id,
         case when x.in_term then
                case when x.arrears_cents > 0 then 'behind'
                     when x.next_due_date = x.today then 'due_today'
                     else 'due_7d' end
              when x.due_date = x.today then 'due_today'
              when x.due_date > x.today then 'due_7d'
              when x.today - x.due_date <= 7 then 'overdue_1_7'
              when x.today - x.due_date <= 30 then 'overdue_8_30'
              else 'overdue_30_plus' end,
         case when x.in_term then
                case when x.arrears_cents > 0 then x.days_behind else x.today - x.next_due_date end
              else x.today - x.due_date end,              -- negative: days until due
         case when x.in_term then coalesce(x.behind_since, x.next_due_date) else x.due_date end,
         x.total_out, x.penalty_out, x.next_penalty_on,
         x.next_penalty_on is not null
           and (x.next_penalty_on - x.due_date) / x.penalty_period_days = x.penalty_max_periods,
         x.repayment_type,
         case when x.in_term then
                case when x.arrears_cents > 0 then x.due_now_cents else x.next_owed_cents end
              else x.total_out end,
         case when x.in_term then x.next_no end
    from base x
   where (case when x.in_term then x.arrears_cents > 0 or x.next_due_date <= x.today + x.ahead
               else x.due_date <= x.today + x.ahead end)
     and is_staff()
$$;

revoke execute on function public.due_list_rows() from public, anon, service_role;
grant execute on function public.due_list_rows() to authenticated;

create view public.due_list with (security_invoker = true) as
  select * from public.due_list_rows();
revoke all on public.due_list from anon, service_role;
grant select on public.due_list to authenticated;

-- Dashboard "Due and overdue now": an installment loan inside its term appears when an
-- installment is due today or behind, with that amount; one-payment loans as before.
create or replace function public.dashboard_due_now(p_officer uuid default null, p_limit int default 10)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_data order by days, loan_no), '[]'::jsonb) from (
    select x.days, x.loan_no,
           jsonb_build_object('loan_id', x.id, 'loan_no', x.loan_no, 'borrower', x.borrower, 'branch', x.branch,
                              'due_date', x.shown_due, 'owes_cents', x.owes, 'days', x.days, 'status', x.shown_status,
                              'repayment_type', x.repayment_type, 'installment_no', x.installment_no) as row_data
      from (
        select ln.id, ln.loan_no, ln.repayment_type, customer_display_name(c) as borrower, br.name as branch,
               case when t.in_term then coalesce(s.behind_since, s.next_due_date) else ln.due_date end as shown_due,
               case when t.in_term then s.due_now_cents else b.total_out end as owes,
               case when t.in_term then s.days_behind else b.days_overdue end as days,
               case when t.in_term and s.arrears_cents > 0 then 'behind' else ln.status end as shown_status,
               case when t.in_term then s.next_no end as installment_no,
               t.in_term, s.due_now_cents
          from loan_balance_rows() b join loans ln on ln.id = b.loan_id
          join customers c on c.id = ln.customer_id join branches br on br.id = ln.branch_id
          left join loan_schedule_rows() s on s.loan_id = ln.id
          cross join lateral (select ln.repayment_type = 'installments' and s.loan_id is not null
                                     and business_today() <= ln.due_date as in_term) t
         where ln.status in ('active', 'overdue', 'recovery') and b.total_out > 0
           and (p_officer is null or ln.officer_id = p_officer)
           and (case when t.in_term then s.due_now_cents > 0 else ln.due_date <= business_today() end)
      ) x
     order by x.days, x.loan_no
     limit p_limit
  ) rows_data
$$;
revoke execute on function public.dashboard_due_now(uuid, int) from public, anon, authenticated, service_role;

-- Officer dashboard: "Due today" also counts installments due today (same source as the due list).
create or replace function public.dashboard_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role app_role := require_role('admin', 'ceo', 'manager', 'accountant', 'cashier', 'loan_officer');
  v_me uuid := auth.uid();
  v_branch uuid := auth_branch();
  v_today date := business_today();
  v_result jsonb := jsonb_build_object('role', v_role, 'today', v_today);
  v_collected_on date;
begin
  if v_role = 'loan_officer' then
    return v_result || jsonb_build_object(
      -- One-payment loans due today, and installments due today (what to collect, from due_list_rows).
      'due_today', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(d.amount_due_cents), 0))
                      from due_list_rows() d join loans ln on ln.id = d.loan_id
                     where ln.officer_id = v_me and d.bucket = 'due_today'),
      'overdue', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(b.total_out), 0))
                    from loan_balance_rows() b join loans ln on ln.id = b.loan_id
                   where ln.officer_id = v_me and ln.status in ('overdue', 'recovery') and b.total_out > 0),
      'pending_remittance', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(amount_cents), 0))
                               from payments where received_by = v_me and collected_in_field
                                and remittance_status = 'pending' and status = 'posted'),
      'due_now', dashboard_due_now(v_me, 10));
  end if;

  if v_role = 'cashier' then
    return v_result || jsonb_build_object(
      'collections_today', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(amount_cents), 0))
                              from payments where branch_id = v_branch and received_on = v_today and status = 'posted'),
      'drawer', (select jsonb_build_object('expected_cents', (s ->> 'expected_cents')::bigint, 'close', s -> 'close')
                   from (select day_close_summary(v_branch, v_today) as s) x
                  where v_branch is not null),
      'field_unconfirmed', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(amount_cents), 0))
                              from payments where branch_id = v_branch and collected_in_field
                               and remittance_status = 'pending' and status = 'posted'),
      'yesterday_closed', exists (select 1 from day_closes where branch_id = v_branch and close_date = v_today - 1
                                                          and status in ('submitted', 'approved')));
  end if;

  if v_role in ('manager', 'ceo') then
    select max(received_on) into v_collected_on from payments
     where status = 'posted' and received_on between v_today - 7 and v_today;
    return v_result || jsonb_build_object(
      'portfolio', (select jsonb_build_object('cents', coalesce(sum(b.total_out), 0), 'loans', count(*),
                                              'branches', count(distinct ln.branch_id))
                      from loan_balance_rows() b join loans ln on ln.id = b.loan_id
                     where ln.status in ('active', 'overdue', 'recovery') and b.total_out > 0),
      'overdue', report_overdue(null) - 'rows',
      'collected', case when v_collected_on is null then null else
                     report_collections(v_collected_on, v_collected_on, null) - 'rows'
                     || jsonb_build_object('date', v_collected_on,
                          'count', (select count(*) from payments where status = 'posted' and received_on = v_collected_on)) end,
      'approvals', (select jsonb_build_object('count', count(*), 'oldest', min(requested_at))
                      from approval_requests r
                     where r.status = 'pending' and r.requested_by <> v_me
                       and (r.required_role = 'manager' or v_role = 'ceo')),
      'attention', dashboard_attention(),
      'due_now', dashboard_due_now(null, 10));
  end if;

  if v_role = 'accountant' then
    return v_result || jsonb_build_object(
      'cash', report_cash_position(v_today),
      'income_month', report_profit_loss(date_trunc('month', v_today)::date, v_today, null) - 'income' - 'expenses',
      'expenses_waiting', (select jsonb_build_object('count', count(*), 'cents', coalesce(sum(amount_cents), 0))
                             from expenses where status = 'pending_approval'),
      'owed_to_payees', (select coalesce(sum(owed_cents), 0) from payee_balances),
      'attention', dashboard_attention());
  end if;

  -- admin
  return v_result || jsonb_build_object(
    'go_live', (select value #>> '{}' from settings where key = 'migration.go_live_date'),
    'last_run', (select jsonb_build_object('run_date', run_date, 'finished_at', finished_at, 'source', source)
                   from accrual_runs order by started_at desc limit 1),
    'users', (select count(*) from profiles where active),
    'branches', (select count(*) from branches where active));
end
$$;
revoke execute on function public.dashboard_data() from public, anon, service_role;
grant execute on function public.dashboard_data() to authenticated;

-- WhatsApp: a reminder text for an installment, logged like the others (SPEC 10.3).
create or replace function public.log_reminder_opened(p_loan_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_loan loans;
begin
  if not is_staff() then
    raise exception 'FORBIDDEN: staff only' using errcode = '42501';
  end if;
  if p_kind not in ('reminder', 'reminder_overdue', 'reminder_installment') then
    raise exception 'INVALID_STATE: unknown reminder' using errcode = '22023';
  end if;
  select * into v_loan from loans where id = p_loan_id;
  if not found or v_loan.status not in ('active', 'overdue', 'recovery') then
    raise exception 'INVALID_STATE: reminders are for open loans' using errcode = '22023';
  end if;
  perform write_audit('loan.reminder_opened', 'loan', v_loan.id::text, null,
                      jsonb_build_object('loan_no', v_loan.loan_no, 'template', p_kind, 'channel', 'whatsapp'));
end
$$;

revoke execute on function public.log_reminder_opened(uuid, text) from public, anon, service_role;
grant execute on function public.log_reminder_opened(uuid, text) to authenticated;

-- Added only when missing, so an admin's own texts are never replaced (editable in Settings).
update public.settings
   set value = value || jsonb_build_object('reminder_installment',
     'Dear {name}, installment {installment} of your loan {loan_no} is {amount}, due on {due_date}. '
     || 'Outstanding on the loan: {outstanding}. Please pay at {branch} or call {branch_phone}. Thank you. – {company}')
 where key = 'templates' and not (value ? 'reminder_installment');
