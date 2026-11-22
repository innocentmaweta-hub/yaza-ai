-- Yaza AI: run this entire script in Supabase SQL Editor.
create table if not exists public.conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'New chat',
  is_archived boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table if not exists public.messages (
  id uuid primary key,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  provider text,
  model text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists conversations_user_updated_idx on public.conversations(user_id, updated_at desc);
create index if not exists conversations_user_archived_updated_idx on public.conversations(user_id, is_archived, updated_at desc);
alter table public.conversations add column if not exists is_archived boolean not null default false;
alter table public.conversations add column if not exists mode text not null default 'general';
alter table public.conversations drop constraint if exists conversations_mode_check;
alter table public.conversations add constraint conversations_mode_check check (mode in ('general','school','innovator','entrepreneur','joking','developer'));
create index if not exists messages_conversation_created_idx on public.messages(conversation_id, created_at);
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
drop policy if exists "Users manage their own conversations" on public.conversations;
create policy "Users manage their own conversations" on public.conversations
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage messages in their conversations" on public.messages;
create policy "Users manage messages in their conversations" on public.messages
  for all to authenticated using (
    exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid())
  );
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, update, delete on public.messages to authenticated;

-- Revocable, unguessable public links for read-only conversation sharing.
create table if not exists public.conversation_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists conversation_shares_owner_conversation_idx
  on public.conversation_shares(user_id, conversation_id);
create index if not exists conversation_shares_conversation_id_idx
  on public.conversation_shares(conversation_id);
alter table public.conversation_shares enable row level security;
-- Share records and snapshots are accessed only by the authenticated server API
-- after it verifies the owner. Do not expose the table directly through the Data API.
drop policy if exists "Users manage their own conversation shares" on public.conversation_shares;
revoke all privileges on public.conversation_shares from public, anon, authenticated;
grant select, insert, update, delete on public.conversation_shares to service_role;

alter table public.messages add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Private permanent storage for each signed-in user's chat attachments.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-attachments', 'chat-attachments', false, 10485760,
  array['image/png','image/jpeg','image/webp','image/gif','application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain','text/markdown','text/csv','application/json','application/xml',
    'text/html','text/css','text/javascript','application/javascript','text/jsx','text/typescript',
    'application/typescript','text/x-c','text/x-c++','application/sql','text/x-python','text/x-java-source','text/x-sql']
)
on conflict (id) do update set public=false, file_size_limit=10485760, allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Yaza users upload own chat attachments" on storage.objects;
create policy "Yaza users upload own chat attachments" on storage.objects
for insert to authenticated with check (
  bucket_id='chat-attachments' and (storage.foldername(name))[1]=(select auth.uid()::text)
);
drop policy if exists "Yaza users read own chat attachments" on storage.objects;
create policy "Yaza users read own chat attachments" on storage.objects
for select to authenticated using (
  bucket_id='chat-attachments' and (storage.foldername(name))[1]=(select auth.uid()::text)
);
drop policy if exists "Yaza users delete own chat attachments" on storage.objects;
create policy "Yaza users delete own chat attachments" on storage.objects
for delete to authenticated using (
  bucket_id='chat-attachments' and (storage.foldername(name))[1]=(select auth.uid()::text)
);


-- User-controlled long-term memory for Yaza AI.
create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_memories_user_content_unique unique (user_id, content)
);
create index if not exists user_memories_user_updated_idx
  on public.user_memories (user_id, updated_at desc);
alter table public.user_memories enable row level security;
drop policy if exists "Users manage their own memories" on public.user_memories;
create policy "Users manage their own memories" on public.user_memories
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.user_memories to authenticated;


-- Per-account preferences for provider/model, theme, and voice controls.
create table if not exists public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
drop policy if exists "Users manage their own preferences" on public.user_preferences;
create policy "Users manage their own preferences" on public.user_preferences
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.user_preferences to authenticated;


-- Revocable, unguessable public links for read-only conversation sharing.
create table if not exists public.conversation_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  token_hash text not null unique,
  title text not null default 'Shared conversation',
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists conversation_shares_owner_conversation_idx
  on public.conversation_shares(user_id, conversation_id);
