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

-- ============================================================
-- 薬の管理（medicines）。plans.medicine_id で投薬の予定とひも付けます。
-- ============================================================
create table if not exists public.medicines (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 200),
  storage_note  text not null default '',
  caution_note  text not null default '',
  received_on   date,
  quantity_note text not null default '',
  remaining     integer check (remaining is null or remaining >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists medicines_user_active_idx
  on public.medicines (user_id, active, created_at desc);

alter table public.medicines enable row level security;

drop policy if exists "medicines_select_own" on public.medicines;
drop policy if exists "medicines_insert_own" on public.medicines;
drop policy if exists "medicines_update_own" on public.medicines;
drop policy if exists "medicines_delete_own" on public.medicines;

create policy "medicines_select_own" on public.medicines
  for select to authenticated using (auth.uid() = user_id);
create policy "medicines_insert_own" on public.medicines
  for insert to authenticated with check (auth.uid() = user_id);
create policy "medicines_update_own" on public.medicines
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "medicines_delete_own" on public.medicines
  for delete to authenticated using (auth.uid() = user_id);

drop trigger if exists medicines_set_updated_at on public.medicines;
create trigger medicines_set_updated_at
  before update on public.medicines
  for each row execute function public.set_updated_at();

-- 薬を消しても投薬の予定は残す（ひも付けだけ外す）
alter table public.plans
  add column if not exists medicine_id uuid references public.medicines (id) on delete set null;

create index if not exists plans_medicine_idx on public.plans (medicine_id);

-- ============================================================
-- 資料（documents）。ファイル本体は Storage の非公開バケット「documents」に保存します。
-- ============================================================
create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 200),
  category    text not null default 'other'
              check (category in ('receipt', 'application', 'certificate', 'result', 'prescription', 'other')),
  doc_date    date,
  amount_yen  integer check (amount_yen is null or amount_yen >= 0),
  notes       text not null default '',
  file_path   text,
  file_name   text,
  mime_type   text,
  size_bytes  bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists documents_user_date_idx
  on public.documents (user_id, doc_date desc, created_at desc);

alter table public.documents enable row level security;

drop policy if exists "documents_select_own" on public.documents;
drop policy if exists "documents_insert_own" on public.documents;
drop policy if exists "documents_update_own" on public.documents;
drop policy if exists "documents_delete_own" on public.documents;

create policy "documents_select_own" on public.documents
  for select to authenticated using (auth.uid() = user_id);
create policy "documents_insert_own" on public.documents
  for insert to authenticated with check (auth.uid() = user_id);
create policy "documents_update_own" on public.documents
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "documents_delete_own" on public.documents
  for delete to authenticated using (auth.uid() = user_id);

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- 非公開バケット（1ファイル20MBまで、画像とPDFのみ）
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ファイルは「自分のユーザーID」のフォルダ（<user_id>/...）の中だけ読み書きできる
drop policy if exists "documents_files_select_own" on storage.objects;
drop policy if exists "documents_files_insert_own" on storage.objects;
drop policy if exists "documents_files_update_own" on storage.objects;
drop policy if exists "documents_files_delete_own" on storage.objects;

create policy "documents_files_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents_files_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents_files_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "documents_files_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (storage.foldername(name))[1] = auth.uid()::text);
