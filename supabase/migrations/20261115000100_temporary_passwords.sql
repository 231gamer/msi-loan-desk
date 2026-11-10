-- Temporary passwords and the forced password change (FR-01, SPEC 4 and 11; DECISIONS D-TP-*).
--
-- Additive and safe on the live database: three new profile columns (no account is flagged here),
-- one private fingerprint table, one setting, the helper functions redefined to refuse flagged
-- accounts, and five RPCs. Passwords are never stored or logged: the fingerprint is a SHA-256 of
-- the bcrypt hash Supabase Auth already keeps, used only to prove that a password really changed.

alter table public.profiles
  add column must_change_password boolean not null default false,
  add column temp_password_expires_at timestamptz,
  add column password_changed_at timestamptz;

comment on column public.profiles.must_change_password is
  'True after the admin creates the account, resets its password or requires a new one: the user can only set a new password until it is cleared.';
comment on column public.profiles.temp_password_expires_at is
  'When the temporary password stops working (auth.temp_password_hours after it was issued). Null once the user has set their own.';
comment on column public.profiles.password_changed_at is
  'When the user last set their own password (never the admin).';

-- Private: nobody reads it except the functions below (RLS on, no policies, no grants).
create table public.password_fingerprints (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now()
);
comment on table public.password_fingerprints is
  'SHA-256 of the Supabase Auth password hash when a temporary password is issued or a password is changed, so complete_password_change can prove the password changed. Never the password.';
alter table public.password_fingerprints enable row level security;
revoke all on public.password_fingerprints from public, anon, authenticated, service_role;

-- Setting: hours a temporary password stays valid (default 72, 1 to 720).
insert into public.settings (key, value) values ('auth.temp_password_hours', '72') on conflict (key) do nothing;

-- SPEC 6.4 helpers: a flagged account has no role, so every RPC and RLS policy refuses it.
create or replace function public.auth_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from profiles where id = auth.uid() and active and not must_change_password;
$$;

create or replace function public.auth_branch()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select branch_id from profiles where id = auth.uid() and active and not must_change_password;
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and active and not must_change_password);
$$;

