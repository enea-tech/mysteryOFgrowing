// MIGRAZIONE: seed v9 → apre v10 → verifica; idempotenza; v9 intatta
const L = require('./lib.js');
(async()=>{
  const S = process.argv[2]; const T = await L.start(S);
  const ctx = await T.newCtx();
  let p = await T.open(ctx,'v9'); const seed = await L.seedV9(p);
  const before = await p.evaluate(async()=>({photos:await db.photos.toArray(), rems:await db.reminders.toArray(), logs:await db.logs.toArray(), ls:localStorage.getItem('grow-plants')}));
  await p.close();
  p = await T.open(ctx,'v10'); await p.evaluate(()=>DL.ready); await p.waitForTimeout(300);
  const r = await p.evaluate(async()=>{
    const v=DL.db; const out={mode:DL.mode, st:DL.st};
    out.plants=await v.plants.toArray(); out.logs=await v.logs.toArray(); out.photos=await v.photos.toArray(); out.rems=await v.reminders.toArray();
    out.settings=await v.settings.toArray(); out.mlog=await v.migrationLog.toArray(); out.q=await v.syncQueue.count();
    out.ls=JSON.parse(localStorage.getItem('grow-plants')); out.leg={photos:await db.photos.toArray(), rems:await db.reminders.toArray(), logs:await db.logs.toArray()};
    out.dbs=(await indexedDB.databases()).map(d=>d.name); return out; });
  T.ok('modalità v10 attiva', r.mode==='v10', r.st.err||'');
  T.ok('DB paralleli: Grow420DB e Grow420DB_v10 coesistono', r.dbs.includes('Grow420DB')&&r.dbs.includes('Grow420DB_v10'), r.dbs);
  T.ok('piante 2', r.plants.length===2); T.ok('log 3 (da LS)', r.logs.length===3, r.logs.length);
  T.ok('foto 4 (con orfana)', r.photos.length===4); T.ok('promemoria 2', r.rems.length===2);
  T.ok('ID foto originali preservati', JSON.stringify(r.photos.map(x=>x.id).sort())===JSON.stringify(seed.photoIds.slice().sort()), r.photos.map(x=>x.id));
  T.ok('ID promemoria originali preservati', r.rems.map(x=>x.id).sort().join()===before.rems.map(x=>x.id).sort().join());
  T.ok('contenuto foto identico byte per byte', r.photos.every(x=>{const o=before.photos.find(y=>y.id===x.id); return o&&o.data===x.data&&o.createdAt===x.createdAt&&o.phase===x.phase;}));
  const uu=new Set(r.plants.map(x=>x.uuid));
  T.ok('foto collegate alla pianta giusta (uuid)', r.photos.filter(x=>x.legacyPlantIdx===0).every(x=>x.plantUuid===r.ls[0].uuid) && r.photos.find(x=>x.legacyPlantIdx===1).plantUuid===r.ls[1].uuid);
  T.ok('foto orfana segnalata, non cancellata', r.photos.find(x=>x.legacyPlantIdx===7).plantUuid===null);
  T.ok('log tutti riferiti a una pianta esistente', r.logs.every(l=>uu.has(l.plantUuid)));
  T.ok('UUID univoci', new Set([...r.plants,...r.logs,...r.photos,...r.rems].map(x=>x.uuid)).size===r.plants.length+r.logs.length+r.photos.length+r.rems.length);
  T.ok('LS: uuid additivi su piante e log, resto invariato', r.ls.every(pl=>pl.uuid&&pl.logs.every(l=>l.uuid)) && r.ls[0].name==='Alpha' && r.ls[0].logs[0].text==='Annaffiata #acqua' && r.ls[0].progress['3-0']===true);
  T.ok('DB v9 intatto (foto, promemoria, log identici)', JSON.stringify(r.leg.photos)===JSON.stringify(before.photos)&&JSON.stringify(r.leg.rems)===JSON.stringify(before.rems)&&JSON.stringify(r.leg.logs)===JSON.stringify(before.logs));
  const ex=r.mlog.find(x=>x.step==='legacy-extras'); T.ok('log legacy non collegato conservato nel registro (non perso)', ex&&ex.info.unmatchedLogs.length===1&&ex.info.unmatchedLogs[0].text==='Log solo nel vecchio DB');
  T.ok('copia originale LS nel registro di migrazione', r.mlog.some(x=>x.step==='pre-backup'&&x.info.ls['grow-plants']===before.ls));
  const cp=r.mlog.find(x=>x.step==='complete'); T.ok('registro: complete+verified con conteggi', cp&&cp.info.verified&&cp.info.photos===4&&cp.info.plants===2, cp&&cp.info);
  T.ok('impostazioni condivise (coa, community) in v10', r.settings.filter(s=>s.kind==='shared').map(s=>s.key).sort().join()==='grow-coa,grow-community');
  T.ok('migrazione non accoda nulla (il primo sync è esplicito)', r.q===0, r.q);
  // idempotenza
  await p.reload(); await p.evaluate(()=>DL.ready);
  const r2 = await p.evaluate(async()=>({starts:(await DL.db.migrationLog.where('step').equals('start').count()), photos:await DL.db.photos.count(), plants:await DL.db.plants.count(), uuid:JSON.parse(localStorage.getItem('grow-plants'))[0].uuid, q:await DL.db.syncQueue.count()}));
  T.ok('secondo avvio: nessuna nuova migrazione, ID stabili, nulla duplicato', r2.starts===1&&r2.photos===4&&r2.plants===2&&r2.uuid===r.ls[0].uuid&&r2.q===0, r2);
  // app utilizzabile
  const ui = await p.evaluate(async()=>{ renderPage(); return {pl:lsGet('grow-plants',[]).length, ph:(await getPlantPhotos(0)).map(x=>x.plantId)}; });
  T.ok('getPlantPhotos(0) restituisce le 2 foto con plantId=0', ui.ph.length===2&&ui.ph.every(x=>x===0), ui);
  await T.done();
})();