alter table public.conversation_shares enable row level security;
drop policy if exists "Users manage their own conversation shares" on public.conversation_shares;
create policy "Users manage their own conversation shares" on public.conversation_shares
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.conversation_shares to authenticated, service_role;


-- Private server-side request quotas and usage metering.
create table if not exists public.usage_counters (
  subject_key text not null check (char_length(subject_key) = 64),
  period_type text not null check (period_type in ('day','month')),
  period_start date not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (subject_key, period_type, period_start)
);
alter table public.usage_counters enable row level security;
revoke all on public.usage_counters from anon, authenticated;
grant select, insert, update, delete on public.usage_counters to service_role;

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  subject_key text not null check (char_length(subject_key) = 64),
  provider text not null,
  model text not null,
  status text not null check (status in ('completed','failed')),
  input_characters integer not null default 0,
  output_characters integer not null default 0,
  input_tokens_estimate integer not null default 0,
  output_tokens_estimate integer not null default 0,
  prompt_tokens integer,
  completion_tokens integer,
  reported_cost_usd numeric(14,8),
  created_at timestamptz not null default now()
);
create index if not exists usage_events_created_idx on public.usage_events(created_at desc);
create index if not exists usage_events_provider_model_created_idx on public.usage_events(provider, model, created_at desc);
create index if not exists usage_events_user_created_idx on public.usage_events(user_id, created_at desc);
alter table public.usage_events enable row level security;
revoke all on public.usage_events from anon, authenticated;
grant select, insert, update, delete on public.usage_events to service_role;

create or replace function public.consume_yaza_quota(
  p_subject_key text,
  p_daily_limit integer,
  p_monthly_limit integer
)
returns table(allowed boolean, daily_used integer, monthly_used integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_daily integer;
  v_monthly integer;
begin
  if p_subject_key is null or char_length(p_subject_key) <> 64
     or p_daily_limit < 1 or p_monthly_limit < 1 then
    raise exception 'Invalid quota arguments';
  end if;
  insert into public.usage_counters(subject_key, period_type, period_start)
  values (p_subject_key, 'day', v_today), (p_subject_key, 'month', v_month)
  on conflict do nothing;
  select request_count into v_daily from public.usage_counters
  where subject_key = p_subject_key and period_type = 'day' and period_start = v_today for update;
  select request_count into v_monthly from public.usage_counters
  where subject_key = p_subject_key and period_type = 'month' and period_start = v_month for update;
  if v_daily >= p_daily_limit or v_monthly >= p_monthly_limit then
    return query select false, v_daily, v_monthly;
    return;
  end if;
  update public.usage_counters set request_count = request_count + 1, updated_at = now()
  where subject_key = p_subject_key and period_type = 'day' and period_start = v_today;
  update public.usage_counters set request_count = request_count + 1, updated_at = now()
  where subject_key = p_subject_key and period_type = 'month' and period_start = v_month;
  return query select true, v_daily + 1, v_monthly + 1;
end;
$$;
revoke all on function public.consume_yaza_quota(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_yaza_quota(text, integer, integer) to service_role;


-- Private platform configuration. Only server-side service-role code may read or change it.
create table if not exists public.platform_settings (
  setting_key text primary key,
  setting_value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public, anon, authenticated;
grant select, insert, update, delete on public.platform_settings to service_role;
insert into public.platform_settings (setting_key, setting_value)
values ('wachabe_model', '{"provider":"openrouter","model":"openrouter/free"}'::jsonb)
on conflict (setting_key) do nothing;


-- Prepaid MWK wallet, PayChangu top-ups, and server-controlled per-model prices.
create table if not exists public.wallet_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'MWK' check (currency = 'MWK'),
  balance_minor bigint not null default 0 check (balance_minor >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('topup','usage_reserve','usage_refund','usage_charge','adjustment')),
  amount_minor bigint not null,
  currency text not null default 'MWK' check (currency = 'MWK'),
  reference text not null,
  description text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, reference, kind)
);
create index if not exists wallet_transactions_user_created_idx on public.wallet_transactions(user_id, created_at desc);
create table if not exists public.usage_reservations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  model_key text not null,
  provider text not null,
  model text not null,
  pricing_mode text not null check (pricing_mode in ('tokens','message')),
  reserved_minor bigint not null check (reserved_minor >= 0),
  input_tokens integer not null default 0,
  output_token_reserve integer not null default 0,
  input_rate_per_1k_mwk numeric(14,6) not null default 0,
  output_rate_per_1k_mwk numeric(14,6) not null default 0,
  message_rate_mwk numeric(14,6) not null default 0,
  status text not null default 'reserved' check (status in ('reserved','settled','released')),
  actual_minor bigint,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists usage_reservations_user_created_idx on public.usage_reservations(user_id, created_at desc);
create table if not exists public.payment_topups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tx_ref text not null unique,
  amount_mwk integer not null check (amount_mwk > 0),
  currency text not null default 'MWK' check (currency = 'MWK'),
  status text not null default 'pending' check (status in ('pending','success','failed')),
  checkout_url text,
  provider_reference text,
  verification_data jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz
);
create index if not exists payment_topups_user_created_idx on public.payment_topups(user_id, created_at desc);
create table if not exists public.model_pricing (
  model_key text primary key,
  enabled boolean not null default false,
  pricing_mode text not null default 'tokens' check (pricing_mode in ('tokens','message')),
  input_rate_per_1k_mwk numeric(14,6) not null default 0 check (input_rate_per_1k_mwk >= 0),
  output_rate_per_1k_mwk numeric(14,6) not null default 0 check (output_rate_per_1k_mwk >= 0),
  message_rate_mwk numeric(14,6) not null default 0 check (message_rate_mwk >= 0),
  updated_at timestamptz not null default now()
);
alter table public.wallet_accounts enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.usage_reservations enable row level security;
alter table public.payment_topups enable row level security;
alter table public.model_pricing enable row level security;
revoke all on public.wallet_accounts, public.wallet_transactions, public.usage_reservations, public.payment_topups, public.model_pricing from public, anon, authenticated;
grant select, insert, update, delete on public.wallet_accounts, public.wallet_transactions, public.usage_reservations, public.payment_topups, public.model_pricing to service_role;

