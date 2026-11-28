// Server Supabase di prova: PostgreSQL REALE (PGlite) con lo schema/RLS/trigger di supabase/01_schema.sql
// + traduzione minima di PostgREST (select/insert/patch con filtri eq/gt/is, order, limit, count) + Auth + Storage (in memoria, con regola cartella=user id).
// Limite onesto: la traduzione HTTP è una simulazione mia di PostgREST; il database (RLS, trigger, vincoli) è reale.
const { PGlite } = require('/tmp/claude-0/-home-claude/ac6b3413-6d88-5f25-a657-1f339edb871a/scratchpad/libs/node_modules/@electric-sql/pglite');
const fs = require('fs'), crypto = require('crypto');
const b64u = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
exports.create = async function(S){
  const pg = new PGlite();
  await pg.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean default false);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
    grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated;
    grant usage on schema public to anon, authenticated;`);
  await pg.exec(fs.readFileSync(S + '/supabase/01_schema.sql', 'utf8'));
  await pg.exec(`create table public.grow_sync(user_id text primary key, plants jsonb, coa jsonb, community jsonb, settings jsonb, updated_at timestamptz); grant select on public.grow_sync to anon;
                 create policy anon_read on public.grow_sync for select to anon using(true); alter table public.grow_sync enable row level security;`);
  const cols = {};
  for(const t of ['plants','logs','photos','reminders','settings']){ cols[t] = (await pg.query(`select column_name n, data_type d from information_schema.columns where table_schema='public' and table_name=$1`, [t])).rows; }
  let chain = Promise.resolve();
  const lock = fn => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };
  const M = {pg, users:{}, tokens:{}, storage:new Map(), down:false, log:[], stats:{rest:0}, mails:[]};
  const CORS = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS','access-control-expose-headers':'content-range,content-type'};
  const J = (status, body, extra) => ({status, headers:Object.assign({'content-type':'application/json'}, CORS, extra || {}), body:JSON.stringify(body, (k, v) => typeof v === 'bigint' ? Number(v) : v)});
  const mkUser = u => ({id:u.id, aud:'authenticated', role:'authenticated', email:u.email, email_confirmed_at:u.confirmed || null, confirmed_at:u.confirmed || null, phone:'', created_at:u.created, updated_at:u.created, app_metadata:{provider:'email', providers:['email']}, user_metadata:{}, identities:[{id:u.id, user_id:u.id, identity_data:{email:u.email}, provider:'email'}]});
  const session = u => { const exp = Math.floor(Date.now() / 1000) + 3600; const jwt = b64u({alg:'HS256', typ:'JWT'}) + '.' + b64u({sub:u.id, email:u.email, role:'authenticated', aud:'authenticated', exp}) + '.' + b64u('sig'); const rt = crypto.randomUUID(); M.tokens[rt] = u.id;
    return {access_token:jwt, token_type:'bearer', expires_in:3600, expires_at:exp, refresh_token:rt, user:mkUser(u)}; };
  const uidFrom = h => { const a = (h['authorization'] || '').replace(/^Bearer /, ''); const p = a.split('.'); if(p.length !== 3) return null; try{ const j = JSON.parse(Buffer.from(p[1], 'base64url').toString()); return j.sub || null; }catch(e){ return null; } };
  M.confirm = email => { const u = Object.values(M.users).find(x => x.email === email); u.confirmed = new Date().toISOString(); };
  M.userId = email => (Object.values(M.users).find(x => x.email === email) || {}).id;
  M.query = (sql, params) => lock(() => pg.query(sql, params));
  M.asUser = (uid, sql, params) => lock(async () => { await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false)`); try{ return await pg.query(sql, params); } finally { await pg.exec('reset role'); } });

  function multipart(buf, ct){
    const bd = '--' + /boundary=(.+)$/.exec(ct)[1]; const parts = []; let i = buf.indexOf(bd);
    while(i >= 0){ const j = buf.indexOf(bd, i + bd.length); if(j < 0) break; const part = buf.slice(i + bd.length + 2, j - 2); const h = part.indexOf('\r\n\r\n'); parts.push({head:part.slice(0, h).toString(), body:part.slice(h + 4)}); i = j; }
    return (parts.find(p => /filename=/.test(p.head)) || parts[parts.length - 1]).body;
  }
  M.route = async route => {
    const req = route.request(), url = new URL(req.url()), h = req.headers(), method = req.method(); const p = url.pathname;
    const send = r => route.fulfill(r);
    if(M.down) return route.abort('internetdisconnected');
    if(method === 'OPTIONS') return send({status:204, headers:CORS});
    try{
      // ── AUTH ──
      if(p === '/auth/v1/signup'){ const b = JSON.parse(req.postData() || '{}');
        if(Object.values(M.users).some(x => x.email === b.email)) return send(J(422, {code:422, error_code:'user_already_exists', msg:'User already registered'}));
        if(!b.password || b.password.length < 8) return send(J(422, {code:422, error_code:'weak_password', msg:'Password should be at least 8 characters'}));
        const u = {id:crypto.randomUUID(), email:b.email, pw:b.password, confirmed:null, created:new Date().toISOString()}; M.users[u.id] = u; M.mails.push({to:b.email, kind:'confirm'});
        await M.query(`insert into auth.users(id,email) values($1,$2)`, [u.id, u.email]); return send(J(200, mkUser(u))); }
      if(p === '/auth/v1/token'){ const g = url.searchParams.get('grant_type'); const b = JSON.parse(req.postData() || '{}');
        if(g === 'password'){ const u = Object.values(M.users).find(x => x.email === b.email);
          if(!u || u.pw !== b.password) return send(J(400, {code:400, error_code:'invalid_credentials', msg:'Invalid login credentials'}));
          if(!u.confirmed) return send(J(400, {code:400, error_code:'email_not_confirmed', msg:'Email not confirmed'}));
          return send(J(200, session(u))); }
        if(g === 'refresh_token'){ const uid = M.tokens[b.refresh_token]; if(!uid) return send(J(400, {code:400, error_code:'refresh_token_not_found', msg:'Invalid Refresh Token'})); return send(J(200, session(M.users[uid]))); } }
      if(p === '/auth/v1/user'){ const uid = uidFrom(h); if(!uid) return send(J(401, {code:401, msg:'missing sub claim'})); return send(J(200, mkUser(M.users[uid]))); }
      if(p === '/auth/v1/logout') return send({status:204, headers:CORS});
      if(p === '/auth/v1/recover'){ M.mails.push({to:JSON.parse(req.postData() || '{}').email, kind:'recover'}); return send(J(200, {})); }
      // ── STORAGE ──
      let m = /^\/storage\/v1\/object\/(?:authenticated\/)?photos\/(.+)$/.exec(p);
      if(m){ const path = decodeURIComponent(m[1]); const uid = uidFrom(h);
        const allowed = uid && path.split('/')[0] === uid;
        if(!allowed) return send(J(403, {statusCode:'403', error:'Unauthorized', message:'new row violates row-level security policy'}));
        if(method === 'POST' || method === 'PUT'){ const body = multipart(req.postDataBuffer(), h['content-type']); M.storage.set(path, {body, type:'image/jpeg'}); return send(J(200, {Key:'photos/' + path, Id:crypto.randomUUID()})); }
        if(method === 'GET'){ const f = M.storage.get(path); if(!f) return send(J(404, {statusCode:'404', error:'not_found', message:'Object not found'})); return route.fulfill({status:200, headers:Object.assign({'content-type':'application/octet-stream'}, CORS), body:f.body}); } }
      m = /^\/storage\/v1\/object\/photos$/.exec(p);
      if(m && method === 'DELETE'){ const uid = uidFrom(h); const b = JSON.parse(req.postData() || '{}'); (b.prefixes || []).forEach(x => { if(uid && x.split('/')[0] === uid) M.storage.delete(x); }); return send(J(200, [])); }
      // ── REST ──
      m = /^\/rest\/v1\/(\w+)$/.exec(p);
      if(m){ M.stats.rest++; const t = m[1]; const uid = uidFrom(h); const role = uid ? 'authenticated' : 'anon';
        const tc = cols[t]; 
        const filters = []; const params = []; 
        url.searchParams.forEach((val, key) => { if(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(key)) return; const mm = /^(eq|gt|is|neq|gte|lt)\.(.*)$/.exec(val); if(!mm) return;
          if(t === 'grow_sync'){ } else if(!tc.some(c => c.n === key)) throw new Error('colonna sconosciuta ' + key);
          if(mm[1] === 'is'){ filters.push(`"${key}" is ${mm[2] === 'null' ? 'null' : mm[2]}`); } else { params.push(mm[2]); filters.push(`"${key}" ${({eq:'=', gt:'>', neq:'<>', gte:'>=', lt:'<'})[mm[1]]} $${params.length}`); } });
        const where = filters.length ? ' where ' + filters.join(' and ') : '';
        const wantObj = /vnd\.pgrst\.object/.test(h['accept'] || ''); const prefer = h['prefer'] || '';
        const cast = (c) => { const d = (tc.find(x => x.n === c) || {}).d; return d === 'jsonb' ? '::jsonb' : ''; };
        const run = async (sql, pr) => lock(async () => { await pg.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${uid || ''}',false)`); try{ return await pg.query(sql, pr); } finally { await pg.exec('reset role'); } });
        let rows;
        if(method === 'GET' || method === 'HEAD'){
          let ord = ''; const o = url.searchParams.get('order'); if(o){ const [c, dir] = o.split('.'); if(!tc.some(x => x.n === c)) throw new Error('order'); ord = ` order by "${c}" ${dir === 'desc' ? 'desc' : 'asc'}`; }
          const lim = url.searchParams.get('limit') ? ' limit ' + parseInt(url.searchParams.get('limit'), 10) : '';
          const r = await run(`select * from public."${t}"${where}${ord}${lim}`, params); rows = r.rows;
          if(method === 'HEAD') return send({status:200, headers:Object.assign({'content-range':`*/${rows.length}`}, CORS)});
          const extra = /count=exact/.test(prefer) ? {'content-range':`0-${Math.max(0, rows.length - 1)}/${rows.length}`} : {};
          if(wantObj){ if(rows.length !== 1) return send(J(406, {code:'PGRST116', message:'JSON object requested, multiple (or no) rows returned', details:`The result contains ${rows.length} rows`, hint:null})); return send(J(200, rows[0], extra)); }
          return send(J(200, rows, extra));
        }
        if(method === 'POST'){
          const body = JSON.parse(req.postData()); const arr = Array.isArray(body) ? body : [body]; rows = [];
          for(const b of arr){ const ks = Object.keys(b); for(const k of ks) if(!tc.some(c => c.n === k)) return send(J(400, {code:'PGRST204', message:`Could not find the '${k}' column of '${t}' in the schema cache`}));
            const pr = ks.map(k => (typeof b[k] === 'object' && b[k] !== null) ? JSON.stringify(b[k]) : b[k]);
            const r = await run(`insert into public."${t}" (${ks.map(k => '"' + k + '"').join(',')}) values (${ks.map((k, i) => '$' + (i + 1) + cast(k)).join(',')}) returning *`, pr); rows.push(...r.rows); }
          if(wantObj) return send(J(201, rows[0])); return send(J(201, /return=representation/.test(prefer) ? rows : null));
        }
        if(method === 'PATCH'){
          const b = JSON.parse(req.postData()); const ks = Object.keys(b); for(const k of ks) if(!tc.some(c => c.n === k)) return send(J(400, {code:'PGRST204', message:`Could not find the '${k}' column`}));
          const pr = params.slice(); const sets = ks.map(k => { pr.push((typeof b[k] === 'object' && b[k] !== null) ? JSON.stringify(b[k]) : b[k]); return `"${k}" = $${pr.length}${cast(k)}`; });
          const r = await run(`update public."${t}" set ${sets.join(',')}${where} returning *`, pr); rows = r.rows;
          return send(J(200, /return=representation/.test(prefer) ? rows : null));
        }
      }
      return send(J(404, {message:'mock: percorso non gestito ' + method + ' ' + p}));
    }catch(e){
      const code = e.code || ''; const status = code === '23505' ? 409 : (code === '42501' ? 403 : 400);
      return send(J(status, {code, message:e.message, details:null, hint:null}));
    }
  };
  return M;
};
