-- ═══════════════════════════════════════════════════════════════════════════
-- GROW 420 v10 — Supabase: schema di sincronizzazione (eseguire UNA volta nello SQL Editor)
-- Sicuro da rieseguire (idempotente). NON tocca la tabella legacy "grow_sync".
-- Principi:
--   • ogni riga appartiene a un utente (user_id = auth.uid()) ed è isolata con RLS
--   • nessun DELETE concesso: le cancellazioni sono "tombstone" (deleted_at) e si propagano ai dispositivi
--   • concorrenza ottimistica: ogni UPDATE deve portare version = version_attuale + 1 (altrimenti errore 40001)
--   • server_seq (monotono) permette il pull incrementale: "dammi tutto ciò che è cambiato dopo X"
--   • il frontend usa SOLO la chiave anon + sessione utente. La chiave service_role NON va mai nel frontend.
-- ═══════════════════════════════════════════════════════════════════════════

create sequence if not exists public.sync_seq;

-- Trigger comune: assegna server_seq, forza version=1 all'inserimento, protegge user_id e la sequenza delle versioni
create or replace function public.sync_touch() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
  else
    if new.user_id <> old.user_id then
      raise exception 'user_id non modificabile' using errcode = '42501';
    end if;
    if new.version <> old.version + 1 then
      raise exception 'version_conflict: atteso %, ricevuto %', old.version + 1, new.version using errcode = '40001';
    end if;
  end if;
  new.server_seq := nextval('public.sync_seq');
  new.server_updated_at := now();
  return new;
end $$;

-- ── piante ─────────────────────────────────────────────────────────────────
create table if not exists public.plants (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  ord int not null default 0,
  body jsonb not null default '{}'::jsonb,           -- nome, genetica, fase, note, progressi, acqua, phaseLog…
  version int not null default 1,
  device_id text,
  client_updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
-- ── log del diario ─────────────────────────────────────────────────────────
create table if not exists public.logs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  plant_id uuid not null,
  ord int not null default 0,
  body jsonb not null default '{}'::jsonb,           -- data, testo, tag, metriche, isProblem
  version int not null default 1,
  device_id text,
  client_updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
-- ── foto (metadati; il file sta nello Storage, bucket "photos") ────────────
create table if not exists public.photos (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  plant_id uuid,                                     -- null = foto non collegata a una pianta
  log_ref text,
  phase int,
  created_at timestamptz,
  storage_path text,                                 -- <user_id>/<id>.jpg
  sha256 text,                                       -- impronta del contenuto, verificata al download
  bytes int,
  mime text,
  version int not null default 1,
  device_id text,
  client_updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
-- ── promemoria ─────────────────────────────────────────────────────────────
create table if not exists public.reminders (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id uuid not null,
  title text not null,
  remind_at timestamptz,
  repeat text not null default 'once',
  active boolean not null default true,
  created_at timestamptz,
  version int not null default 1,
  device_id text,
  client_updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
-- ── impostazioni condivise (COA, community, progressi globali). Le preferenze del dispositivo NON si sincronizzano ──
create table if not exists public.settings (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default 'null'::jsonb,
  version int not null default 1,
  device_id text,
  client_updated_at timestamptz,
  deleted_at timestamptz,
  server_seq bigint not null default 0,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

do $$
declare t text;
begin
  foreach t in array array['plants','logs','photos','reminders','settings'] loop
    execute format('create index if not exists %I on public.%I (user_id, server_seq)', t || '_seq_idx', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.sync_touch()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke all on public.%I from authenticated', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);   -- niente DELETE: solo tombstone
  end loop;
end $$;
revoke all on sequence public.sync_seq from anon;
grant usage on sequence public.sync_seq to authenticated;

-- ── Storage: bucket privato "photos"; ogni utente vede solo la propria cartella <user_id>/ ──
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict (id) do nothing;
drop policy if exists "photos_select_own" on storage.objects;
drop policy if exists "photos_insert_own" on storage.objects;
drop policy if exists "photos_update_own" on storage.objects;
drop policy if exists "photos_delete_own" on storage.objects;
create policy "photos_select_own" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "photos_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
