-- ═══════════════════════════════════════════════════════════════════════════
-- DA ESEGUIRE SOLO DOPO aver importato i dati dalla vecchia tabella "grow_sync" (voce «Importa dati cloud precedenti»
-- nel pannello Account & Sync) su TUTTI i tuoi dispositivi.
-- La vecchia tabella usava un id casuale generato dall'app e la sola chiave anon: chiunque conoscesse l'id poteva leggerla.
-- Questo script la chiude: RLS attiva e nessuna policy = nessun accesso dal frontend. I dati NON vengono cancellati.
-- ═══════════════════════════════════════════════════════════════════════════
alter table if exists public.grow_sync enable row level security;
alter table if exists public.grow_sync force row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname='public' and tablename='grow_sync' loop
    execute format('drop policy %I on public.grow_sync', p.policyname);
  end loop;
end $$;
revoke all on public.grow_sync from anon, authenticated;
