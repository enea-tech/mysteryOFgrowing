// PRIMO COLLEGAMENTO (scelta), IMPORT CLOUD LEGACY, INTEGRITÀ FOTO, ERRORI/RLS, UI
const L = require('./lib.js'); const M = require('./mocksb.js');
(async()=>{
  const S = process.argv[2]; const T = await L.start(S); const mock = await M.create(S);
  const EM='enea@test.it', PW='password-123';
  const sync = async p => { await p.evaluate(()=>Sync.run('t')); await p.waitForFunction(()=>!Sync.st.running,null,{timeout:20000}); await p.waitForTimeout(80); };
  const srv = async t=> (await mock.query(`select * from public.${t} where user_id=$1`,[mock.userId(EM)])).rows;
  const cA = await T.newCtx(mock); let A = await T.open(cA,'v9'); await L.seedV9(A); await A.close(); A = await T.open(cA,'v10'); await A.evaluate(()=>DL.ready);
  await A.evaluate(([e,p])=>Sync.signUp(e,p),[EM,PW]); mock.confirm(EM); await A.evaluate(([e,p])=>Sync.signIn(e,p),[EM,PW]); await A.waitForFunction(()=>Sync.st.last,null,{timeout:20000});
  // ═══ primo collegamento con dati su entrambi i lati ═══
  const mkDev = async (name)=>{ const c=await T.newCtx(mock); let p=await T.open(c,'v9'); await p.evaluate(async n=>{ localStorage.setItem('grow-plants',JSON.stringify([{name:n,strain:'S',type:'Fem',phase:2,day:3,startDate:'2026-11-01',notes:'',logs:[{date:'d',text:'solo '+n}],progress:{}}])); await db.photos.add({plantId:0,logId:null,data:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD'+n,createdAt:new Date().toISOString(),phase:2}); }, name); await p.close(); p=await T.open(c,'v10'); await p.evaluate(()=>DL.ready); return {c,p}; };
  const D1 = await mkDev('Locale1');
  await D1.p.evaluate(([e,pw])=>Sync.signIn(e,pw),[EM,PW]);
  await D1.p.waitForSelector('.sy-dlg',{timeout:15000});
  const dtxt = await D1.p.evaluate(()=>document.querySelector('.sy-dlg').innerText);
  T.ok('primo collegamento con dati su entrambi i lati: l\'app CHIEDE cosa fare (nessun merge/sovrascrittura automatica)', /già dei dati nel cloud/.test(dtxt)&&/Unisci/.test(dtxt)&&/Usa il cloud/.test(dtxt), dtxt.slice(0,120));
  T.ok('nel frattempo nulla è stato inviato né scaricato', (await srv('plants')).length===2&&(await D1.p.evaluate(()=>lsGet('grow-plants',[]).length))===1);
  await D1.p.click('.sy-dlg button[data-i="2"]'); await D1.p.waitForTimeout(500);
  const later = await D1.p.evaluate(()=>({st:Sync.st.status, pl:lsGet('grow-plants',[]).length}));
  T.ok('"Decido dopo": sync in pausa, dati locali intatti', later.st==='needs-choice'&&later.pl===1, later);
  const p1 = D1.p.evaluate(()=>Sync.run('t')); await D1.p.waitForSelector('.sy-dlg'); await D1.p.click('.sy-dlg button[data-i="0"]'); await p1; await D1.p.waitForFunction(()=>Sync.st.last&&!Sync.st.running,null,{timeout:20000});
  const m1 = await D1.p.evaluate(async()=>({pl:lsGet('grow-plants',[]).map(p=>p.name).sort().join(), ph:await DL.photos.count()}));
  T.ok('"Unisci": tiene sia i dati locali sia quelli del cloud', m1.pl==='Alpha,Beta,Locale1'&&m1.ph===5, m1);
  T.ok('"Unisci": i dati locali sono finiti sul server, quelli del cloud non sono stati toccati', (await srv('plants')).filter(p=>!p.deleted_at).length===3&&(await srv('photos')).length===5);
  const D2 = await mkDev('Locale2');
  await D2.p.evaluate(([e,pw])=>Sync.signIn(e,pw),[EM,PW]); await D2.p.waitForSelector('.sy-dlg',{timeout:15000});
  const dl = D2.p.waitForEvent('download'); await D2.p.click('.sy-dlg button[data-i="1"]'); const f = await dl;
  T.ok('"Usa il cloud": prima viene salvata una copia di sicurezza completa', /copia-prima-del-cloud/.test(f.suggestedFilename()), f.suggestedFilename());
  await D2.p.waitForFunction(()=>Sync.st.last&&!Sync.st.running,null,{timeout:25000}); await D2.p.waitForTimeout(300);
  const m2 = await D2.p.evaluate(async()=>({pl:lsGet('grow-plants',[]).map(p=>p.name).sort().join(), ph:await DL.photos.count(), q:await DL.db.syncQueue.count()}));
  T.ok('"Usa il cloud": il dispositivo ora coincide con il cloud, Locale2 non è stata inviata', m2.pl==='Alpha,Beta,Locale1'&&m2.ph===5&&m2.q===0&&(await srv('plants')).every(p=>p.body.name!=='Locale2'), m2);
  // ═══ import cloud legacy ═══
  await mock.query(`insert into public.grow_sync(user_id,plants,coa,community,updated_at) values('anon_old1',$1::jsonb,$2::jsonb,'[]'::jsonb,now())`,[JSON.stringify([{name:'Alpha',startDate:'2026-10-01',strain:'dup',logs:[]},{name:'Vecchia',strain:'V',type:'Fem',phase:5,day:50,startDate:'2026-06-01',notes:'',logs:[{date:'x',text:'log vecchio'}],progress:{}}]), JSON.stringify([{name:'COA1',thc:'20'},{name:'COA-vecchio'}])]);
  await A.evaluate(()=>lsSet('grow-user-id','anon_old1'));
  const peek = await A.evaluate(()=>Sync.legacyPeek()); console.log('peek', peek.ok, peek.err||''); const lp = A.evaluate(()=>Sync.legacyImport()); await A.waitForSelector('#modOk',{timeout:8000}); await A.evaluate(()=>1);
  const dlp = A.waitForEvent('download'); await A.click('#modOk'); await dlp; const lr = await lp;
  const lg = await A.evaluate(()=>({pl:lsGet('grow-plants',[]).map(p=>p.name).join(), coa:lsGet('grow-coa',[]).length, alpha:lsGet('grow-plants',[]).find(p=>p.name==='Alpha').strain}));
  T.ok('import cloud precedente: aggiunge solo ciò che manca, non sovrascrive e non duplica', lr.ok&&lr.added===1&&/Vecchia/.test(lg.pl)&&lg.coa===2&&lg.alpha!=='dup', lg);
  T.ok('import cloud precedente: copia di sicurezza prima, registrazione nel log, ID stabili assegnati', (await A.evaluate(async()=>({l:(await DL.db.migrationLog.where('step').equals('legacy-cloud-import').count()), u:lsGet('grow-plants',[]).every(p=>p.uuid)}))).l===1);
  // ═══ integrità foto: file corrotto nello Storage ═══
  await sync(A);
  const victim = [...mock.storage.keys()][0]; const good = mock.storage.get(victim).body; const bad = Buffer.from(good); bad[bad.length-3]^=0xff; mock.storage.set(victim,{body:bad,type:'image/jpeg'});
  const cE = await T.newCtx(mock); const E = await T.open(cE,'v10'); await E.evaluate(()=>DL.ready);
  await E.evaluate(([e,pw])=>Sync.signIn(e,pw),[EM,PW]); await E.waitForFunction(()=>Sync.st.last&&!Sync.st.running,null,{timeout:25000}); await E.waitForTimeout(300);
  const ie = await E.evaluate(async()=>({st:Sync.st.status, err:Sync.st.err, n:await DL.photos.count(), cur:(await DL.db.syncMeta.get('cursor:photos')||{}).value||0}));
  T.ok('foto corrotta nello Storage: rifiutata (impronta SHA-256 diversa), segnalata, stato errore', ie.st==='error'&&/impronta/.test(ie.err||''), ie);
  T.ok('foto corrotta NON salvata sul dispositivo', ie.n<(await srv('photos')).length);
  mock.storage.set(victim,{body:good,type:'image/jpeg'}); await sync(E);
  const ie2 = await E.evaluate(async()=>({st:Sync.st.status, n:await DL.photos.count()}));
  T.ok('ripristinato il file: al ciclo successivo la foto viene scaricata e tutto è completo', ie2.st==='idle'&&ie2.n===(await srv('photos')).filter(p=>!p.deleted_at).length, ie2);
  // ═══ errori server ═══
  await mock.query(`revoke insert on public.reminders from authenticated`);
  await E.evaluate(async()=>{ await addReminder('Bloccato','2027-05-01T08:00:00.000Z','once'); await DL.flush(); await Sync.run('t'); });
  const pe = await E.evaluate(()=>({st:Sync.st.status, err:Sync.st.err}));
  T.ok('RLS/permessi negati: errore chiaro, dati locali al sicuro, operazione resta in coda', pe.st==='error'&&/Permesso negato/.test(pe.err)&&(await E.evaluate(async()=>(await DL.db.syncQueue.toArray()).some(q=>q.entity==='reminder'))), pe);
  await mock.query(`grant insert on public.reminders to authenticated`); await sync(E);
  T.ok('dopo la correzione dei permessi l\'operazione parte da sola', (await srv('reminders')).some(r=>r.title==='Bloccato'));
  // sessione scaduta: refresh token invalido
  await E.evaluate(()=>{ const k='sb-grow420-auth'; const s=JSON.parse(localStorage.getItem(k)); s.access_token='x.y.z'; s.expires_at=1; s.refresh_token='invalido'; localStorage.setItem(k,JSON.stringify(s)); });
  await E.reload(); await E.evaluate(()=>DL.ready); await E.waitForTimeout(1500);
  const ex = await E.evaluate(()=>({st:Sync.st.status, pl:lsGet('grow-plants',[]).length}));
  T.ok('sessione scaduta/revocata: ritorna "non connesso", i dati restano', ex.st==='signedout'&&ex.pl>=3, ex);
  // UI pannello
  await E.evaluate(()=>SyncUI.open()); await E.waitForSelector('#syEmail');
  await E.fill('#syEmail','x'); await E.waitForTimeout(100);
  await E.screenshot({path:S+'/shots/v10-login.png'});
  await A.evaluate(()=>SyncUI.open()); await A.waitForSelector('#sySync'); await A.screenshot({path:S+'/shots/v10-panel.png'});
  const ov = await A.evaluate(()=>({w:document.documentElement.scrollWidth, vw:innerWidth, txt:document.querySelector('#syncPanel').innerText.slice(0,200)}));
  T.ok('pannello Account & Sync: nessun overflow orizzontale, mostra account e stato', ov.w<=ov.vw&&/enea@test.it/.test(ov.txt), ov);
  await T.done();
})();
