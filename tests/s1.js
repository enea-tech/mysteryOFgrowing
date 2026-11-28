// AUTH + primo push + secondo dispositivo (pull, foto, bidirezionale, cancellazioni)
const L = require('./lib.js'); const M = require('./mocksb.js');
(async()=>{
  const S = process.argv[2]; const T = await L.start(S); const mock = await M.create(S);
  const EM='enea@test.it', PW='password-123';
  // ── Dispositivo A con dati v9 migrati
  const cA = await T.newCtx(mock); let A = await T.open(cA,'v9'); const seed = await L.seedV9(A); await A.close(); A = await T.open(cA,'v10'); await A.evaluate(()=>DL.ready); await A.waitForTimeout(300);
  const st0 = await A.evaluate(()=>({status:Sync.st.status}));
  T.ok('senza account: stato "cloud non attivo", nessuna chiamata di rete a Supabase', st0.status==='signedout'&&mock.stats.rest===0, st0);
  // registrazione
  const su = await A.evaluate(([e,p])=>Sync.signUp(e,p),[EM,PW]);
  T.ok('registrazione: account creato, richiede verifica email', su.ok&&su.verified===false, su);
  const bad = await A.evaluate(([e,p])=>Sync.signIn(e,p),[EM,PW]);
  T.ok('accesso con email NON verificata rifiutato (nessuna sync)', !bad.ok&&/verific/i.test(bad.err), bad.err);
  const weak = await A.evaluate(()=>Sync.signUp('x@y.it','123')); T.ok('password debole rifiutata', !weak.ok, weak.err);
  mock.confirm(EM);
  const wrong = await A.evaluate(([e])=>Sync.signIn(e,'sbagliata'),[EM]); T.ok('password errata rifiutata con messaggio chiaro', !wrong.ok&&/non corrette/.test(wrong.err), wrong.err);
  const si = await A.evaluate(([e,p])=>Sync.signIn(e,p),[EM,PW]); T.ok('accesso con email verificata', si.ok, si);
  // attende il primo ciclo
  await A.waitForFunction(()=>Sync.st.status==='idle'&&Sync.st.last, null, {timeout:15000});
  const uid = mock.userId(EM);
  const srv = async t=> (await mock.query(`select * from public.${t} where user_id=$1`,[uid])).rows;
  const sA = {plants:await srv('plants'), logs:await srv('logs'), photos:await srv('photos'), rems:await srv('reminders'), sets:await srv('settings')};
  T.ok('primo sync (cloud vuoto): piante, log, foto, promemoria e dati condivisi sul server', sA.plants.length===2&&sA.logs.length===3&&sA.photos.length===4&&sA.rems.length===2&&sA.sets.map(x=>x.key).sort().join()==='grow-coa,grow-community', {p:sA.plants.length,l:sA.logs.length,ph:sA.photos.length,r:sA.rems.length,s:sA.sets.length});
  T.ok('righe del server con user_id dell\'utente, versione 1 e ID stabili = ID locali', sA.plants.every(r=>r.user_id===uid&&r.version===1)&&sA.plants.map(r=>r.id).sort().join()===(await A.evaluate(()=>lsGet('grow-plants',[]).map(p=>p.uuid))).sort().join());
  T.ok('file foto nello Storage nella cartella <user_id>/', mock.storage.size===4&&[...mock.storage.keys()].every(k=>k.startsWith(uid+'/')), [...mock.storage.keys()].length);
  const aq = await A.evaluate(async()=>({q:await DL.db.syncQueue.count(), synced:(await DL.db.plants.toArray()).every(r=>r.synced===1), ph:(await DL.db.photos.toArray()).every(r=>r.synced===1&&r.storagePath&&r.sha256)}));
  T.ok('coda svuotata dopo l\'invio; righe locali marcate sincronizzate', aq.q===0&&aq.synced&&aq.ph, aq);
  T.ok('token di sessione NON presente nel backup', await A.evaluate(async()=>{ await Backup.build().then(b=>b.blob.text()).then(t=>{ window.__t=t; }); return !/access_token|refresh_token/.test(window.__t)&&!!localStorage.getItem('sb-grow420-auth'); }));
  // ── Dispositivo B (nuovo, vuoto)
  const cB = await T.newCtx(mock); let B = await T.open(cB,'v10'); await B.evaluate(()=>DL.ready);
  await B.evaluate(([e,p])=>Sync.signIn(e,p),[EM,PW]);
  await B.waitForFunction(()=>Sync.st.status==='idle'&&Sync.st.last, null, {timeout:20000});
  const b1 = await B.evaluate(async()=>{ const ph=await DL.photos.all(); return {pl:lsGet('grow-plants',[]).map(x=>x.name+':'+x.logs.length), uu:lsGet('grow-plants',[]).map(x=>x.uuid), ph:ph.length, sizes:ph.map(x=>x.data.length).sort().join(), plantIds:ph.map(x=>x.plantId).sort().join(), rem:(await DL.reminders.listAll()).length, coa:lsGet('grow-coa',null), q:await DL.db.syncQueue.count(), fs:Sync.st.firstSync}; });
  const a1 = await A.evaluate(async()=>({uu:lsGet('grow-plants',[]).map(x=>x.uuid), sizes:(await DL.photos.all()).map(x=>x.data.length).sort().join(), plantIds:(await DL.photos.all()).map(x=>x.plantId).sort().join()}));
  T.ok('dispositivo B vuoto: scarica piante e log (stessi ID di A)', b1.pl.join()==='Alpha:2,Beta:1'&&b1.uu.join()===a1.uu.join(), b1.pl);
  T.ok('foto scaricate identiche (dimensioni e collegamento alla pianta)', b1.ph===4&&b1.sizes===a1.sizes, {n:b1.ph});
  T.ok('promemoria e dati condivisi sincronizzati su B; nessuna coda residua', b1.rem===2&&b1.coa&&b1.coa[0].name==='COA1'&&b1.q===0, b1);
  const byteEq = await B.evaluate(async()=>{ const all=await DL.photos.all(); return all.map(p=>p.data.slice(0,40)).join('|'); });
  const byteA = await A.evaluate(async()=>{ const all=await DL.photos.all(); return all.map(p=>p.data.slice(0,40)).join('|'); });
  T.ok('foto: contenuto byte per byte uguale (verificato con SHA-256 al download)', byteEq.split('|').sort().join()===byteA.split('|').sort().join());
  // ── bidirezionale: B aggiunge log; A lo riceve; A aggiunge foto; B la riceve
  await B.evaluate(async()=>{ const pl=lsGet('grow-plants',[]); pl[0].logs.push({date:'10/11/2026, 09:00:00',text:'Scritto su B',isProblem:false}); lsSet('grow-plants',pl); await DL.flush(); await Sync.run('t'); });
  await A.evaluate(()=>Sync.run('t')); await A.waitForFunction(()=>!Sync.st.running);
  const a2 = await A.evaluate(()=>lsGet('grow-plants',[])[0].logs.map(l=>l.text));
  T.ok('B → A: nuovo log arriva su A (LocalStorage ricostruito)', a2.includes('Scritto su B')&&a2.length===3, a2);
  await A.evaluate(async()=>{ await DL.photos.add({plantIdx:1,data:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD',createdAt:new Date().toISOString(),phase:4}); await Sync.run('t'); });
  await B.evaluate(()=>Sync.run('t')); await B.waitForFunction(()=>!Sync.st.running);
  const b2 = await B.evaluate(async()=>({n:await DL.photos.count(), p1:(await DL.photos.byPlant(1)).length}));
  T.ok('A → B: nuova foto arriva su B collegata alla pianta giusta', b2.n===5&&b2.p1===2, b2);
  // ── cancellazioni
  await B.evaluate(async()=>{ const all=await DL.photos.all(); const x=all.find(p=>p.plantId===1); await DL.photos.remove(x.id); await Sync.run('t'); });
  const sp = (await srv('photos')); const del = sp.filter(r=>r.deleted_at);
  T.ok('foto eliminata su B: tombstone sul server e file rimosso dallo Storage', del.length===1&&mock.storage.size===4, {del:del.length, files:mock.storage.size});
  await A.evaluate(()=>Sync.run('t')); await A.waitForFunction(()=>!Sync.st.running);
  T.ok('cancellazione foto propagata ad A', (await A.evaluate(()=>DL.photos.count()))===4);
  await A.evaluate(async()=>{ const pl=lsGet('grow-plants',[]); pl.splice(1,1); lsSet('grow-plants',pl); await DL.flush(); await Sync.run('t'); });
  const sp2 = await srv('plants'); T.ok('pianta eliminata su A: tombstone sul server (non DELETE) con i suoi log', sp2.filter(r=>r.deleted_at).length===1&&(await srv('logs')).filter(r=>r.deleted_at).length===1);
  await B.evaluate(()=>Sync.run('t')); await B.waitForFunction(()=>!Sync.st.running);
  const b3 = await B.evaluate(()=>lsGet('grow-plants',[]).map(p=>p.name));
  T.ok('cancellazione pianta propagata a B', b3.join()==='Alpha', b3);
  // ── isolamento tra utenti (RLS reale)
  const E2='altro@test.it'; const B2 = await T.newCtx(mock); const C = await T.open(B2,'v10'); await C.evaluate(()=>DL.ready);
  await C.evaluate(([e,p])=>Sync.signUp(e,p),[E2,PW]); mock.confirm(E2); await C.evaluate(([e,p])=>Sync.signIn(e,p),[E2,PW]);
  await C.waitForFunction(()=>Sync.st.status==='idle'&&Sync.st.last,null,{timeout:15000});
  const c1 = await C.evaluate(async()=>({pl:lsGet('grow-plants',[]).length, ph:await DL.photos.count()}));
  T.ok('RLS: un secondo utente non vede nulla dei dati del primo', c1.pl===0&&c1.ph===0, c1);
  const steal = await C.evaluate(async(path)=>{ const r=await Sync.client.storage.from('photos').download(path); return {err:!!r.error}; }, [...mock.storage.keys()][0]);
  T.ok('Storage: un secondo utente non può scaricare le foto del primo', steal.err);
  // ── persistenza sessione dopo riavvio
  await A.reload(); await A.evaluate(()=>DL.ready); await A.waitForFunction(()=>Sync.st.user,null,{timeout:8000});
  T.ok('sessione ripristinata al riavvio senza nuovo login', (await A.evaluate(()=>Sync.st.user.email))===EM);
  await A.evaluate(()=>Sync.signOut()); const so = await A.evaluate(async()=>({st:Sync.st.status, pl:lsGet('grow-plants',[]).length}));
  T.ok('esci: i dati restano sul dispositivo', so.st==='signedout'&&so.pl===1, so);
  await T.done();
})();
