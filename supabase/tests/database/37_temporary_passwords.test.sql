-- Temporary passwords and the forced password change (FR-01, SPEC 4 and 11).
begin;
\ir _helpers.psql
select plan(33);

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated;
insert into ids values
  ('admin', tests.create_staff('Pw Admin', 'admin')),
  ('manager', tests.create_staff('Pw Manager', 'manager')),
  ('cashier', tests.create_staff('Pw Cashier', 'cashier', 'BR2')),
  ('officer', tests.create_staff('Pw Officer', 'loan_officer', 'BR2'));
-- Supabase Auth keeps a bcrypt hash; any text stands in for it here.
update auth.users set encrypted_password = 'hash-temp-' || id::text where id in (select id from ids);

-- Columns, setting and its validation.
select is((select must_change_password from public.profiles where id = (select id from ids where name = 'cashier')),
  false, 'existing accounts are not flagged');
select is((select value from public.settings where key = 'auth.temp_password_hours'), '72'::jsonb,
  'temporary passwords last 72 hours by default');
select matches(tests.try_as('authenticated', (select id from ids where name = 'admin'),
  $$select public.update_setting('auth.temp_password_hours', '0')$$), '^INVALID_SETTING', 'zero hours is refused');
select matches(tests.try_as('authenticated', (select id from ids where name = 'admin'),
  $$select public.update_setting('auth.temp_password_hours', '721')$$), '^INVALID_SETTING', 'more than 720 hours is refused');
select is(tests.try_as('authenticated', (select id from ids where name = 'admin'),
  $$select public.update_setting('auth.temp_password_hours', '720')$$), null, '720 hours is accepted');
update public.settings set value = '72' where key = 'auth.temp_password_hours';

-- Only the admin flags accounts, with a reason.
select matches(tests.try_as('authenticated', (select id from ids where name = 'manager'),
  format($$select public.admin_require_password_change(%L, 'go-live')$$, (select id from ids where name = 'cashier'))),
  '^FORBIDDEN', 'a manager cannot require a new password');
select matches(tests.try_as('authenticated', (select id from ids where name = 'manager'),
  $$select public.admin_require_password_change_all('go-live')$$), '^FORBIDDEN', 'a manager cannot flag everyone');
select matches(tests.try_as('authenticated', (select id from ids where name = 'admin'),
  format($$select public.admin_require_password_change(%L, ' ')$$, (select id from ids where name = 'cashier'))),
  '^INVALID_STATE', 'a reason is required');

select is(tests.try_as('authenticated', (select id from ids where name = 'admin'),
  format($$select public.admin_require_password_change(%L, 'Password reset')$$, (select id from ids where name = 'cashier'))),
  null, 'the admin requires a new password for the cashier');
select ok((select must_change_password and temp_password_expires_at between now() + interval '71 hours 59 minutes'
                                                                    and now() + interval '72 hours 1 minute'
             from public.profiles where id = (select id from ids where name = 'cashier')),
  'the cashier is flagged and the temporary password expires in 72 hours');
select results_eq($$select actor_role::text, after ->> 'reason', after ? 'password' from public.audit_log
                     where action = 'auth.password_change_required' and entity_id = (select id::text from ids where name = 'cashier')$$,
  $$values ('admin'::text, 'Password reset'::text, false)$$, 'the flag is audited with the reason and no password');

update public.settings set value = '5' where key = 'auth.temp_password_hours';
select is(tests.try_as('authenticated', (select id from ids where name = 'admin'),
  format($$select public.admin_require_password_change(%L, 'Account created')$$, (select id from ids where name = 'officer'))),
  null, 'the admin flags the loan officer');
select ok((select temp_password_expires_at between now() + interval '4 hours 59 minutes' and now() + interval '5 hours 1 minute'
             from public.profiles where id = (select id from ids where name = 'officer')),
  'the expiry follows the setting (5 hours)');
update public.settings set value = '72' where key = 'auth.temp_password_hours';

-- A flagged account is refused by the helpers, tables and business RPCs.
select is(tests.value_as('authenticated', (select id from ids where name = 'cashier'), 'select public.auth_role()::text'),
  null, 'a flagged account has no role');
select is(tests.value_as('authenticated', (select id from ids where name = 'cashier'), 'select public.is_staff()::text'),
  'false', 'and is not staff');