insert into public.model_pricing(model_key,enabled,pricing_mode) values
 ('openai/gpt-4.1-mini',false,'tokens'),('openai/gpt-4.1',false,'tokens'),('openai/o4-mini',false,'tokens'),
 ('gemini/gemini-2.5-flash',false,'tokens'),('gemini/gemini-2.5-pro',false,'tokens'),('gemini/gemini-2.0-flash',false,'tokens'),
 ('openrouter/openrouter/free',false,'tokens'),('openrouter/~google/gemini-flash-latest',false,'tokens'),
 ('openrouter/google/gemini-3.7-flash',false,'tokens'),('openrouter/openai/gpt-4.1',false,'tokens'),
 ('openrouter/deepseek/deepseek-r1',false,'tokens'),('openrouter/anthropic/claude-sonnet-4',false,'tokens'),
 ('kimi/moonshot-v1-8k',false,'tokens'),('kimi/moonshot-v1-32k',false,'tokens'),('kimi/moonshot-v1-128k',false,'tokens'),
 ('claude/claude-sonnet-5-5',false,'tokens'),('claude/claude-opus-5-5',false,'tokens'),('claude/claude-haiku-5-5',false,'tokens'),
 ('deepseek/deepseek-flash',false,'tokens'),('deepseek/deepseek-v4-pro',false,'tokens')
on conflict(model_key) do nothing;

alter table public.usage_events add column if not exists public_model_key text;
alter table public.usage_events add column if not exists billed_amount_minor bigint;
alter table public.usage_events add column if not exists billing_status text;

