// SCRITTURE via Data Layer, coda, tombstone, recupero LS, rollback v9, modalità sicura
const L = require('./lib.js');
(async()=>{
  const S = process.argv[2]; const T = await L.start(S);
  const ctx = await T.newCtx();
  let p = await T.open(ctx,'v9'); const seed = await L.seedV9(p); await p.close();
  p = await T.open(ctx,'v10'); await p.evaluate(()=>DL.ready);
  // 1) nuova pianta + log tramite le funzioni reali dell'app
  const w1 = await p.evaluate(async()=>{
    const pl=lsGet('grow-plants',[]); pl.push({name:'Gamma',strain:'X',type:'Fem',phase:1,day:1,startDate:'2026-11-20',notes:'',logs:[],progress:{}}); lsSet('grow-plants',pl);
    journalEditId=2; const ip=document.createElement('input'); ip.id='logInput'; ip.value='Prima nota #test'; document.body.appendChild(ip);
    ['logPH','logEC','logTemp','logHum','logFresh','logDry'].forEach(id=>{const e=document.createElement('input');e.id=id;document.body.appendChild(e);});
    await DL.flush(); const v=DL.db;
    return {plants:await v.plants.count(), q:(await v.syncQueue.toArray()).map(x=>x.entity+':'+x.op), ls:lsGet('grow-plants',[])[2]};
  });
  T.ok('nuova pianta: riga v10 con uuid + coda upsert nella stessa transazione', w1.plants===3 && w1.q.includes('plant:upsert') && w1.ls.uuid, w1.q);
  await p.evaluate(async()=>{ await addLog(); await DL.flush(); });
  const w2 = await p.evaluate(async()=>{ const v=DL.db; const lg=(await v.logs.toArray()).filter(l=>l.body.text==='Prima nota #test'); const ls=lsGet('grow-plants',[])[2];
    return {n:lg.length, ver:lg[0]&&lg[0].version, same:lg[0]&&lg[0].uuid===ls.logs[0].uuid, plantOk:lg[0]&&lg[0].plantUuid===ls.uuid, q:(await v.syncQueue.where('entity').equals('log').toArray()).length}; });
  T.ok('log da addLog(): uuid stabile, versione 1, collegato, in coda', w2.n===1&&w2.ver===1&&w2.same&&w2.plantOk&&w2.q===1, w2);
  // 2) modifica → versione++ ; coalescenza coda
  const w3 = await p.evaluate(async()=>{ const pl=lsGet('grow-plants',[]); pl[2].notes='cambiata'; lsSet('grow-plants',pl); pl[2].notes='cambiata 2'; lsSet('grow-plants',pl); await DL.flush();
    const r=await DL.db.plants.get(pl[2].uuid); const q=await DL.db.syncQueue.where('[entity+uuid]').equals(['plant',pl[2].uuid]).toArray(); return {ver:r.version, body:r.body.notes, q:q.length}; });
  T.ok('modifica: versione incrementata, una sola voce in coda per entità', w3.ver>=2 && w3.body==='cambiata 2' && w3.q===1, w3);
  // 3) cancellazione pianta → tombstone (soft delete), log tombstone, niente perdita
  const w4 = await p.evaluate(async()=>{ journalEditId=2; const pl=lsGet('grow-plants',[]); const u=pl[2].uuid; const lu=pl[2].logs[0].uuid;
    pl.splice(2,1); lsSet('grow-plants',pl); await DL.flush(); const r=await DL.db.plants.get(u); const l=await DL.db.logs.get(lu); const q=await DL.db.syncQueue.where('[entity+uuid]').equals(['plant',u]).first();
    return {del:!!r.deletedAt, body:!!r.body, ldel:!!l.deletedAt, q:q&&q.op, live:await DL.db.plants.filter(x=>!x.deletedAt).count()}; });
  T.ok('elimina pianta: soft delete + log tombstone + coda delete, dati conservati', w4.del&&w4.body&&w4.ldel&&w4.q==='delete'&&w4.live===2, w4);
  // 4) foto: add/delete via Data Layer + specchio legacy (stessi id)
  const w5 = await p.evaluate(async()=>{ const d='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='; const id=await DL.photos.add({plantIdx:1,data:d,createdAt:new Date().toISOString(),phase:4});
    const v=DL.db; const row=await v.photos.get(id); const leg=await db.photos.get(id); const q=await v.syncQueue.where('[entity+uuid]').equals(['photo',row.uuid]).first();
    const all=await DL.photos.all(); const mine=all.find(x=>x.id===id);
    await DL.photos.remove(id); const row2=await v.photos.get(id); const leg2=await db.photos.get(id); const q2=await v.syncQueue.where('[entity+uuid]').equals(['photo',row.uuid]).first();
    return {id, rowPlant:row.plantUuid===lsGet('grow-plants',[])[1].uuid, legacy:!!leg&&leg.plantId===1, q:q.op, plantId:mine.plantId, tomb:!!row2.deletedAt&&row2.data===null, legGone:!leg2, q2:q2.op, count:await DL.photos.count()}; });
  T.ok('foto: scrittura v10 + specchio v9 con stesso id + coda', w5.rowPlant&&w5.legacy&&w5.q==='upsert'&&w5.plantId===1, w5);
  T.ok('foto: eliminazione = tombstone senza contenuto + rimossa dallo specchio + coda delete', w5.tomb&&w5.legGone&&w5.q2==='delete'&&w5.count===4, w5);
  // 5) promemoria
  const w6 = await p.evaluate(async()=>{ await addReminder('Nuovo','2027-02-01T08:00:00.000Z','once'); const all=await DL.reminders.listAll(); const n=all.find(r=>r.title==='Nuovo'); const leg=await db.reminders.get(n.id);
    await toggleReminder(n.id,0); const a=(await DL.reminders.get(n.id)).active; await deleteReminder(n.id); const g=await DL.reminders.get(n.id); const row=await DL.db.reminders.get(n.id);
    return {same:!!leg, a, gone:!g, tomb:!!row.deletedAt, ver:row.version, total:(await DL.reminders.listAll()).length}; });
  T.ok('promemoria: add/toggle/delete via DL, specchio, tombstone, versioni', w6.same&&w6.a===0&&w6.gone&&w6.tomb&&w6.ver===3&&w6.total===2, w6);
  // 6) impostazioni condivise
  const w7 = await p.evaluate(async()=>{ lsSet('grow-coa',[{name:'NUOVO'}]); await DL.flush(); const r=await DL.db.settings.get('grow-coa'); return {v:r.value[0].name, ver:r.version}; });
  T.ok('dati condivisi (coa): versione++ in v10', w7.v==='NUOVO'&&w7.ver===2, w7);
  // 7) LS cancellato dal browser → recupero da v10
  await p.evaluate(()=>{ localStorage.removeItem('grow-plants'); localStorage.removeItem('grow-coa'); }); await p.reload(); await p.evaluate(()=>DL.ready); await p.waitForTimeout(200);
  const w8 = await p.evaluate(()=>({hyd:DL.st.hydrated, pl:lsGet('grow-plants',[]).map(x=>x.name+':'+x.logs.length), coa:lsGet('grow-coa',null)}));
  T.ok('LS azzerato: piante, log e dati condivisi ricostruiti da v10', w8.hyd&&w8.pl.join()==='Alpha:2,Beta:1'&&w8.coa&&w8.coa[0].name==='NUOVO', w8);
  // 8) ROLLBACK alla v9: la v9 legge LS + Grow420DB (con specchio)
  await p.evaluate(async()=>{ await DL.photos.add({plantIdx:0,data:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==',createdAt:new Date().toISOString(),phase:3}); });
  await p.close(); p = await T.open(ctx,'v9');
  const rb = await p.evaluate(async()=>({pl:lsGet('grow-plants',[]).map(x=>x.name), photos:(await getPlantPhotos(0)).length, all:await db.photos.count(), rem:(await db.reminders.toArray()).map(r=>r.title)}));
  T.ok('ROLLBACK v9: vede piante, foto (anche quelle scattate in v10) e promemoria', rb.pl.join()==='Alpha,Beta'&&rb.photos===3&&rb.all===5&&rb.rem.length===2, rb);
  // v9 aggiunge una foto dopo il rollback, poi si torna alla v10
  await p.evaluate(async()=>{ await addPhoto(1, await (await fetch('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7')).blob()); });
  await p.close(); p = await T.open(ctx,'v10'); await p.evaluate(()=>DL.ready);
  const rt = await p.evaluate(async()=>({delta:DL.st.delta, n:await DL.photos.count(), q:await DL.db.syncQueue.where('entity').equals('photo').count()}));
  T.ok('ritorno alla v10: foto aggiunta in v9 recuperata (delta), niente doppioni', rt.delta&&rt.delta.photos===1&&rt.n===6, rt);
  await T.done();
})();
