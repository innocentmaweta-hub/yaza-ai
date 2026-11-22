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
alter table public.conversation_shares enable row level security;
drop policy if exists "Users manage their own conversation shares" on public.conversation_shares;
create policy "Users manage their own conversation shares" on public.conversation_shares
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.conversation_shares to authenticated, service_role;

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
