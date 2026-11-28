const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
exports.start = async function(S, opts){
  opts = opts || {};
  const libs = path.join(S,'libs/node_modules'); const roots = {v9:path.join(S,'v9run'), v10:path.join(S,'site')};
  let cur = 'v10';
  const mime = {'.html':'text/html','.js':'text/javascript','.json':'application/json','.png':'image/png'};
  const hold={swSuffix:''};
  const srv = http.createServer((q,r)=>{ let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p+='index.html';
    if(p==='/sw.js'&&hold.swSuffix){ r.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}); r.end(fs.readFileSync(path.join(roots[cur],p),'utf8')+hold.swSuffix); return; } const f=path.join(roots[cur],p);
    if(fs.existsSync(f)&&fs.statSync(f).isFile()){r.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);} else {r.writeHead(404);r.end();} });
  await new Promise(r=>srv.listen(0,r)); const port = srv.address().port; const base = `http://localhost:${port}/`;
  const b = await chromium.launch();
  async function newCtx(mock,opts){
    const ctx = await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:(opts&&opts.sw)?'allow':'block',acceptDownloads:true});
    await ctx.route(/cdn\.jsdelivr\.net/, route=>{ const u=route.request().url(); let f=null;
      if(u.includes('dexie')) f=libs+'/dexie/dist/dexie.min.js'; else if(u.includes('chart.js')) f=libs+'/chart.js/dist/chart.umd.js'; else if(u.includes('supabase')) f=libs+'/@supabase/supabase-js/dist/umd/supabase.js';
      f? route.fulfill({path:f,contentType:'text/javascript'}) : route.abort(); });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com|open-meteo/, r=>r.abort());
    ctx.__down=false; if(mock) await ctx.route(/\.supabase\.co/, r=> ctx.__down ? r.abort('internetdisconnected') : mock.route(r));
    return ctx;
  }
  const errs=[];
  async function open(ctx, ver){ cur = ver; const page = await ctx.newPage(); page.on('console',m=>{ if(['error'].includes(m.type())) errs.push(ver+' '+m.type()+': '+m.text()); });
    page.on('pageerror',e=>errs.push(ver+' PAGEERROR: '+e.message)); await page.goto(base); await page.waitForTimeout(400); return page; }
  const offline = async (ctx,v)=>{ ctx.__down=v; await ctx.setOffline(v); };
  const res = []; const ok = (name, cond, extra) => { res.push([name, !!cond]); console.log((cond?'PASS ':'FAIL ')+name+(extra!==undefined?'  → '+(typeof extra==='string'?extra:JSON.stringify(extra)):'')); };
  const done = async ()=>{ console.log('\n'+res.filter(r=>r[1]).length+'/'+res.length+' passati'); const bad=res.filter(r=>!r[1]); if(bad.length) console.log('FALLITI:', bad.map(x=>x[0]).join(' | '));
    console.log('--- errori console ---'); console.log(errs.filter(e=>!/ERR_FAILED|404|net::|Failed to load resource/.test(e)).join('\n')||'(nessuno)'); await b.close(); srv.close(); };
  return {newCtx, open, ok, done, errs, base, offline, hold};
};
// seed v9: piante con log, foto (incl. orfana), promemoria, righe legacy db.logs (1 non collegata), coa/community
exports.seedV9 = async function(page){
  return await page.evaluate(async () => {
    const mk = (c, w=64, h=48) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const x = cv.getContext('2d'); x.fillStyle = c; x.fillRect(0,0,w,h); x.fillStyle='#fff'; x.fillText(c, 4, 20); return cv.toDataURL('image/jpeg', .8); };
    const plants = [
      {name:'Alpha', strain:'Gelato', type:'Fem', phase:3, day:10, startDate:'2026-10-01', notes:'', logs:[{date:'01/11/2026, 10:00:00', text:'Annaffiata #acqua', tags:['acqua'], isProblem:false, metrics:{ph:'6.2', ec:'1.4'}},{date:'02/11/2026, 10:00:00', text:'Foglie gialle', isProblem:true}], progress:{'3-0':true}, water:['2026-11-01T08:00:00.000Z'], phaseLog:[{p:3,d:'2026-10-01T00:00:00.000Z',start:true}]},
      {name:'Beta', strain:'Zkittlez', type:'Aut', phase:4, day:30, startDate:'2026-09-01', notes:'x', logs:[{date:'03/11/2026, 11:00:00', text:'Defogliazione', isProblem:false}], progress:{}}
    ];
    localStorage.setItem('grow-plants', JSON.stringify(plants));
    localStorage.setItem('grow-coa', JSON.stringify([{name:'COA1', thc:'20'}]));
    localStorage.setItem('grow-community', JSON.stringify([{id:1, text:'ciao'}]));
    localStorage.setItem('stoner-mode', 'true'); localStorage.setItem('grow-active-plant', '1');
    const ids = [];
    ids.push(await db.photos.add({plantId:0, logId:null, data:mk('#0a0'), createdAt:'2026-11-01T10:00:00.000Z', phase:3}));
    ids.push(await db.photos.add({plantId:0, logId:null, data:mk('#a00'), createdAt:'2026-11-02T10:00:00.000Z', phase:3}));
    ids.push(await db.photos.add({plantId:1, logId:null, data:mk('#00a'), createdAt:'2026-11-03T10:00:00.000Z', phase:4}));
    ids.push(await db.photos.add({plantId:7, logId:null, data:mk('#aa0'), createdAt:'2026-11-04T10:00:00.000Z', phase:null}));
    await db.reminders.add({title:'Annaffia', datetime:'2027-01-01T08:00:00.000Z', repeat:'daily', active:1, createdAt:'2026-11-01T00:00:00.000Z'});
    await db.reminders.add({title:'Fatto', datetime:'2026-10-01T08:00:00.000Z', repeat:'once', active:0, createdAt:'2026-10-01T00:00:00.000Z'});
    await db.logs.add({plantId:0, date:'01/11/2026, 10:00:00', text:'Annaffiata #acqua', tags:['acqua'], metrics:{}, isProblem:0, photos:[]});
    await db.logs.add({plantId:0, date:'09/11/2026, 10:00:00', text:'Log solo nel vecchio DB', tags:[], metrics:{}, isProblem:0, photos:[]});
    return {photoIds:ids};
  });
};
