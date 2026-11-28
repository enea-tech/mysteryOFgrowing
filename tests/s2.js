// OFFLINE, RIPRESA, CONFLITTI (tutte le scelte), PRIMO COLLEGAMENTO, IMPORT LEGACY, RACE, INTEGRITÀ FOTO
const L = require('./lib.js'); const M = require('./mocksb.js'); const fs=require('fs');
(async()=>{
  const S = process.argv[2]; const T = await L.start(S); const mock = await M.create(S);
  const EM='enea@test.it', PW='password-123';
  const sync = async p => { await p.evaluate(()=>Sync.run('t')); await p.waitForFunction(()=>!Sync.st.running,null,{timeout:20000}); await p.waitForTimeout(80); };
  const login = async (p,e=EM)=>{ await p.evaluate(([e,pw])=>Sync.signIn(e,pw),[e,PW]); await p.waitForFunction(()=>Sync.st.last||Sync.st.status==='needs-choice',null,{timeout:20000}); };
  const srv = async t=> (await mock.query(`select * from public.${t} where user_id=$1`,[mock.userId(EM)])).rows;
  // preparazione: A (seed v9 migrato) registra, sync; B scarica
  const cA = await T.newCtx(mock); let A = await T.open(cA,'v9'); await L.seedV9(A); await A.close(); A = await T.open(cA,'v10'); await A.evaluate(()=>DL.ready);
  await A.evaluate(([e,p])=>Sync.signUp(e,p),[EM,PW]); mock.confirm(EM); await login(A);
  const cB = await T.newCtx(mock); let B = await T.open(cB,'v10'); await B.evaluate(()=>DL.ready); await login(B);
  // ═══ OFFLINE ═══
  await T.offline(cB,true);
  await B.evaluate(async()=>{ const pl=lsGet('grow-plants',[]); pl[0].logs.push({date:'11/11/2026, 08:00:00',text:'Nota offline 1',isProblem:false}); lsSet('grow-plants',pl); await DL.photos.add({plantIdx:0,data:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAAA',createdAt:new Date().toISOString(),phase:3}); await addReminder('Offline rem','2027-03-01T08:00:00.000Z','once'); await DL.flush(); });
  await B.evaluate(()=>Sync.run('t')); await B.waitForTimeout(200);
  const off = await B.evaluate(async()=>({status:Sync.st.status, q:await DL.db.syncQueue.count(), chip:Sync.label().tx}));
  T.ok('offline: stato "Offline", operazioni accodate (log + foto + promemoria), nessuna perdita', off.status==='offline'&&off.q>=3, off);
  const srvLogs0 = (await srv('logs')).length;
  T.ok('offline: nulla è arrivato al server', srvLogs0===3);
  // l'app viene chiusa con operazioni in coda → riaperta online
  await B.close(); await T.offline(cB,false);
  B = await T.open(cB,'v10'); await B.evaluate(()=>DL.ready); await B.waitForFunction(()=>Sync.st.user&&Sync.st.last,null,{timeout:20000}); await sync(B);
  const on = await B.evaluate(async()=>({q:await DL.db.syncQueue.count(), st:Sync.st.status}));
  T.ok('riapertura con coda persistita: le operazioni ripartono da sole all\'avvio (senza Background Sync)', on.q===0&&(await srv('logs')).length===4&&(await srv('photos')).length===5&&(await srv('reminders')).length===3, on);
  // ripresa al ritorno online SENZA riavvio
  await T.offline(cB,true); await B.evaluate(async()=>{ const pl=lsGet('grow-plants',[]); pl[0].logs.push({date:'12/11/2026, 08:00:00',text:'Nota offline 2',isProblem:false}); lsSet('grow-plants',pl); await DL.flush(); });
  await T.offline(cB,false); await B.evaluate(()=>window.dispatchEvent(new Event('online'))); await B.waitForFunction(()=>Sync.st.queue===0&&!Sync.st.running,null,{timeout:20000}); await B.waitForTimeout(300);
  T.ok('ritorno online: l\'evento "online" riprende la sincronizzazione', (await srv('logs')).length===5);
  await sync(A);
  // ═══ CONFLITTI ═══
  await T.offline(cA,true); await T.offline(cB,true);
  await A.evaluate(async()=>{ const pl=lsGet('grow-plants',[]); pl[0].notes='NOTE da A'; pl[0].logs[0].text='LOG da A'; lsSet('grow-plants',pl); const r=await DL.reminders.listAll(); await deleteReminder(r.find(x=>x.title==='Annaffia').id); await DL.flush(); });
  await B.evaluate(async()=>{ const pl=lsGet('grow-plants',[]); pl[0].notes='NOTE da B'; pl[0].logs[0].text='LOG da B'; lsSet('grow-plants',pl); const r=await DL.reminders.listAll(); await toggleReminder(r.find(x=>x.title==='Annaffia').id,0); await DL.flush(); });
  await T.offline(cA,false); await sync(A);
  await T.offline(cB,false); await sync(B);
  const cf = await B.evaluate(async()=>({st:Sync.st.status, n:Sync.st.conflicts, list:(await Sync.listConflicts()).map(c=>c.entity+':'+c.kind), local:lsGet('grow-plants',[])[0].notes, q:(await DL.db.syncQueue.toArray()).filter(x=>x.status==='conflict').length, label:Sync.label().tx}));
  T.ok('conflitto reale rilevato (pianta, log, promemoria): nessuna sovrascrittura silenziosa', cf.st==='conflict'&&cf.n===3&&cf.list.sort().join()==='log:edit-edit,plant:edit-edit,reminder:edit-delete', cf);
  T.ok('la versione locale resta intatta e il server conserva quella di A', cf.local==='NOTE da B'&&(await srv('plants')).find(p=>p.body.notes==='NOTE da A'), cf.local);
  // UI: pannello con confronto
  await B.evaluate(()=>SyncUI.open()); await B.waitForSelector('.sy-conf',{timeout:5000});
  const ui = await B.evaluate(()=>({n:document.querySelectorAll('.sy-conf').length, txt:document.querySelector('#syncPanel').innerText, btns:[...document.querySelectorAll('.sy-conf')].map(c=>[...c.querySelectorAll('button')].map(b=>b.dataset.ch).join('/'))}));
  T.ok('pannello conflitti: confronto locale/cloud affiancato con le scelte', ui.n===3&&/NOTE da B/.test(ui.txt)&&/NOTE da A/.test(ui.txt)&&ui.btns.some(b=>b==='local/remote/both'), ui.btns);
  await B.screenshot({path:S+'/shots/v10-conflitti.png'});
  const clickCh = async (e,ch)=>{ await B.click(`.sy-conf[data-e="${e}"] button[data-ch="${ch}"]`); await B.waitForFunction(([e])=>!document.querySelector(`.sy-conf[data-e="${e}"]`),[e],{timeout:15000}); };
  await clickCh('plant','both'); await sync(B);
  const r1 = await B.evaluate(()=>lsGet('grow-plants',[]).map(p=>p.name+'|'+p.notes+'|'+p.logs.length));
  T.ok('"Tieni entrambe": la pianta resta con la versione cloud e nasce la copia locale con i suoi log', r1.length===3&&r1.some(x=>/copia locale\)\|NOTE da B/.test(x))&&r1.some(x=>/^Alpha\|NOTE da A/.test(x)), r1);
  await clickCh('log','local'); await sync(B);
  T.ok('"Tieni questa" (log): la scelta locale viene inviata al server', (await srv('logs')).some(l=>l.body.text==='LOG da B'));
  await clickCh('reminder','remote'); await sync(B);
  T.ok('"Usa cloud" (promemoria eliminato altrove): applicata l\'eliminazione', !(await B.evaluate(async()=>(await DL.reminders.listAll()).some(r=>r.title==='Annaffia'))));
  const rl = await B.evaluate(async()=>(await DL.db.migrationLog.where('step').equals('conflict-resolved').toArray()).map(x=>x.info.entity+':'+x.info.choice+':'+!!x.info.local+':'+!!x.info.remote));
  T.ok('le 3 risoluzioni sono registrate con entrambe le versioni conservate', rl.length===3&&rl.sort().join()==='log:local:true:true,plant:both:true:true,reminder:remote:true:true', rl);
  await sync(A);
  const conv = async p => p.evaluate(async()=>JSON.stringify({pl:lsGet('grow-plants',[]).map(x=>[x.uuid,x.name,x.notes,x.logs.map(l=>l.uuid+l.text)]).sort(), ph:(await DL.photos.all()).map(x=>x.uuid).sort(), rem:(await DL.reminders.listAll()).map(r=>r.title).sort()}));
  await sync(B);
  T.ok('dopo la risoluzione A e B convergono allo stesso stato', (await conv(A))===(await conv(B)));
  // eliminata qui / modificata altrove → conflitto delete-edit
  await T.offline(cA,true); await T.offline(cB,true);
  const target = await A.evaluate(()=>lsGet('grow-plants',[]).find(p=>/copia locale/.test(p.name)).uuid);
  await A.evaluate(async u=>{ const pl=lsGet('grow-plants',[]); pl.find(p=>p.uuid===u).notes='A modifica copia'; lsSet('grow-plants',pl); await DL.flush(); }, target);
  await B.evaluate(async u=>{ const pl=lsGet('grow-plants',[]).filter(p=>p.uuid!==u); lsSet('grow-plants',pl); await DL.flush(); }, target);
  await T.offline(cA,false); await sync(A); await T.offline(cB,false); await sync(B);
  const cf2 = await B.evaluate(async()=>(await Sync.listConflicts()).map(c=>c.entity+':'+c.kind));
  T.ok('eliminata su B e modificata su A → conflitto "delete-edit", non cancellazione silenziosa', cf2.includes('plant:delete-edit'), cf2);
  await B.evaluate(async u=>{ await Sync.resolve('plant',u,'remote'); }, target); await sync(B);
  T.ok('scelta "cloud": la pianta modificata torna su B', (await B.evaluate(u=>lsGet('grow-plants',[]).some(p=>p.uuid===u&&p.notes==='A modifica copia'), target)));
  // modifiche identiche = nessun conflitto
  await T.offline(cA,true); await T.offline(cB,true);
  for(const P of [A,B]) await P.evaluate(async()=>{ const pl=lsGet('grow-plants',[]); pl[0].notes='STESSO TESTO'; lsSet('grow-plants',pl); await DL.flush(); });
  await T.offline(cA,false); await sync(A); await T.offline(cB,false); await sync(B);
  T.ok('stessa modifica su due dispositivi: risolta da sola, nessun conflitto', (await B.evaluate(()=>Sync.st.conflicts))===0&&(await B.evaluate(async()=>(await DL.db.syncQueue.count())))===0);
  // ═══ RACE: modifica locale durante l'applicazione remota ═══
  const rc = await A.evaluate(async()=>{
    const v=DL.db; const base=lsGet('grow-plants',[]); const pu=base[0].uuid; const nl=DL.uuid();
    await DL.remoteApply(async()=>{ await v.logs.put({uuid:nl,plantUuid:pu,ord:99,body:{date:'x',text:'log remoto nuovo'},version:1,updatedAt:DL.iso(),deletedAt:null,deviceId:'r',synced:1}); return {plants:true}; },
      async()=>{ const pl=lsGet('grow-plants',[]); pl[0].notes='EDIT durante apply'; lsSet('grow-plants',pl); });
    await DL.flush(); const pl=lsGet('grow-plants',[])[0]; const row=await v.plants.get(pu); const lg=await v.logs.get(nl);
    return {notesLS:pl.notes, notesDB:row.body.notes, remoteLog:pl.logs.some(l=>l.text==='log remoto nuovo'), remoteLogLive:!lg.deletedAt};
  });
  T.ok('RACE: modifica locale durante l\'apply remoto NON viene persa e il log remoto NON viene cancellato', rc.notesLS==='EDIT durante apply'&&rc.notesDB==='EDIT durante apply'&&rc.remoteLog&&rc.remoteLogLive, rc);
  const rc2 = await A.evaluate(async()=>{ const v=DL.db; const pu=lsGet('grow-plants',[])[0].uuid;
    const info=await DL.remoteApply(async()=>{ const r=await v.plants.get(pu); await v.plants.put(Object.assign({},r,{body:Object.assign({},r.body,{notes:'REMOTO'}),version:r.version+1})); return {plants:true}; },
      async()=>{ const pl=lsGet('grow-plants',[]); pl[0].notes='LOCALE'; lsSet('grow-plants',pl); });
    await DL.flush(); const q=await v.syncQueue.where('[entity+uuid]').equals(['plant',pu]).first(); return {race:info.race.length, held:DL.holds.has(pu), qs:q&&q.status, notes:lsGet('grow-plants',[])[0].notes}; });
  T.ok('RACE su stesso campo: versione locale conservata e messa "in attesa di conflitto" (non inviata)', rc2.race===1&&rc2.held&&rc2.qs==='conflict'&&rc2.notes==='LOCALE', rc2);
  await T.done();
})();