-- validate_setting: as in 20261111000100_documents.sql, plus auth.temp_password_hours.
CREATE OR REPLACE FUNCTION public.validate_setting(p_key text, p_value jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_field text;
begin
  if p_value is null then
    perform setting_error(p_key, 'needs a value');
  end if;

  case p_key
    when 'currency.base' then
      -- A-01: USD only in the MVP. LRD needs the multi-currency work in phase 2.
      if p_value <> '"USD"'::jsonb then
        perform setting_error(p_key, 'must be "USD" in this release');
      end if;

    when 'accounting.basis' then
      -- A-15: accrual is the only basis the posting recipes implement.
      if p_value <> '"accrual"'::jsonb then
        perform setting_error(p_key, 'must be "accrual" in this release');
      end if;

    when 'payments.allocation_order' then
      -- A-05: any order of the three components, each exactly once.
      if jsonb_typeof(p_value) <> 'array'
         or jsonb_array_length(p_value) <> 3
         or not (p_value @> '["penalty", "interest", "principal"]'::jsonb) then
        perform setting_error(p_key, 'must list penalty, interest and principal once each');
      end if;

    when 'approvals.loan_manager_limit_cents' then
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::bigint <= 0 then
        perform setting_error(p_key, 'must be a positive whole number of cents');
      end if;

    when 'approvals.expense_limit_cents' then
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::bigint < 0 then
        perform setting_error(p_key, 'must be zero or a positive whole number of cents');
      end if;

    when 'loans.collateral_required', 'collateral.multi_loan', 'extension.enabled',
         'field.require_remittance', 'daycloses.enforce', 'disbursement.check_funds' then
      if jsonb_typeof(p_value) <> 'boolean' then
        perform setting_error(p_key, 'must be true or false');
      end if;

    when 'migration.go_live_date' then
      -- A-19: null until MSI sets the go-live date.
      if jsonb_typeof(p_value) = 'null' then
        return;
      end if;
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then
        perform setting_error(p_key, 'must be null or a date YYYY-MM-DD');
      end if;
      begin
        perform (p_value #>> '{}')::date;
      exception when others then
        perform setting_error(p_key, 'is not a real date');
      end;

    when 'company' then
      -- SPEC 11 Branding. Pending fields hold "[pending]" and print blank.
      if jsonb_typeof(p_value) <> 'object' then
        perform setting_error(p_key, 'must be an object');
      end if;
      for v_field in select jsonb_object_keys(p_value) loop
        if v_field not in ('name', 'short_name', 'address', 'phone', 'email', 'logo_path', 'receipt_footer') then
          perform setting_error(p_key, format('has an unknown field "%s"', v_field));
        end if;
      end loop;
      if not jsonb_is_short_text(p_value -> 'name', 120) or length(btrim(p_value ->> 'name')) = 0 then
        perform setting_error(p_key, 'needs a name of 1 to 120 characters');
      end if;
      if not jsonb_is_short_text(p_value -> 'short_name', 20) or length(btrim(p_value ->> 'short_name')) = 0 then
        perform setting_error(p_key, 'needs a short name of 1 to 20 characters');
      end if;
      if not (jsonb_is_short_text(p_value -> 'address', 300)
              and jsonb_is_short_text(p_value -> 'phone', 60)
              and jsonb_is_short_text(p_value -> 'email', 200)
              and jsonb_is_short_text(p_value -> 'receipt_footer', 200)) then
        perform setting_error(p_key, 'address, phone, email and receipt_footer must be text (use "" or "[pending]" when unknown)');
      end if;
      if not (jsonb_typeof(p_value -> 'logo_path') = 'null' or jsonb_is_short_text(p_value -> 'logo_path', 300)) then
        perform setting_error(p_key, 'logo_path must be a storage path or null');
      end if;

    when 'due.upcoming_days' then
      -- B-07: how far ahead the due list's "due soon" tab looks (SPEC 7.7 due_7d).
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::int not between 1 and 60 then
        perform setting_error(p_key, 'must be a whole number of days from 1 to 60');
      end if;

    when 'recovery.notice_days' then
      -- M7: days a demand notice gives the borrower to pay before collateral disposal.
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::int not between 1 and 90 then
        perform setting_error(p_key, 'must be a whole number of days from 1 to 90');
      end if;

    when 'templates' then
      if jsonb_typeof(p_value) <> 'object' then
        perform setting_error(p_key, 'must be an object of named texts');
      end if;
      for v_field in select jsonb_object_keys(p_value) loop
        if v_field !~ '^[a-z_]+$' or not jsonb_is_short_text(p_value -> v_field, 10000) then
          perform setting_error(p_key, format('template "%s" must be text up to 10,000 characters', v_field));
        end if;
      end loop;

    when 'clock.override_at' then
      -- B-01: null (real time) or {"at": timestamptz, "frozen": bool}.
      if jsonb_typeof(p_value) = 'null' then
        return;
      end if;
      if jsonb_typeof(p_value) <> 'object'
         or jsonb_typeof(p_value -> 'at') <> 'string'
         or (p_value ? 'frozen' and jsonb_typeof(p_value -> 'frozen') <> 'boolean')
         or exists (select 1 from jsonb_object_keys(p_value) k where k not in ('at', 'frozen', 'set_at')) then
        perform setting_error(p_key, 'must be null or {"at": "<timestamp>", "frozen": true|false}');
      end if;
      begin
        perform (p_value ->> 'at')::timestamptz;
      exception when others then
        perform setting_error(p_key, '"at" is not a valid timestamp');
      end;

    when 'auth.temp_password_hours' then
      -- Temporary passwords (admin create and reset) expire after this many hours.
      if not jsonb_is_whole_number(p_value) or (p_value #>> '{}')::int not between 1 and 720 then
        perform setting_error(p_key, 'must be a whole number of hours from 1 to 720');
      end if;

    else
      perform setting_error(p_key, 'is not a known setting');
  end case;
end
$function$;


-- Internal: SHA-256 of the user's current Supabase Auth password hash (null without a password).
create or replace function public.password_fingerprint(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select encode(extensions.digest(u.encrypted_password, 'sha256'), 'hex')
    from auth.users u
   where u.id = p_user_id and coalesce(u.encrypted_password, '') <> '';
$$;
revoke execute on function public.password_fingerprint(uuid) from public, anon, authenticated, service_role;

-- Internal: remembers the current fingerprint for the user.
create or replace function public.record_password_fingerprint(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fingerprint text := password_fingerprint(p_user_id);
begin
  if v_fingerprint is null then
    delete from password_fingerprints where user_id = p_user_id;
    return;
  end if;
  insert into password_fingerprints (user_id, fingerprint, recorded_at)
  values (p_user_id, v_fingerprint, now())
  on conflict (user_id) do update set fingerprint = excluded.fingerprint, recorded_at = excluded.recorded_at;
end
$$;
revoke execute on function public.record_password_fingerprint(uuid) from public, anon, authenticated, service_role;

-- Internal: hours from the setting (72 when missing).
create or replace function public.temp_password_hours()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (value #>> '{}')::int from settings where key = 'auth.temp_password_hours'), 72);
$$;
revoke execute on function public.temp_password_hours() from public, anon, authenticated, service_role;

-- Internal: a reason of 3 to 300 characters.
create or replace function public.require_reason(p_reason text)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'INVALID_STATE: give a reason (at least 3 characters)' using errcode = '22023';
  end if;
  if length(btrim(p_reason)) > 300 then
    raise exception 'INVALID_STATE: the reason is too long (300 characters at most)' using errcode = '22023';
  end if;
  return btrim(p_reason);
end
$$;
revoke execute on function public.require_reason(text) from public, anon, authenticated, service_role;

-- The signed-in user's own account, readable while flagged (the profile table is not).
-- temp_password_expired is decided by the database clock (real time, not the demo clock).
create or replace function public.my_account()
returns table (
  id uuid,
  full_name text,
  email text,
  role public.app_role,
  active boolean,
  branch_id uuid,
  branch_code text,
  branch_name text,
  must_change_password boolean,
  temp_password_expires_at timestamptz,
  temp_password_expired boolean,
  password_changed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, u.email::text, p.role, p.active, b.id, b.code, b.name,
         p.must_change_password, p.temp_password_expires_at,
         p.must_change_password and p.temp_password_expires_at is not null and p.temp_password_expires_at <= now(),
         p.password_changed_at
    from profiles p
    join auth.users u on u.id = p.id
    left join branches b on b.id = p.branch_id
   where p.id = auth.uid();
$$;
revoke execute on function public.my_account() from public, anon, service_role;
grant execute on function public.my_account() to authenticated;

-- Admin: the user must set a new password at next sign-in (also called after create and reset).
-- Returns when the temporary password expires.
create or replace function public.admin_require_password_change(p_user_id uuid, p_reason text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_before profiles;
  v_expires timestamptz;
begin
  perform require_role('admin');
  v_reason := require_reason(p_reason);
  select * into v_before from profiles where id = p_user_id for update;
  if not found then
    raise exception 'INVALID_STATE: no staff profile exists for user %', p_user_id using errcode = 'P0002';
  end if;
  v_expires := now() + make_interval(hours => temp_password_hours());
  -- Audit first: when the admin flags their own account, the row still records the admin role.
  perform write_audit('auth.password_change_required', 'profile', p_user_id::text,
    jsonb_build_object('must_change_password', v_before.must_change_password,
                       'temp_password_expires_at', v_before.temp_password_expires_at),
    jsonb_build_object('must_change_password', true, 'temp_password_expires_at', v_expires, 'reason', v_reason));
  update profiles
     set must_change_password = true, temp_password_expires_at = v_expires,
         updated_at = app_now(), updated_by = auth.uid()
   where id = p_user_id;
  perform record_password_fingerprint(p_user_id);
  return v_expires;
end
$$;
revoke execute on function public.admin_require_password_change(uuid, text) from public, anon, service_role;
grant execute on function public.admin_require_password_change(uuid, text) to authenticated;

-- Admin, at go-live: every active account (the admin's own included) must set a new password.
-- One audit row per account plus one summary row. Returns how many accounts were flagged.
create or replace function public.admin_require_password_change_all(p_reason text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_expires timestamptz;
  v_profile profiles;
  v_count int := 0;
begin
  perform require_role('admin');
  v_reason := require_reason(p_reason);
  v_expires := now() + make_interval(hours => temp_password_hours());
  -- Audit rows are written before each update so the admin's own row keeps the admin role.
  select count(*) into v_count from profiles where active;
  perform write_audit('auth.password_change_required_all', 'profile', null, null,
    jsonb_build_object('count', v_count, 'temp_password_expires_at', v_expires, 'reason', v_reason));
  for v_profile in select * from profiles where active order by (id = auth.uid()), id for update loop
    perform write_audit('auth.password_change_required', 'profile', v_profile.id::text,
      jsonb_build_object('must_change_password', v_profile.must_change_password,
                         'temp_password_expires_at', v_profile.temp_password_expires_at),
      jsonb_build_object('must_change_password', true, 'temp_password_expires_at', v_expires,
                         'reason', v_reason, 'bulk', true));
    update profiles
       set must_change_password = true, temp_password_expires_at = v_expires,
           updated_at = app_now(), updated_by = auth.uid()
     where id = v_profile.id;
    perform record_password_fingerprint(v_profile.id);
  end loop;
  return v_count;
end
$$;
revoke execute on function public.admin_require_password_change_all(text) from public, anon, service_role;
grant execute on function public.admin_require_password_change_all(text) to authenticated;

-- The signed-in user has just set a new password in Supabase Auth: clear the flag for auth.uid()
-- only. Refused when the password did not actually change, or when the temporary one expired.
create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_profile profiles;
  v_current text;
  v_previous text;
begin
  if v_user is null then
    raise exception 'FORBIDDEN: sign in first' using errcode = '42501';
  end if;
  select * into v_profile from profiles where id = v_user for update;
  if not found or not v_profile.active then
    raise exception 'FORBIDDEN: this account is not active' using errcode = '42501';
  end if;
  if v_profile.must_change_password and v_profile.temp_password_expires_at is not null
     and v_profile.temp_password_expires_at <= now() then
    raise exception 'TEMP_PASSWORD_EXPIRED: the temporary password has expired' using errcode = '42501';
  end if;
  v_current := password_fingerprint(v_user);
  select fingerprint into v_previous from password_fingerprints where user_id = v_user;
  if v_current is null or v_current is not distinct from v_previous then
    raise exception 'INVALID_STATE: the password has not been changed' using errcode = '22023';
  end if;

  update profiles
     set must_change_password = false, temp_password_expires_at = null, password_changed_at = now(),
         updated_at = app_now(), updated_by = v_user
   where id = v_user;
  perform record_password_fingerprint(v_user);
  -- After the update, so the row records the user's role. Never the password.
  perform write_audit('auth.password_changed', 'profile', v_user::text, null,
    jsonb_build_object('forced', v_profile.must_change_password));
end
$$;
revoke execute on function public.complete_password_change() from public, anon, service_role;
grant execute on function public.complete_password_change() to authenticated;
