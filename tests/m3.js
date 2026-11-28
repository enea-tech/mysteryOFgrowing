// BACKUP V2 / import v1 / validazione / ripristino / modalità sicura
const L = require('./lib.js'); const fs=require('fs');
(async()=>{
  const S = process.argv[2]; const T = await L.start(S);
  const dl = async (p, fn) => { const [d] = await Promise.all([p.waitForEvent('download'), fn()]); const f='/tmp/bk_'+Math.random().toString(36).slice(2)+'.json'; await d.saveAs(f); return {f, name:d.suggestedFilename()}; };
  const okModal = async p => { await p.waitForSelector('#modOk',{timeout:5000}); await p.click('#modOk'); };
  // ── A) backup v1 REALE esportato dalla v9
  let ctx = await T.newCtx(); let p = await T.open(ctx,'v9'); await L.seedV9(p);
  const v1 = await dl(p, ()=>p.evaluate(()=>exportAllData())); await p.close(); await ctx.close();
  const v1j = JSON.parse(fs.readFileSync(v1.f,'utf8')); T.ok('backup v1 reale generato dalla v9', v1j.version===1&&v1j.indexedDB.photos.length===4, v1.name);
  // ── B) contesto vuoto con v10: import v1
  ctx = await T.newCtx(); p = await T.open(ctx,'v10'); await p.evaluate(()=>DL.ready);
  const imp = p.evaluate(async f=>{ const r=await importData(new File([f],'b.json')); return r; }, fs.readFileSync(v1.f,'utf8'));
  const dlSafe = p.waitForEvent('download'); await okModal(p); const safety = await dlSafe; T.ok('prima del ripristino viene salvata una copia di sicurezza automatica', /copia-prima-del-ripristino/.test(safety.suggestedFilename()), safety.suggestedFilename());
  await imp.catch(()=>{}); await p.waitForTimeout(1500); await p.waitForLoadState(); await p.evaluate(()=>DL.ready);
  const a = await p.evaluate(async()=>({pl:lsGet('grow-plants',[]).map(x=>x.name+':'+x.logs.length), ph:await DL.photos.count(), rem:(await DL.reminders.listAll()).length, coa:lsGet('grow-coa',null), stoner:localStorage.getItem('stoner-mode'), act:localStorage.getItem('grow-active-plant'),
    uuid:lsGet('grow-plants',[]).every(x=>x.uuid), v10:{p:await DL.db.plants.count(), l:await DL.db.logs.count(), q:await DL.db.syncQueue.count()}, leg:await db.photos.count(), p0:(await getPlantPhotos(0)).length, ids:(await DL.db.photos.toArray()).map(x=>x.id).sort().join()}));
  T.ok('import v1: piante, log, foto, promemoria, dati condivisi e preferenze ripristinati', a.pl.join()==='Alpha:2,Beta:1'&&a.ph===4&&a.rem===2&&a.coa&&a.stoner==='true'&&a.act==='1', a);
  T.ok('import v1: ID stabili assegnati, ID foto originali mantenuti, tutto in coda per il primo sync', a.uuid&&a.ids==='1,2,3,4'&&a.v10.q>=a.v10.p+a.v10.l+4+2, a.v10);
  T.ok('import v1: foto collegate alla pianta corretta', a.p0===2, a.p0);
  // ── C) export V2 completo
  const v2 = await dl(p, ()=>p.evaluate(()=>exportAllData())); const j2 = JSON.parse(fs.readFileSync(v2.f,'utf8'));
  T.ok('export V2: formato, versione, manifest e checksum presenti', j2.format==='GROW420_BACKUP_V2'&&j2.formatVersion===2&&j2.manifest&&j2.checksum.value&&j2.checksum.algo==='SHA-256', v2.name);
  T.ok('export V2: conteggi = dati reali (piante, log, foto con contenuto, promemoria)', j2.manifest.counts.plants.live===2&&j2.manifest.counts.logs.live===3&&j2.manifest.counts.photos.live===4&&j2.manifest.counts.photos.withData===4&&j2.manifest.counts.reminders.live===2&&j2.manifest.complete===true, j2.manifest.counts);
  T.ok('export V2: ogni foto ha sha256 e contenuto', j2.data.photos.every(x=>x.sha256&&x.data), '');
  const txt = fs.readFileSync(v2.f,'utf8');
  T.ok('export V2: nessun token/credenziale', !/sb-.*auth|access_token|refresh_token|service_role/i.test(txt));
  // set di chiavi sb- finte nel LS non devono finire nel backup
  await p.evaluate(()=>{ localStorage.setItem('sb-khraw-auth-token','{"access_token":"SECRET123"}'); localStorage.setItem('grow-user-id','anon_x'); });
  const v2b = await dl(p, ()=>p.evaluate(()=>exportAllData())); const t2=fs.readFileSync(v2b.f,'utf8');
  T.ok('export V2: token Supabase e grow-user-id esclusi dalle preferenze', !t2.includes('SECRET123')&&!t2.includes('anon_x'));
  // ── D) validazione: file manomessi
  const val = async (obj)=> p.evaluate(async o=>{ const r=await Backup.validateV2(o); return {ok:r.ok,err:r.errors}; }, obj);
  T.ok('validazione: backup integro accettato', (await val(j2)).ok);
  let t = JSON.parse(txt); t.data.photos[0].data = t.data.photos[0].data.slice(0,-8)+'AAAAAAAA'; let r=await val(t); T.ok('validazione: foto alterata rifiutata', !r.ok&&/foto/.test(r.err.join()), r.err);
  t = JSON.parse(txt); t.data.logs[0].body.text='manomesso'; r=await val(t); T.ok('validazione: log alterato rifiutato', !r.ok, r.err);
  t = JSON.parse(txt); t.data.photos.pop(); r=await val(t); T.ok('validazione: foto mancante rifiutata (conteggio/checksum)', !r.ok, r.err);
  t = JSON.parse(txt); t.manifest.counts.plants.live=9; r=await val(t); T.ok('validazione: manifest alterato rifiutato', !r.ok, r.err);
  t = JSON.parse(txt); delete t.checksum; r=await val(t); T.ok('validazione: checksum assente rifiutato', !r.ok, r.err);
  t = JSON.parse(txt); t.data.logs[0].plantUuid='nope'; r=await val(t); T.ok('validazione: log con pianta inesistente rifiutato', !r.ok, r.err);
  const before = await p.evaluate(async()=>({pl:localStorage.getItem('grow-plants'), ph:await DL.db.photos.count()}));
  t = JSON.parse(txt); t.data.photos[1].data='data:image/jpeg;base64,AAAA';
  const bad = await p.evaluate(async s=>await importData(new File([s],'x.json')), JSON.stringify(t));
  const after = await p.evaluate(async()=>({pl:localStorage.getItem('grow-plants'), ph:await DL.db.photos.count()}));
  T.ok('import di file corrotto: rifiutato e NESSUN dato modificato', bad===false&&before.pl===after.pl&&before.ph===after.ph);
  const junk = await p.evaluate(async()=>[await importData(new File(['{not json'],'x.json')), await importData(new File(['{"a":1}'],'x.json'))]);
  T.ok('import di file non-backup/JSON rotto: rifiutato', junk[0]===false&&junk[1]===false);
  // backup dichiarato incompleto
  await p.evaluate(async()=>{ const id=(await DL.db.photos.toArray())[0].id; await DL.db.photos.update(id,{data:null}); });
  const inc = await dl(p, ()=>p.evaluate(()=>exportAllData())); const ji=JSON.parse(fs.readFileSync(inc.f,'utf8'));
  T.ok('backup con foto senza contenuto marcato INCOMPLETO (mai presentato come completo)', ji.manifest.complete===false&&ji.manifest.issues.length===1, ji.manifest.issues);
  // ── E) ripristino V2 in un dispositivo nuovo
  const ctx2 = await T.newCtx(); const p2 = await T.open(ctx2,'v10'); await p2.evaluate(()=>DL.ready);
  const imp2 = p2.evaluate(async s=>await importData(new File([s],'b.json')), txt);
  const dsafe = p2.waitForEvent('download').catch(()=>null); await okModal(p2); await imp2.catch(()=>{}); await p2.waitForTimeout(1500); await p2.evaluate(()=>DL.ready);
  const e = await p2.evaluate(async()=>{ const ph=await DL.photos.all(); return {pl:lsGet('grow-plants',[]).map(x=>x.name+':'+x.logs.length), ph:ph.length, same:ph.map(x=>x.data.length).sort().join(), rem:(await DL.reminders.listAll()).length, uu:lsGet('grow-plants',[])[0].uuid, leg:await db.photos.count()}; });
  const orig = j2.data.photos.map(x=>x.data.length).sort().join();
  T.ok('ripristino V2 su dispositivo vuoto: dati completi, foto identiche, ID stabili conservati', e.pl.join()==='Alpha:2,Beta:1'&&e.ph===4&&e.same===orig&&e.rem===2&&e.uu===j2.data.plants.find(x=>x.ord===0).uuid, e);
  T.ok('ripristino V2: specchio v9 aggiornato (rollback possibile)', e.leg===4, e.leg);
  // ── F) modalità sicura: LS corrotto prima della migrazione → nessun dato toccato, app funzionante
  const ctx3 = await T.newCtx(); let p3 = await T.open(ctx3,'v9'); await L.seedV9(p3);
  await p3.evaluate(()=>localStorage.setItem('grow-plants','{rotto')); await p3.close();
  p3 = await T.open(ctx3,'v10'); await p3.evaluate(()=>DL.ready);
  const f = await p3.evaluate(async()=>({mode:DL.mode, err:DL.st.err, ls:localStorage.getItem('grow-plants'), leg:await db.photos.count(), v10:(await indexedDB.databases()).map(d=>d.name), ph:await DL.photos.count(), m:await DL.db.migrationLog.toArray()}));
  T.ok('LS illeggibile: migrazione annullata, modalità sicura, dati originali identici', f.mode==='legacy'&&f.ls==='{rotto'&&f.leg===4&&/illeggibil/.test(f.err||''), {mode:f.mode, err:f.err});
  T.ok('modalità sicura: foto leggibili dal DB v9 e motivo registrato', f.ph===4&&f.m.some(x=>x.step==='failed'), f.m.map(x=>x.step));
  const add = await p3.evaluate(async()=>{ const id=await DL.photos.add({plantIdx:0,data:'data:image/jpeg;base64,/9j/4AAQ',createdAt:new Date().toISOString(),phase:1}); return {id, n:await db.photos.count()}; });
  T.ok('modalità sicura: le foto continuano a funzionare sul DB v9', add.n===5, add);
  const ver = await p3.evaluate(()=>DL.verify()); T.ok('verifica dati in modalità sicura segnala il problema', ver.ok===false, ver.issues);
  await T.done();
})();
