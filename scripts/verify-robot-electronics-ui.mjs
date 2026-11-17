// SPDX-License-Identifier: BSD-3-Clause
// Requires a built browser SDK and packages. Uses an isolated headless WebKit profile.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {webkit} from 'playwright';
import {createPresetDocument} from '../packages/editor/dist/shapes.js';
import {robotElectronicsMounts} from '../packages/editor/dist/robot-electronics.js';
import {pruneModelProvenance} from '../packages/core/dist/index.js';
const root=resolve('dist/brickwright-sdk'),out=resolve(process.env.PROOF_OUT||'artifacts/electronics-views');await mkdir(out,{recursive:true});
const html=`<!doctype html><html><body style="margin:0"><div id="cad-root" style="width:1440px;height:1000px"></div><script type="module">
import {mountCadEditor} from '/sdk/sdk.js';window.errors=[];
window.loadRobot=async id=>{window.editor?.dispose();const doc=await(await fetch('/model/'+id)).json();window.editor=mountCadEditor(document.querySelector('#cad-root'),{document:doc,wasmURL:'/sdk/cad-assets/manifold.wasm',colorMode:'light',onError:e=>window.errors.push(e.message)});await window.editor.whenIdle();window.editor.frame();};window.ready=true;
</script></body></html>`;
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/'){res.setHeader('content-type','text/html');res.end(html);return;}
 if(url.pathname.startsWith('/model/')){
  const id=decodeURIComponent(url.pathname.slice(7)),doc=createPresetDocument(id==='legacy-atlas'?'robot-atlas-forklift':id);
  if(id==='legacy-atlas'){for(const key of Object.keys(doc.nodes))if(key.startsWith('electronics-'))delete doc.nodes[key];doc.roots=doc.roots.filter(id=>doc.nodes[id]);doc.joints=doc.joints.filter(j=>doc.nodes[j.bodyA]&&doc.nodes[j.bodyB]);doc.title='My saved forklift';pruneModelProvenance(doc);}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(doc));return;
 }
 if(!url.pathname.startsWith('/sdk/'))throw Error('Unknown path');
 const path=resolve(root,decodeURIComponent(url.pathname.slice(5)));if(!path.startsWith(root+sep))throw Error('Invalid path');
 const bytes=await readFile(path).catch(async e=>{if(url.pathname==='/sdk/cad-assets/manifold.wasm')return readFile('node_modules/manifold-3d/manifold.wasm');throw e;});
 res.setHeader('content-type',({'.js':'text/javascript','.wasm':'application/wasm','.json':'application/json'})[extname(path)]||'application/octet-stream');res.end(bytes);
}catch(e){res.statusCode=500;res.end(String(e));}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await webkit.launch({headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],results=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:'+server.address().port+'/');await page.waitForFunction(()=>window.ready);
 for(const id of Object.keys(robotElectronicsMounts)){
  await page.evaluate(id=>window.loadRobot(id),id);const wires=Number(await page.locator('canvas[data-wire-count]').getAttribute('data-wire-count'));assert.ok(wires>10,id);
  const hardware=await page.evaluate(()=>{const d=window.editor.session.state.document;return{controller:d.nodes['electronics-controller'].physics.sourcePreset,drivers:d.roots.filter(id=>id.startsWith('electronics-driver-')).length};});
  assert.equal(hardware.controller,'visual-metro-mini');await page.screenshot({path:out+'/'+id+'.png'});results.push({id,wires,...hardware});console.log('PASS',id,wires);
 }
 await page.evaluate(()=>window.loadRobot('legacy-atlas'));const before=await page.evaluate(()=>({source:window.editor.session.serialize(),revision:window.editor.session.state.revision}));
 await page.getByTestId('add-robot-electronics').click();await page.waitForFunction(()=>!!window.editor.session.state.document.nodes['electronics-controller']);await page.evaluate(()=>window.editor.whenIdle());
 const upgraded=await page.evaluate(()=>({title:window.editor.session.state.document.title,revision:window.editor.session.state.revision,controller:!!window.editor.session.state.document.nodes['electronics-controller']}));assert.equal(upgraded.title,'My saved forklift');assert.equal(upgraded.revision,before.revision+1);assert.ok(upgraded.controller);
 await page.getByRole('button',{name:'Undo',exact:true}).click();await page.evaluate(()=>window.editor.whenIdle());assert.equal(await page.evaluate(()=>window.editor.session.serialize()),before.source);
 await page.getByRole('button',{name:'Redo',exact:true}).click();await page.evaluate(()=>window.editor.whenIdle());assert.ok(await page.evaluate(()=>!!window.editor.session.state.document.nodes['electronics-controller']));await page.screenshot({path:out+'/legacy-atlas-upgraded.png'});console.log('PASS legacy Atlas upgrade, title, one history action, exact Undo and Redo');
 const hostErrors=await page.evaluate(()=>window.errors);assert.deepEqual(hostErrors,[]);assert.deepEqual(errors,[]);
 await writeFile(out+'/result.json',JSON.stringify({results,legacyUpgrade:true,errors},null,2)+'\n');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
