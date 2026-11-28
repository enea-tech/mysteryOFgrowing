// Verifica REALE dello schema SQL con PostgreSQL (PGlite): sintassi, RLS, trigger versioni, nessun DELETE, idempotenza
const { PGlite } = require('/tmp/claude-0/-home-claude/ac6b3413-6d88-5f25-a657-1f339edb871a/scratchpad/libs/node_modules/@electric-sql/pglite');
const fs=require('fs'); const S=process.argv[2];
let pass=0, fail=0; const ok=(n,c,x)=>{ console.log((c?'PASS ':'FAIL ')+n+(x!==undefined?'  → '+x:'')); c?pass++:fail++; };
(async()=>{
  const pg=new PGlite();
  // stub Supabase: ruoli, auth.users, auth.uid(), storage.buckets/objects, storage.foldername
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
    grant usage on schema public to anon, authenticated;
  `);
  const sql=fs.readFileSync(S+'/supabase/01_schema.sql','utf8');
  try{ await pg.exec(sql); ok('01_schema.sql eseguito senza errori su PostgreSQL',true); }catch(e){ ok('01_schema.sql eseguito',false,e.message); process.exit(1); }
  try{ await pg.exec(sql); ok('01_schema.sql idempotente (seconda esecuzione ok)',true); }catch(e){ ok('idempotente',false,e.message); }
  const A='11111111-1111-1111-1111-111111111111', B='22222222-2222-2222-2222-222222222222';
  await pg.exec(`insert into auth.users(id,email) values('${A}','a@x.it'),('${B}','b@x.it')`);
  const as=async(uid,role,q,params)=>{ await pg.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid||''}',false)`); try{ return await pg.query(q,params); } finally { await pg.exec('reset role'); } };
  const P1='aaaaaaaa-0000-0000-0000-000000000001';
  let r=await as(A,'authenticated',`insert into plants(id,ord,body) values('${P1}',0,'{"name":"Alpha"}') returning version,server_seq,user_id`);
  ok('insert come utente A: user_id=auth.uid() automatico, version=1, server_seq assegnato', r.rows[0].user_id===A&&r.rows[0].version===1&&Number(r.rows[0].server_seq)>0, JSON.stringify(r.rows[0]));
  let e=null; try{ await as(A,'authenticated',`insert into plants(user_id,id,body) values('${B}','aaaaaaaa-0000-0000-0000-000000000002','{}')`);}catch(x){e=x.message;} ok('A non può inserire righe a nome di B (RLS with check)', !!e, e);
  r=await as(B,'authenticated',`select * from plants`); ok('B non vede le piante di A', r.rows.length===0);
  r=await as(A,'authenticated',`select * from plants`); ok('A vede le proprie piante', r.rows.length===1);
  r=await as(B,'authenticated',`update plants set body='{"x":1}', version=2 where id='${P1}' returning id`); ok('B non può modificare righe di A (0 righe)', r.rows.length===0);
  r=await as(null,'anon',`select 1`).then(()=>null,x=>x.message); r=null;
  e=null; try{ await as(null,'anon',`select * from plants`);}catch(x){e=x.message;} ok('anon non può leggere (permission denied)', /permission denied/.test(e||''), e);
  e=null; try{ await as(A,'authenticated',`delete from plants where id='${P1}'`);}catch(x){e=x.message;} ok('DELETE vietato anche al proprietario (solo tombstone)', /permission denied/.test(e||''), e);
  r=await as(A,'authenticated',`update plants set body='{"name":"Alpha2"}', version=2 where id='${P1}' and version=1 returning version`); ok('update con version=base+1 e filtro version=base: 1 riga', r.rows.length===1&&r.rows[0].version===2);
  r=await as(A,'authenticated',`update plants set body='{"name":"Alpha3"}', version=2 where id='${P1}' and version=1 returning version`); ok('stesso update con base obsoleta: 0 righe (conflitto rilevabile dal client)', r.rows.length===0);
  e=null; try{ await as(A,'authenticated',`update plants set version=9 where id='${P1}'`);}catch(x){e=x.message;} ok('salto di versione rifiutato dal trigger (40001)', /version_conflict/.test(e||''), e);
  e=null; try{ await as(A,'authenticated',`update plants set user_id='${B}', version=3 where id='${P1}'`);}catch(x){e=x.message;} ok('user_id non trasferibile', !!e, e);
  r=await as(A,'authenticated',`select server_seq from plants where id='${P1}'`); const s1=Number(r.rows[0].server_seq);
  await as(A,'authenticated',`insert into logs(id,plant_id,body) values('bbbbbbbb-0000-0000-0000-000000000001','${P1}','{"text":"x"}')`);
  r=await as(A,'authenticated',`select max(server_seq) m from logs`); ok('server_seq cresce tra tabelle (cursore incrementale valido)', Number(r.rows[0].m)>s1);
  r=await as(A,'authenticated',`update plants set deleted_at=now(), version=3 where id='${P1}' returning deleted_at`); ok('soft delete (tombstone) consentito', r.rows.length===1&&r.rows[0].deleted_at);
  r=await as(A,'authenticated',`insert into reminders(id,title,remind_at,repeat,active) values('cccccccc-0000-0000-0000-000000000001','Annaffia','2027-01-01T08:00:00Z','daily',true) returning id`); ok('reminders insert', r.rows.length===1);
  r=await as(A,'authenticated',`insert into settings(key,value) values('grow-coa','[{"name":"c"}]') returning key`); ok('settings insert', r.rows.length===1);
  r=await as(A,'authenticated',`insert into photos(id,plant_id,storage_path,sha256,bytes,created_at) values('dddddddd-0000-0000-0000-000000000001','${P1}','${A}/dddddddd.jpg','abc',10,now()) returning id`); ok('photos insert', r.rows.length===1);
  // storage policies
  await pg.exec(`insert into storage.buckets(id,name) values('photos','photos') on conflict do nothing`);
  r=await as(A,'authenticated',`insert into storage.objects(bucket_id,name) values('photos','${A}/f.jpg') returning id`); ok('Storage: A scrive nella propria cartella', r.rows.length===1);
  e=null; try{ await as(A,'authenticated',`insert into storage.objects(bucket_id,name) values('photos','${B}/f.jpg')`);}catch(x){e=x.message;} ok('Storage: A NON può scrivere nella cartella di B', !!e, e);
  r=await as(B,'authenticated',`select * from storage.objects`); ok('Storage: B non vede i file di A', r.rows.length===0);
  const meta=await pg.query(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname in ('plants','logs','photos','reminders','settings') and relkind='r'`);
  ok('RLS attiva e forzata su tutte e 5 le tabelle', meta.rows.length===5&&meta.rows.every(x=>x.relrowsecurity&&x.relforcerowsecurity));
  // lockdown legacy
  await pg.exec(`create table public.grow_sync(user_id text primary key, plants jsonb); grant all on public.grow_sync to anon; create policy open_all on public.grow_sync for all to anon using(true); insert into public.grow_sync values('anon_x','[1]');`);
  await as(null,'anon',`select * from grow_sync`); ok('prima del lockdown la tabella legacy è leggibile da anon (situazione attuale)', true);
  await pg.exec(fs.readFileSync(S+'/supabase/02_legacy_lockdown.sql','utf8'));
  e=null; try{ await as(null,'anon',`select * from grow_sync`);}catch(x){e=x.message;} ok('dopo 02_legacy_lockdown.sql anon non legge più grow_sync', /permission denied/.test(e||''), e);
  const keep=await pg.query(`select count(*)::int n from grow_sync`); ok('lockdown non cancella dati (la riga legacy c\'è ancora)', keep.rows[0].n===1);
  try{ await pg.exec(fs.readFileSync(S+'/supabase/03_verify_rls.sql','utf8')); ok('03_verify_rls.sql eseguibile',true);}catch(x){ ok('03_verify_rls.sql eseguibile',false,x.message); }
  console.log('\n'+pass+'/'+(pass+fail)+' passati'); process.exit(fail?1:0);
})();
