import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function list(dir) { const entries = await readdir(dir, { withFileTypes: true }); const files = await Promise.all(entries.map(e => e.isDirectory() ? list(`${dir}/${e.name}`) : [`${dir}/${e.name}`])); return files.flat(); }
const files = (await list('dist')).filter(f => !f.endsWith('.map') && !f.endsWith('/sw.js') && !f.startsWith('dist/packages/'));
const eagerFiles = files.filter(file => !file.startsWith('dist/previews/'));
const hash = createHash('sha256'); for (const f of files) hash.update(await readFile(f));
const cache = `bw-cad-${hash.digest('hex').slice(0, 16)}`;
await writeFile('dist/sw.js', `const CACHE=${JSON.stringify(cache)};const FILES=${JSON.stringify(eagerFiles.map(f => './' + f.slice(5)))};
const PREVIEWS='bw-cad-previews-v1';
let previewWrites=Promise.resolve();
function rememberPreview(cache,request,response){
 previewWrites=previewWrites.catch(()=>{}).then(async()=>{
  if(!response.ok||response.status!==200||!response.headers.get('content-type')?.startsWith('image/'))return;
  await cache.put(request,response);
  const keys=await cache.keys();
  for(const key of keys.slice(0,Math.max(0,keys.length-512)))await cache.delete(key);
 });
 return previewWrites.catch(()=>{});
}
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin)return;
 if(/\\/previews\\/[a-f0-9]{64}\\.png$/.test(url.pathname)){
  const cache=caches.open(PREVIEWS).catch(()=>null);
  const cached=cache.then(store=>store?.match(request)).catch(()=>null);
  const network=cached.then(hit=>hit?.ok?null:fetch(request)).catch(()=>null);
  event.waitUntil(Promise.all([cache,network]).then(([store,response])=>store&&response?rememberPreview(store,request,response.clone()):undefined));
  event.respondWith(cached.then(async hit=>hit?.ok?hit:(await network)||Response.error()));
  return;
 }
 event.respondWith(caches.match(request,{ignoreVary:true}).then(hit=>hit||fetch(request).catch(()=>{
  if(request.mode==='navigate')return caches.match(new URL('./index.html',self.location).href);
  throw new Error('Offline asset unavailable');
 })));
});
`);
console.log(`Offline bundle: ${eagerFiles.length} eager files, ${files.length-eagerFiles.length} lazy previews, ${cache}`);
