// SPDX-License-Identifier: BSD-3-Clause
import {test,expect} from '@playwright/test';
import {createPresetDocument} from '../../packages/editor/dist/shapes.js';
import {screwVariant,screwTipStyles} from '../../packages/core/dist/index.js';
const ready=async(page:any)=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
async function openScrew(page:any,headStyle='cylindrical',tipStyle='flat'){
 const r=screwVariant('socket-head-screw')!;Object.assign(r,{headStyle,tipStyle,tipLength:5,tipDiameter:6,cupDepth:1,driveStyle:headStyle==='hex'?'none':'cross',driveDepth:.8});r.values.slotWidth=2;
 const doc=createPresetDocument('screw','BW',{recipe:r});doc.nodes[doc.roots[0]].transform.position[2]=20;
 await page.addInitScript(doc=>localStorage.setItem('brickwright-cad:standalone:v1',JSON.stringify(doc)),doc);await page.goto('/');await ready(page);await page.getByTestId('object-name').click();
 const panel=page.locator('.inspector');if(!await panel.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();return panel;
}
test('head and drive changes update their dimensional controls before Apply; Undo keeps the original',async({page})=>{
 const p=await openScrew(page),before=await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'));
 await p.getByLabel('Head type',{exact:true}).selectOption('countersunk');await expect(p.getByLabel('Countersink angle (°)',{exact:true})).toBeVisible();await expect(p.getByLabel('Head height (mm)',{exact:true})).toBeHidden();
 await p.getByLabel('Head type',{exact:true}).selectOption('hex');await expect(p.getByLabel('Head width across flats (mm)',{exact:true})).toBeVisible();await expect(p.getByLabel('Countersink angle (°)',{exact:true})).toBeHidden();
 await p.getByLabel('Head type',{exact:true}).selectOption('headless');await expect(p.getByLabel('Head diameter (mm)',{exact:true})).toBeHidden();await p.getByLabel('Drive type',{exact:true}).selectOption('hex');await expect(p.getByLabel('Socket width across flats (mm)',{exact:true})).toBeVisible();
 await p.getByLabel('Drive type',{exact:true}).selectOption('none');await expect(p.getByLabel('Drive slot width (mm)',{exact:true})).toBeHidden();await expect(p.getByLabel('Drive recess depth (mm)',{exact:true})).toBeHidden();
 expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(before);
 await p.getByLabel('Point type',{exact:true}).selectOption('gimlet');await p.getByRole('button',{name:'Apply shape parameters',exact:true}).click();await ready(page);await expect(p.getByRole('button',{name:'Apply shape parameters',exact:true})).toBeEnabled();
 await page.getByRole('button',{name:'Undo',exact:true}).click();await ready(page);expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(before);
});
test('Properties fits tablet width and accepts vertical but no horizontal finger scrolling',async({page,browserName})=>{
 test.skip(browserName!=='chromium','Trusted touch gestures use the Chromium input protocol; WebKit exercises layout separately.');await page.setViewportSize({width:1024,height:768});const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
 const p=await openScrew(page);await p.getByLabel('Point type',{exact:true}).selectOption('cup');
 const box=(await p.boundingBox())!,point={x:box.x+box.width/2,y:box.y+box.height*.65};
 const metrics=()=>p.evaluate((e:HTMLElement)=>({x:e.scrollLeft,y:e.scrollTop,width:e.clientWidth,content:e.scrollWidth,height:e.clientHeight,scrollHeight:e.scrollHeight,touch:getComputedStyle(e).touchAction}));
 const before=await metrics();expect(before.content).toBeLessThanOrEqual(before.width+1);expect(before.touch).toBe('pan-y');expect(before.scrollHeight).toBeGreaterThan(before.height);
 const swipe=async(dx:number,dy:number)=>{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:point.x+dx*i/12,y:point.y+dy*i/12}]});await page.waitForTimeout(20);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(300);};
 await swipe(-70,0);expect((await metrics()).x).toBe(0);await swipe(0,-160);expect((await metrics()).y).toBeGreaterThan(before.y);expect((await metrics()).x).toBe(0);
});
for(const head of ['cylindrical','hex','countersunk','pan','headless'])for(const [tip] of screwTipStyles)test(`render ${head} / ${tip} and keep the inspector inside its pane`,async({page})=>{
 const p=await openScrew(page,head,tip);await page.getByLabel('View direction',{exact:true}).selectOption('front');await page.getByRole('button',{name:'Fit',exact:true}).click();
 const metrics=await p.evaluate((e:HTMLElement)=>({width:e.clientWidth,content:e.scrollWidth}));expect(metrics.content).toBeLessThanOrEqual(metrics.width+1);await page.screenshot({path:`test-results/screw-${head}-${tip}-${test.info().project.name}.png`});
});