select is(tests.value_as('authenticated', (select id from ids where name = 'cashier'), 'select count(*)::text from public.profiles'),
  '0', 'it cannot read profiles');
select is(tests.value_as('authenticated', (select id from ids where name = 'cashier'), 'select count(*)::text from public.branches'),
  '0', 'or branches');
select is(tests.value_as('authenticated', (select id from ids where name = 'cashier'), 'select count(*)::text from public.settings'),
  '0', 'or settings');
select matches(tests.try_as('authenticated', (select id from ids where name = 'cashier'),
  $$select public.dashboard_data()$$), '^FORBIDDEN', 'the dashboard RPC refuses it');
select matches(tests.try_as('authenticated', (select id from ids where name = 'officer'),
  $$select public.create_customer('{"type": "individual", "first_name": "A", "last_name": "B", "phone": "0770000001"}'::jsonb)$$),
  '^FORBIDDEN', 'business RPCs refuse it');
select is(tests.value_as('authenticated', (select id from ids where name = 'cashier'),
  $$select must_change_password::text || ' ' || temp_password_expired::text || ' ' || role::text from public.my_account()$$),
  'true false cashier', 'it can still read its own status');
select is(tests.value_as('authenticated', (select id from ids where name = 'manager'), 'select count(*)::text from public.my_account()'),
  '1', 'my_account returns only the caller');

-- complete_password_change: only after a real change, only for the caller.
select matches(tests.try_as('authenticated', (select id from ids where name = 'cashier'),
  $$select public.complete_password_change()$$), '^INVALID_STATE', 'refused while the password is still the temporary one');
update auth.users set encrypted_password = 'hash-own-cashier' where id = (select id from ids where name = 'cashier');
select is(tests.try_as('authenticated', (select id from ids where name = 'cashier'),
  $$select public.complete_password_change()$$), null, 'accepted after the cashier set a new password');
select results_eq($$select must_change_password, temp_password_expires_at is null, password_changed_at is not null
                     from public.profiles where id = (select id from ids where name = 'cashier')$$,
  $$values (false, true, true)$$, 'the flag is cleared and the change time recorded');
select is((select must_change_password from public.profiles where id = (select id from ids where name = 'officer')),
  true, 'the loan officer is still flagged');
select results_eq($$select actor_id, actor_role::text, after from public.audit_log
                     where action = 'auth.password_changed' and entity_id = (select id::text from ids where name = 'cashier')$$,
  $$values ((select id from ids where name = 'cashier'), 'cashier'::text, '{"forced": true}'::jsonb)$$,
  'the change is audited as the cashier, without the password');
select is(tests.value_as('authenticated', (select id from ids where name = 'cashier'), 'select public.auth_role()::text'),
  'cashier', 'the cashier has its role back');
select matches(tests.try_as('authenticated', (select id from ids where name = 'cashier'),
  $$select public.complete_password_change()$$), '^INVALID_STATE', 'a second call without a new change is refused');

-- An expired temporary password cannot be completed.
update public.profiles set temp_password_expires_at = now() - interval '1 minute' where id = (select id from ids where name = 'officer');
update auth.users set encrypted_password = 'hash-own-officer' where id = (select id from ids where name = 'officer');
select matches(tests.try_as('authenticated', (select id from ids where name = 'officer'),
  $$select public.complete_password_change()$$), '^TEMP_PASSWORD_EXPIRED', 'an expired temporary password is refused');

-- Go-live: everyone at once, audited.
select is(tests.value_as('authenticated', (select id from ids where name = 'admin'),
  $$select public.admin_require_password_change_all('Go-live')::text$$),
  (select count(*)::text from public.profiles where active), 'every active account is flagged');
select results_eq($$select actor_role::text, (after ->> 'count')::int, after ->> 'reason' from public.audit_log
                     where action = 'auth.password_change_required_all'$$,
  $$values ('admin'::text, (select count(*)::int from public.profiles where active), 'Go-live'::text)$$,
  'the bulk flag has a summary audit row');

-- The nightly job runs without a user and is not affected.
update public.settings set value = '{"at": "2026-02-12T01:00:00Z", "frozen": true}' where key = 'clock.override_at';
select is((public.scheduled_daily_accruals()) ->> 'run_date', '2026-02-12', 'the nightly job still runs');

select * from finish();
rollback;
