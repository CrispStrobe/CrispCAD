// SPDX-License-Identifier: BSD-3-Clause
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage();page.setDefaultTimeout(60000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/__cad-program-test',route=>route.fulfill({contentType:'text/html',body:'<div id="hidden-cad" hidden></div>'}));
 await page.goto((process.env.BW_CAD_PROGRAM_TEST_URL||'http://127.0.0.1:4331')+'/__cad-program-test');
 const result=await page.evaluate(async({base,motor})=>{
  const {createCadSession}=await import(base+'/packages/core/src/index.ts');
  const {createPresetDocument}=await import(base+'/packages/editor/src/shapes.ts');
  const {createSimulationController}=await import(base+'/packages/editor/src/simulation-controller.ts');
  const doc=structuredClone(createPresetDocument(motor||'hinge'));for(const id of doc.roots)doc.nodes[id].transform.position[2]=70;
  // Keep every physical mate, and remove travel limits for multi-turn encoder coverage.
  for(const joint of doc.joints)delete joint.limits;
  const session=createCadSession(doc),saved=session.serialize();
  const controller=createSimulationController(session,'/cad-assets/manifold.wasm',()=>Promise.resolve(),()=>{},()=>{});
  try {
   await controller.runDegrees('A',720,360);
   const forward=controller.angle('A');
   await controller.runDegrees('A',-360,360);const reverse=controller.angle('A');
   const noWrite=session.serialize()===saved;
   const traveling=controller.runDegrees('A',36000,180).then(()=>false,()=>true);
   await new Promise(r=>setTimeout(r,150));await controller.stop();const canceled=await traveling;
   const stopped=controller.state.state;
   controller.reset();
   return {forward,reverse,noWrite,canceled,stopped,reset:controller.angle('A'),canUndo:session.state.canUndo};
  }finally{controller.dispose();session.dispose();}
 },{base:'/@fs'+process.cwd(),motor:process.argv.includes('--yellow-motor')?'tt-gearmotor':null});
 assert.ok(Math.abs(result.forward-720)<2,JSON.stringify(result));assert.ok(Math.abs(result.reverse-360)<2,JSON.stringify(result));
 assert.equal(result.noWrite,true);assert.equal(result.canceled,true);assert.equal(result.stopped,'paused');assert.equal(result.reset,0);assert.equal(result.canUndo,false);assert.deepEqual(errors,[]);
 console.log('PASS real Jolt CAD controls: 720° forward, 360° reverse, hidden editor clock, encoder waits, cancellation, reset and unchanged design',result);
}finally{await browser.close();}
