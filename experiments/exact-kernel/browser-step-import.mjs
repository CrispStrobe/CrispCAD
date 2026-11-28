// SPDX-License-Identifier: BSD-3-Clause
// STEP import as exact bodies in the built editor, in the shared Chromium with the iPad Pro 11
// emulation (touch, viewport) and CDP CPU throttling, to see what a tablet-class CPU makes of it:
// wall time from choosing the file to the bodies on screen, the exact worker's own run time (the
// terminal's "Exact kernel: … run … ms" line), and how responsive the page stayed (longest gap
// between animation frames, long tasks on the main thread). Throttling is set on the page and,
// through the browser's CDP endpoint, on every worker it starts, so the exact worker is slowed too.
//   npm run build && npm run preview -- --port 4391 &
//   node experiments/exact-kernel/browser-step-import.mjs [--rate 4] [--url http://127.0.0.1:4391] [--out file.json] [file.step ...]
import {readFileSync,writeFileSync} from 'node:fs';
import {basename} from 'node:path';
import {chromium,devices} from '@playwright/test';

const args=process.argv.slice(2),option=(name,fallback)=>{const i=args.indexOf(name);if(i<0)return fallback;const v=args[i+1];args.splice(i,2);return v;};
const rate=Number(option('--rate','4')),url=option('--url','http://127.0.0.1:4391'),out=option('--out',''),profile=option('--profile',''),port=Number(option('--cdp-port','9351'));
const files=args.length?args:['library/sources/adafruit-electronics/4739 MPM3610 5V Buck.step','library/sources/adafruit-electronics/4884 Feather RP2040.step'];

const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader',`--remote-debugging-port=${port}`]});
// Raw CDP on the browser endpoint: auto-attach to every page and worker and throttle each one.
const version=await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws=new WebSocket(version.webSocketDebuggerUrl);await new Promise((ok,fail)=>{ws.onopen=ok;ws.onerror=fail;});
let id=0;const pending=new Map(),throttled=[];
const send=(method,params={},sessionId)=>new Promise((ok,fail)=>{const n=++id;pending.set(n,{ok,fail});ws.send(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})}));});
ws.onmessage=async event=>{
 const m=JSON.parse(String(event.data));
 if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.fail(new Error(m.error.message)):p.ok(m.result);return;}
 if(m.method==='Target.attachedToTarget'){
  const {sessionId,targetInfo}=m.params;
  if(['page','worker'].includes(targetInfo.type)){
   try{await send('Emulation.setCPUThrottlingRate',{rate},sessionId);throttled.push(`${targetInfo.type} ${targetInfo.url.split('/').pop()}`);}
   catch(error){throttled.push(`${targetInfo.type} ${targetInfo.url.split('/').pop()}: ${error.message}`);}
   // Children of this target (the page's workers) too.
   await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true},sessionId).catch(()=>{});
  }
  await send('Runtime.runIfWaitingForDebugger',{},sessionId).catch(()=>{});
 }
};
await send('Target.setAutoAttach',{autoAttach:true,waitForDebuggerOnStart:true,flatten:true});

const rows=[];
for(const file of files){
 const context=await browser.newContext({...devices['iPad Pro 11']});
 const page=await context.newPage();
 await page.goto(url,{timeout:300_000});
 await page.locator('#cad-root[data-state=ready]').waitFor({timeout:300_000});
 // Responsiveness probes: animation-frame gaps and long tasks on the main thread.
 await page.evaluate(()=>{
  const w=window;w.__gaps=[];w.__long=[];let last=performance.now();
  const frame=now=>{if(now-last>100)w.__gaps.push([Math.round(last),Math.round(now-last)]);last=now;w.__raf=requestAnimationFrame(frame);};w.__raf=requestAnimationFrame(frame);
  new PerformanceObserver(list=>{for(const e of list.getEntries())w.__long.push([Math.round(e.startTime),Math.round(e.duration)]);}).observe({type:'longtask',buffered:false});
 });
 const region=page.getByRole('region',{name:'CAD terminal',exact:true});
 if(!await region.isVisible())await page.getByRole('button',{name:'Terminal',exact:true}).tap();
 // Plain CSS locators while the import runs: role queries cost main-thread time under throttling.
 const input=region.getByRole('combobox',{name:'CAD command'}),entries=page.locator('.terminal-entry');
 const before=await entries.count();
 // Optionally a CPU profile of the main thread from choosing the file to ready (--profile prefix).
 const cdp=profile?await context.newCDPSession(page):undefined;
 if(cdp){await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:1000});await cdp.send('Profiler.start');}
 const chooser=page.waitForEvent('filechooser',{timeout:60_000});
 await input.fill('import step');await input.press('Enter');
 const started=Date.now(),t0=await page.evaluate(()=>performance.now());
 await (await chooser).setFiles({name:basename(file),mimeType:'application/step',buffer:readFileSync(file)});
 let text='';
 for(;;){
  if(await entries.count()>before){text=(await entries.last().textContent())??'';if(/Imported \d+ exact bodies|refused|cannot|error/i.test(text))break;}
  await page.waitForTimeout(250);
  if(Date.now()-started>900_000)throw new Error('timed out');
 }
 const imported=Date.now()-started;
 await page.locator('#cad-root[data-state=ready]').waitFor({timeout:300_000});
 const ready=Date.now()-started;
 if(cdp){const {profile:data}=await cdp.send('Profiler.stop');writeFileSync(`${profile}-${basename(file).replace(/\W+/g,'_')}.cpuprofile`,JSON.stringify(data));}
 const probe=await page.evaluate(()=>{const w=window;cancelAnimationFrame(w.__raf);return {gaps:w.__gaps,long:w.__long};});
 const run=/run (\d+) ms/.exec(text),load=/load (\d+) ms/.exec(text),bodies=/Imported (\d+) exact bodies/.exec(text);
 const after=(list)=>list.filter(([at,d])=>at+d>=t0).map(([at,d])=>[Math.round(at-t0),d]);
 const gaps=after(probe.gaps),long=after(probe.long);
 const longest=Math.max(0,...gaps.map(g=>g[1])),longTasks=long.reduce((a,b)=>a+b[1],0);
 const row={file:basename(file),rate,bodies:bodies?Number(bodies[1]):null,importedMs:imported,readyMs:ready,workerRunMs:run?Number(run[1]):null,kernelLoadMs:load?Number(load[1]):null,
  longestFrameGapMs:Math.round(longest),longTasks:long.length,longTaskMs:Math.round(longTasks),framesOver100ms:gaps.length,gaps,long,status:text.split('\n')[0].slice(0,160)};
 console.log(JSON.stringify(row));rows.push(row);
 await context.close();
}
console.log(JSON.stringify({throttled}));
if(out)writeFileSync(out,JSON.stringify({date:new Date().toISOString(),rate,device:'iPad Pro 11 emulation, shared Chromium',rows,throttled},null,1)+'\n');
ws.close();await browser.close();