create or replace function public.reserve_yaza_usage(
  p_usage_id uuid, p_user_id uuid, p_model_key text, p_provider text, p_model text,
  p_pricing_mode text, p_reserved_minor bigint, p_input_tokens integer,
  p_output_token_reserve integer, p_input_rate numeric, p_output_rate numeric, p_message_rate numeric
) returns table(allowed boolean, balance_minor bigint, reserved_minor bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_balance bigint; v_existing public.usage_reservations%rowtype;
begin
  if p_usage_id is null or p_user_id is null or p_reserved_minor < 0 or p_pricing_mode not in ('tokens','message') then raise exception 'Invalid reservation'; end if;
  select * into v_existing from public.usage_reservations where id=p_usage_id;
  if found then
    if v_existing.user_id <> p_user_id then raise exception 'Reservation ownership mismatch'; end if;
    select balance_minor into v_balance from public.wallet_accounts where user_id=p_user_id;
    return query select (v_existing.status='reserved' or v_existing.status='settled'), coalesce(v_balance,0), v_existing.reserved_minor; return;
  end if;
  insert into public.wallet_accounts(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select balance_minor into v_balance from public.wallet_accounts where user_id=p_user_id for update;
  if v_balance < p_reserved_minor then return query select false,v_balance,p_reserved_minor; return; end if;
  update public.wallet_accounts set balance_minor=balance_minor-p_reserved_minor,updated_at=now() where user_id=p_user_id;
  insert into public.usage_reservations(id,user_id,model_key,provider,model,pricing_mode,reserved_minor,input_tokens,output_token_reserve,input_rate_per_1k_mwk,output_rate_per_1k_mwk,message_rate_mwk)
  values(p_usage_id,p_user_id,p_model_key,p_provider,p_model,p_pricing_mode,p_reserved_minor,greatest(p_input_tokens,0),greatest(p_output_token_reserve,0),greatest(p_input_rate,0),greatest(p_output_rate,0),greatest(p_message_rate,0));
  return query select true,v_balance-p_reserved_minor,p_reserved_minor;
end; $$;

create or replace function public.settle_yaza_usage(p_usage_id uuid,p_actual_minor bigint)
returns table(success boolean,balance_minor bigint,charged_minor bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res public.usage_reservations%rowtype; v_balance bigint; v_refund bigint;
begin
  select * into v_res from public.usage_reservations where id=p_usage_id for update;
  if not found then raise exception 'Usage reservation not found'; end if;
  if v_res.status='settled' then select balance_minor into v_balance from public.wallet_accounts where user_id=v_res.user_id; return query select true,v_balance,coalesce(v_res.actual_minor,0); return; end if;
  if v_res.status <> 'reserved' or p_actual_minor < 0 or p_actual_minor > v_res.reserved_minor then raise exception 'Invalid usage settlement'; end if;
  v_refund:=v_res.reserved_minor-p_actual_minor;
  update public.wallet_accounts set balance_minor=balance_minor+v_refund,updated_at=now() where user_id=v_res.user_id returning balance_minor into v_balance;
  insert into public.wallet_transactions(user_id,kind,amount_minor,reference,description,metadata)
  values(v_res.user_id,'usage_charge',-p_actual_minor,p_usage_id::text,'AI response usage charge',jsonb_build_object('model_key',v_res.model_key,'provider',v_res.provider,'model',v_res.model));
  update public.usage_reservations set status='settled',actual_minor=p_actual_minor,settled_at=now() where id=p_usage_id;
  return query select true,v_balance,p_actual_minor;
end; $$;

create or replace function public.release_yaza_usage(p_usage_id uuid,p_reason text default 'AI request failed')
returns table(success boolean,balance_minor bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res public.usage_reservations%rowtype; v_balance bigint;
begin
  select * into v_res from public.usage_reservations where id=p_usage_id for update;
  if not found then return query select false,0::bigint; return; end if;
  if v_res.status in ('released','settled') then select balance_minor into v_balance from public.wallet_accounts where user_id=v_res.user_id; return query select true,v_balance; return; end if;
  update public.wallet_accounts set balance_minor=balance_minor+v_res.reserved_minor,updated_at=now() where user_id=v_res.user_id returning balance_minor into v_balance;
  update public.usage_reservations set status='released',settled_at=now() where id=p_usage_id;
  return query select true,v_balance;
end; $$;

create or replace function public.credit_yaza_topup(p_user_id uuid,p_tx_ref text,p_amount_mwk integer,p_metadata jsonb default '{}'::jsonb)
returns table(credited boolean,balance_minor bigint)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_balance bigint; v_amount bigint;
begin
  if p_user_id is null or p_tx_ref is null or length(p_tx_ref)>160 or p_amount_mwk<1 then raise exception 'Invalid top-up'; end if;
  insert into public.wallet_accounts(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select balance_minor into v_balance from public.wallet_accounts where user_id=p_user_id for update;
  if exists(select 1 from public.wallet_transactions where user_id=p_user_id and kind='topup' and reference=p_tx_ref) then return query select false,v_balance; return; end if;
  v_amount:=p_amount_mwk::bigint*100;
  update public.wallet_accounts set balance_minor=balance_minor+v_amount,updated_at=now() where user_id=p_user_id returning balance_minor into v_balance;
  insert into public.wallet_transactions(user_id,kind,amount_minor,reference,description,metadata)
  values(p_user_id,'topup',v_amount,p_tx_ref,'PayChangu wallet top-up',coalesce(p_metadata,'{}'::jsonb));
  return query select true,v_balance;
end; $$;

revoke all on function public.reserve_yaza_usage(uuid,uuid,text,text,text,text,bigint,integer,integer,numeric,numeric,numeric) from public,anon,authenticated;
revoke all on function public.settle_yaza_usage(uuid,bigint) from public,anon,authenticated;
revoke all on function public.release_yaza_usage(uuid,text) from public,anon,authenticated;
revoke all on function public.credit_yaza_topup(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_yaza_usage(uuid,uuid,text,text,text,text,bigint,integer,integer,numeric,numeric,numeric) to service_role;
grant execute on function public.settle_yaza_usage(uuid,bigint) to service_role;
grant execute on function public.release_yaza_usage(uuid,text) to service_role;
grant execute on function public.credit_yaza_topup(uuid,text,integer,jsonb) to service_role;


-- Authenticated, per-account web-search quotas. Search counters are server-only.
create table if not exists public.search_usage_counters (
  subject_key text not null check (subject_key ~ '^[a-f0-9]{64}$'),
  period_type text not null check (period_type in ('day','month')),
  period_start date not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (subject_key, period_type, period_start)
);
alter table public.search_usage_counters enable row level security;
revoke all on public.search_usage_counters from public, anon, authenticated;
grant select, insert, update, delete on public.search_usage_counters to service_role;

create or replace function public.consume_yaza_search_quota(
  p_subject_key text,
  p_daily_limit integer default 20,
  p_monthly_limit integer default 300
)
returns table(allowed boolean, daily_used integer, monthly_used integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_month date := date_trunc('month', now() at time zone 'UTC')::date;
  v_daily integer;
  v_monthly integer;
begin
  if p_subject_key !~ '^[a-f0-9]{64}$'
     or p_daily_limit < 1 or p_daily_limit > 1000000
     or p_monthly_limit < 1 or p_monthly_limit > 1000000 then
    raise exception 'Invalid search quota parameters';
  end if;

  insert into public.search_usage_counters(subject_key, period_type, period_start)
  values (p_subject_key, 'day', v_day), (p_subject_key, 'month', v_month)
  on conflict (subject_key, period_type, period_start) do nothing;

  select request_count into v_daily
  from public.search_usage_counters
  where subject_key = p_subject_key and period_type = 'day' and period_start = v_day
  for update;

  select request_count into v_monthly
  from public.search_usage_counters
  where subject_key = p_subject_key and period_type = 'month' and period_start = v_month
  for update;

  if v_daily >= p_daily_limit or v_monthly >= p_monthly_limit then
    return query select false, v_daily, v_monthly;
    return;
  end if;

  update public.search_usage_counters
  set request_count = request_count + 1, updated_at = now()
  where subject_key = p_subject_key and period_type = 'day' and period_start = v_day
  returning request_count into v_daily;

  update public.search_usage_counters
  set request_count = request_count + 1, updated_at = now()
  where subject_key = p_subject_key and period_type = 'month' and period_start = v_month
  returning request_count into v_monthly;

  return query select true, v_daily, v_monthly;
end;
$$;
revoke all on function public.consume_yaza_search_quota(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_yaza_search_quota(text, integer, integer) to service_role;
