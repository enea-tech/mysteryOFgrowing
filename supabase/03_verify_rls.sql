-- Controlli manuali (SQL Editor, come utente "postgres"): devono dare risultati attesi
-- 1) RLS attiva su tutte le tabelle private → tutte true
select c.relname, c.relrowsecurity as rls_on, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('plants','logs','photos','reminders','settings') order by 1;
-- 2) Nessuna policy per "anon" e nessun DELETE per "authenticated" → 0 righe
select tablename, policyname, cmd, roles from pg_policies
where schemaname='public' and tablename in ('plants','logs','photos','reminders','settings') and ('anon'=any(roles) or cmd='DELETE');
-- 3) Privilegi: solo select/insert/update per authenticated
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) privs
from information_schema.role_table_grants
where table_schema='public' and table_name in ('plants','logs','photos','reminders','settings') and grantee in ('anon','authenticated')
group by 1,2 order by 1,2;
-- 4) Bucket privato → public = false
select id, public from storage.buckets where id='photos';
