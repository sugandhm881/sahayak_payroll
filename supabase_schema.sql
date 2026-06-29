-- ============================================================
--  Salary Slip Generator — Supabase schema (company-agnostic)
--  Run this in the SQL Editor of the project referenced by .env
--  (SUPABASE_URL = https://nsgvbqbqzvcdrrwvogxx.supabase.co)
--
--  Supabase Dashboard  ->  SQL Editor  ->  New query  ->  paste  ->  Run
--
--  Works for ANY company/organization — the company name, address and logo
--  are stored as editable data, not hard-coded. Creates two tables:
--    1. salary_profile        — company identity, logo, and email/SMTP config
--    2. salary_slip_history    — a record of every slip downloaded or emailed
--
--  RLS is ENABLED with no public policies, so these tables are reachable
--  only with the service_role key (the key in .env, used by server.js).
--  The service_role bypasses RLS; the public anon key cannot touch them.
-- ============================================================

-- ── 1. Profile / configuration (single row, id = 1) ──────────
-- One row holds the active company's identity + email settings. Switch
-- companies by editing this row (or store many and pick one — see note).
create table if not exists public.salary_profile (
  id              integer primary key default 1,
  company_name    text,                                   -- e.g. 'Acme Pvt. Ltd.' (any organization)
  company_address text,                                   -- printed under the company name on each slip
  logo_data_url   text,                                   -- uploaded logo (base64 data URL) or hosted URL
  from_name       text        default 'Accounts Department',
  from_email      text,                                   -- the "From" address slips are sent as
  smtp_host       text        default 'smtp.gmail.com',
  smtp_port       integer     default 587,
  smtp_user       text,                                   -- SMTP login (usually the Gmail address)
  smtp_pass       text,                                   -- Gmail App Password (lets email work when hosted online)
  currency_symbol text        default '₹',                -- shown on amounts / net payable
  updated_at      timestamptz not null default now(),
  constraint salary_profile_singleton check (id = 1)
);

-- For installs created before smtp_user/smtp_pass existed — safe to re-run.
alter table public.salary_profile add column if not exists smtp_user text;
alter table public.salary_profile add column if not exists smtp_pass text;

comment on table public.salary_profile is
  'Salary Slip Generator: active company identity, uploaded logo, and email/SMTP config. Single row (id=1).';

-- Seed the single config row (no-op if it already exists). Values are left
-- blank on purpose so any company can fill them in from the app.
insert into public.salary_profile (id)
values (1)
on conflict (id) do nothing;

-- Keep updated_at fresh on every change.
create or replace function public.salary_profile_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_salary_profile_updated_at on public.salary_profile;
create trigger trg_salary_profile_updated_at
  before update on public.salary_profile
  for each row execute function public.salary_profile_touch_updated_at();


-- ── 2. Slip history (one row per slip downloaded or emailed) ──
-- The common payroll heads have their own columns; any extra company-specific
-- earnings/deductions can be stored in the `details` JSONB so this fits any
-- company's slip layout without a schema change.
create table if not exists public.salary_slip_history (
  id               uuid        primary key default gen_random_uuid(),
  company_name     text,                                  -- company this slip was issued under
  month            text,                                  -- e.g. 'June 2026' as shown on the slip
  employee_name    text        not null,
  designation      text,
  email            text,
  basic            numeric(12,2) default 0,
  da               numeric(12,2) default 0,               -- dearness / generic allowance
  hra              numeric(12,2) default 0,               -- house rent allowance
  tpt              numeric(12,2) default 0,               -- transport allowance
  pf               numeric(12,2) default 0,               -- provident fund
  income_tax       numeric(12,2) default 0,
  advance          numeric(12,2) default 0,
  gross            numeric(12,2) default 0,
  total_deduction  numeric(12,2) default 0,
  net              numeric(12,2) default 0,
  details          jsonb,                                 -- any extra earning/deduction heads, free-form
  action           text        not null,                  -- 'pdf' | 'email'
  status           text,                                  -- 'sent' | 'failed' | null (for downloads)
  error            text,                                  -- error message when status = 'failed'
  created_at       timestamptz not null default now()
);

comment on table public.salary_slip_history is
  'Salary Slip Generator: audit log of every slip downloaded (action=pdf) or emailed (action=email), for any company.';

create index if not exists idx_salary_slip_history_created_at on public.salary_slip_history (created_at desc);
create index if not exists idx_salary_slip_history_company    on public.salary_slip_history (company_name);
create index if not exists idx_salary_slip_history_month      on public.salary_slip_history (month);
create index if not exists idx_salary_slip_history_email      on public.salary_slip_history (email);


-- ── 3. Row Level Security ────────────────────────────────────
-- Enabled with NO policies: only the service_role key (server.js) can
-- read/write. The anon/public key gets nothing. This is intentional —
-- payroll data must not be exposed to the browser's public key.
alter table public.salary_profile      enable row level security;
alter table public.salary_slip_history enable row level security;
