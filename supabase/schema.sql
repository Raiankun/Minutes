-- Supabase の SQL Editor に貼り付けて実行してください。
-- 文字起こし結果を保存するテーブル。Row Level Security で「自分のデータだけ」見られるようにします。

create table if not exists public.transcripts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null default '',
  text         text not null,
  memo         text not null default '',
  duration_sec real,
  recorded_on  date not null default current_date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists transcripts_user_created_idx
  on public.transcripts (user_id, created_at desc);

alter table public.transcripts enable row level security;

drop policy if exists "transcripts_select_own" on public.transcripts;
drop policy if exists "transcripts_insert_own" on public.transcripts;
drop policy if exists "transcripts_update_own" on public.transcripts;
drop policy if exists "transcripts_delete_own" on public.transcripts;

create policy "transcripts_select_own" on public.transcripts
  for select to authenticated using (auth.uid() = user_id);

create policy "transcripts_insert_own" on public.transcripts
  for insert to authenticated with check (auth.uid() = user_id);

create policy "transcripts_update_own" on public.transcripts
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "transcripts_delete_own" on public.transcripts
  for delete to authenticated using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists transcripts_set_updated_at on public.transcripts;
create trigger transcripts_set_updated_at
  before update on public.transcripts
  for each row execute function public.set_updated_at();

-- ============================================================
-- 予定・投薬・助成金などの管理（plans）。既存の環境でもこのファイル全体を再実行して構いません。
-- ============================================================
create table if not exists public.plans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text not null default 'other' check (kind in ('visit', 'medication', 'procedure', 'grant', 'other')),
  title      text not null check (char_length(title) between 1 and 200),
  due_date   date,
  due_time   time,
  notes      text not null default '',
  done       boolean not null default false,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plans_user_done_due_idx
  on public.plans (user_id, done, due_date);

alter table public.plans enable row level security;

drop policy if exists "plans_select_own" on public.plans;
drop policy if exists "plans_insert_own" on public.plans;
drop policy if exists "plans_update_own" on public.plans;
drop policy if exists "plans_delete_own" on public.plans;

create policy "plans_select_own" on public.plans
  for select to authenticated using (auth.uid() = user_id);

create policy "plans_insert_own" on public.plans
  for insert to authenticated with check (auth.uid() = user_id);

create policy "plans_update_own" on public.plans
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "plans_delete_own" on public.plans
  for delete to authenticated using (auth.uid() = user_id);

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();
