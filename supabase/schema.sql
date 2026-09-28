-- GlassTodo v7.8.0 cloud sync schema.
-- Run once in Supabase SQL Editor. Never place a service_role key in the app.

create table if not exists public.todo_items (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  task_data jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id),
  constraint todo_items_payload_check check (task_data is null or jsonb_typeof(task_data) = 'object')
);

alter table public.todo_items enable row level security;

revoke all on table public.todo_items from anon;
grant select, insert, update on table public.todo_items to authenticated;

drop policy if exists "Users can read their own todo items" on public.todo_items;
create policy "Users can read their own todo items"
on public.todo_items for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own todo items" on public.todo_items;
create policy "Users can insert their own todo items"
on public.todo_items for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own todo items" on public.todo_items;
create policy "Users can update their own todo items"
on public.todo_items for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create index if not exists todo_items_user_updated_idx on public.todo_items (user_id, updated_at desc);
