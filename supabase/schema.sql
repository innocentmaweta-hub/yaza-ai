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
