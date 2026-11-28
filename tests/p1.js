// PWA: cache offline reale (Service Worker attivo), apertura offline, aggiornamento controllato con dati protetti
const L = require('./lib.js'); const M = require('./mocksb.js');
(async()=>{
  const S = process.argv[2]; const T = await L.start(S); const mock = await M.create(S);
  const ctx = await T.newCtx(mock,{sw:true}); let p = await T.open(ctx,'v9'); await L.seedV9(p); await p.close();
  // v10 con SW attivo
  p = await T.open(ctx,'v10'); await p.evaluate(()=>DL.ready);
  for(let i=0;i<30;i++){ const v=await p.evaluate(()=>swVersion()).catch(()=>null); if(v&&v.cache==='grow420-v10') break; await p.waitForTimeout(500); await p.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration(); await r.update();}).catch(()=>{}); }
  await p.reload(); await p.waitForTimeout(800); await p.evaluate(()=>DL.ready);
  const ver = await p.evaluate(()=>swVersion());
  T.ok('Service Worker v10 attivo e controlla la pagina', ver&&ver.cache==='grow420-v10'&&ver.version==='10.0', ver);
  const caches = await p.evaluate(async()=>{ const c=await caches.open('grow420-v10'); return (await c.keys()).map(k=>k.url); });
  T.ok('shell in cache (index, sw, librerie incl. supabase-js fissato)', caches.some(u=>/index\.html$|localhost:\d+\/$/.test(u))&&caches.some(u=>/supabase-js@2\.119\.2/.test(u))&&caches.some(u=>/dexie/.test(u)), caches.length);
  const old = await p.evaluate(async()=>(await caches.keys()));
  T.ok('vecchie cache v9 eliminate', !old.some(k=>/v9/.test(k)), old);
  // offline reale: ricarica l'app senza rete
  await ctx.setOffline(true); ctx.__down=true;
  await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(1200); await p.evaluate(()=>DL.ready);
  const off = await p.evaluate(async()=>({mode:DL.mode, pl:lsGet('grow-plants',[]).length, ph:await DL.photos.count(), badge:document.getElementById('offlineBadge').classList.contains('show'), txt:document.getElementById('offlineBadge').textContent, nav:navigator.onLine, app:!!document.querySelector('#app').innerHTML.length}));
  T.ok('app aperta OFFLINE da cache: Data Layer attivo, piante e foto leggibili', off.mode==='v10'&&off.pl===2&&off.ph===4&&off.app, off);
  T.ok('indicatore offline visibile', off.badge&&/Offline/.test(off.txt), off.txt);
  await p.evaluate(async()=>{ const pl=lsGet('grow-plants',[]); pl[0].logs.push({date:'x',text:'scritto offline con SW',isProblem:false}); lsSet('grow-plants',pl); await DL.photos.add({plantIdx:0,data:'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAA=',createdAt:new Date().toISOString(),phase:3}); await DL.flush(); });
  await p.reload({waitUntil:'domcontentloaded'}); await p.waitForTimeout(800); await p.evaluate(()=>DL.ready);
  const persisted = await p.evaluate(async()=>({logs:lsGet('grow-plants',[])[0].logs.length, ph:await DL.photos.count(), q:await DL.db.syncQueue.count()}));
  T.ok('scritture offline persistono dopo il riavvio dell\'app offline', persisted.logs===3&&persisted.ph===5, persisted);
  await ctx.setOffline(false); ctx.__down=false;
  // ── aggiornamento controllato
  await p.reload(); await p.waitForTimeout(800); await p.evaluate(()=>DL.ready);
  await p.evaluate(async()=>{ const pl=lsGet('grow-plants',[]); pl[1].notes='PRIMA DELL\'AGGIORNAMENTO'; lsSet('grow-plants',pl); });   // modifica NON ancora flushata
  T.hold.swSuffix = "\n// bump test\nself.__t=1;\nconst X='v10-next';\n";
  // il file sw.js cambia: il worker nuovo resta in attesa
  await p.evaluate(async()=>{ const r=await navigator.serviceWorker.getRegistration(); await r.update(); });
  await p.waitForSelector('#updateBanner',{timeout:15000});
  const w = await p.evaluate(async()=>{ const r=await navigator.serviceWorker.getRegistration(); return {waiting:!!r.waiting, banner:document.getElementById('updateBanner').innerText}; });
  T.ok('nuovo SW resta IN ATTESA (nessun cambio di versione a metà sessione) e compare il banner', w.waiting&&/Nuova versione/.test(w.banner), w);
  const navPromise = p.waitForEvent('framenavigated',{timeout:20000}).catch(()=>null);
  await p.click('#updateBanner button'); await navPromise; await p.waitForTimeout(1500); await p.evaluate(()=>DL.ready);
  const after = await p.evaluate(async()=>({notes:lsGet('grow-plants',[])[1].notes, dbNotes:(await DL.db.plants.toArray()).find(r=>r.body.name==='Beta').body.notes, ph:await DL.photos.count(), pl:lsGet('grow-plants',[]).length, mode:DL.mode}));
  T.ok('aggiornamento: nessun dato perso (anche la modifica non ancora scritta), database intatto', after.notes==="PRIMA DELL'AGGIORNAMENTO"&&after.dbNotes===after.notes&&after.ph===5&&after.pl===2&&after.mode==='v10', after);
  T.hold.swSuffix='';
  await T.done();
})();
