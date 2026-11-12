import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
async function list(dir) { const entries = await readdir(dir, { withFileTypes: true }); const files = await Promise.all(entries.map(e => e.isDirectory() ? list(`${dir}/${e.name}`) : [`${dir}/${e.name}`])); return files.flat(); }
const files = (await list('dist')).filter(f => !f.endsWith('.map') && !f.endsWith('/sw.js') && !f.startsWith('dist/packages/'));
const hash = createHash('sha256'); for (const f of files) hash.update(await readFile(f));
const cache = `bw-cad-${hash.digest('hex').slice(0, 16)}`;
await writeFile('dist/sw.js', `const CACHE=${JSON.stringify(cache)};const FILES=${JSON.stringify(files.map(f => './' + f.slice(5)))};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith(caches.match(event.request,{ignoreVary:true}).then(hit=>hit||fetch(event.request).catch(()=>{if(event.request.mode==='navigate')return caches.match(new URL('./index.html',self.location).href);throw new Error('Offline asset unavailable')})))});
`);
console.log(`Offline bundle: ${files.length} files, ${cache}`);
