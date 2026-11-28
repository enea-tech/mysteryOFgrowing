// CARICO: 250 foto ≈ 300 KB ciascuna (~75 MB) → migrazione, backup V2, ripristino, tempi
const L = require('./lib.js'); const fs=require('fs');
(async()=>{
  const S=process.argv[2]; const T=await L.start(S); const ctx=await T.newCtx(); let p=await T.open(ctx,'v9');
  await p.evaluate(async()=>{ localStorage.setItem('grow-plants',JSON.stringify([{name:'Big',strain:'x',type:'Fem',phase:3,day:1,startDate:'2026-10-01',notes:'',logs:Array.from({length:400},(_,i)=>({date:'d'+i,text:'log '+i})),progress:{}}]));
    const mk=i=>{ const a=new Uint8Array(225000); crypto.getRandomValues? (()=>{ for(let o=0;o<a.length;o+=65536) crypto.getRandomValues(a.subarray(o,Math.min(o+65536,a.length))); })() : 0; let s=''; for(let k=0;k<a.length;k+=8192) s+=String.fromCharCode.apply(null,a.subarray(k,k+8192)); return 'data:image/jpeg;base64,'+btoa(s); };
    for(let i=0;i<250;i++) await db.photos.add({plantId:0,logId:null,data:mk(i),createdAt:new Date(Date.now()-i*1000).toISOString(),phase:3}); });
  await p.close(); const t0=Date.now(); p=await T.open(ctx,'v10'); await p.evaluate(()=>DL.ready); const tm=Date.now()-t0;
  const r=await p.evaluate(async()=>({mode:DL.mode, n:await DL.db.photos.count(), rep:DL.st.report, heap:performance.memory&&Math.round(performance.memory.usedJSHeapSize/1e6)}));
  T.ok('migrazione di 250 foto (~75 MB) verificata byte per byte', r.mode==='v10'&&r.n===250&&r.rep.verified, {ms:tm, photoMB:Math.round(r.rep.photoBytes/1e6), heapMB:r.heap});
  const t1=Date.now(); const [d]=await Promise.all([p.waitForEvent('download',{timeout:120000}), p.evaluate(()=>exportAllData())]); const f='/tmp/big.json'; await d.saveAs(f); const te=Date.now()-t1;
  T.ok('backup V2 di 75 MB completato', fs.statSync(f).size>70e6, {MB:Math.round(fs.statSync(f).size/1e6), ms:te});
  const t2=Date.now(); const v=await p.evaluate(async t=>{ const j=JSON.parse(t); const r=await Backup.validateV2(j); return {ok:r.ok,err:r.errors}; }, fs.readFileSync(f,'utf8')); 
  T.ok('validazione checksum di 250 foto', v.ok, {ms:Date.now()-t2, err:v.err});
  const g=await p.evaluate(async()=>{ const t=performance.now(); const a=await DL.photos.all(); return {n:a.length, ms:Math.round(performance.now()-t)}; });
  T.ok('DL.photos.all() (usata dalla Galleria) con 250 foto', g.n===250, g);
  await T.done();
})();
