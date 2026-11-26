// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {addShape} from './ui.js';
const ready=async(page:any)=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
test('wheel, browser pinch and native magnification zoom the camera rather than the page',async({page,isMobile})=>{
 await page.goto('/');await ready(page);const canvas=page.getByTestId('cad-canvas'),bounds=(await canvas.boundingBox())!;await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);const initial=Number(await canvas.getAttribute('data-camera-zoom'));if(isMobile)await canvas.evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true})));else await page.mouse.wheel(0,-100);await expect.poll(async()=>Number(await canvas.getAttribute('data-camera-zoom'))).toBeLessThan(initial);const before=Number(await canvas.getAttribute('data-camera-zoom'));await canvas.evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:-10,ctrlKey:true,bubbles:true,cancelable:true})));await expect.poll(async()=>Number(await canvas.getAttribute('data-camera-zoom'))).toBeLessThan(before);
 const nativeBefore=Number(await canvas.getAttribute('data-camera-zoom'));await canvas.evaluate(el=>{const r=el.getBoundingClientRect();window.dispatchEvent(new CustomEvent('brickwright-camera-input',{detail:{kind:'zoom',factor:1.2,x:r.x+r.width/2,y:r.y+r.height/2}}));});await expect.poll(async()=>Number(await canvas.getAttribute('data-camera-zoom'))).toBeLessThan(nativeBefore);expect(await page.evaluate(()=>window.visualViewport?.scale??1)).toBe(1);
});
test('camera pan/orbit shortcuts and profile changes preserve object geometry and history',async({page})=>{
 await page.goto('/');await ready(page);await addShape(page,'Box');await ready(page);const canvas=page.getByTestId('cad-canvas'),before=await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1')),target=await canvas.getAttribute('data-camera-target'),b=(await canvas.boundingBox())!;await canvas.focus();await page.keyboard.down('Space');await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+50,b.y+b.height/2+20,{steps:4});await page.mouse.up();await page.keyboard.up('Space');expect(await canvas.getAttribute('data-camera-target')).not.toBe(target);expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(before);
 const position=await canvas.getAttribute('data-camera-position');await page.mouse.down({button:'right'});await page.mouse.move(b.x+b.width/2+85,b.y+b.height/2+40,{steps:4});await page.mouse.up({button:'right'});expect(await canvas.getAttribute('data-camera-position')).not.toBe(position);await canvas.focus();await page.keyboard.press('3');await expect(canvas).toHaveAttribute('data-view','top');await page.getByLabel('Application menu',{exact:true}).click();await page.getByRole('button',{name:'Settings…',exact:true}).click();const settings=page.getByRole('dialog',{name:'Settings',exact:true});await settings.getByLabel('Camera controls',{exact:true}).selectOption('fusion');await settings.getByRole('button',{name:'Close',exact:true}).click();await expect(canvas).toHaveAttribute('data-navigation','fusion');const prior=await canvas.getAttribute('data-camera-target');await canvas.evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaX:8,deltaY:5,bubbles:true,cancelable:true})));expect(await canvas.getAttribute('data-camera-target')).not.toBe(prior);expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(before);
});

test('secondary trackpad click cannot open a browser menu during or after camera orbit',async({page})=>{
 await page.goto('/');await ready(page);const canvas=page.getByTestId('cad-canvas'),b=(await canvas.boundingBox())!,before=await page.evaluate(()=>({saved:localStorage.getItem('brickwright-cad:standalone:v1'),origin:performance.timeOrigin}));
 await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down({button:'right'});
 expect(await canvas.evaluate(el=>!el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2})))).toBe(true);
 const position=await canvas.getAttribute('data-camera-position');await page.mouse.move(b.x+b.width/2+40,b.y+b.height/2+20,{steps:3});await page.mouse.up({button:'right'});expect(await canvas.getAttribute('data-camera-position')).not.toBe(position);
 expect(await canvas.evaluate(el=>!el.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2})))).toBe(true);
 expect(await page.evaluate(()=>({saved:localStorage.getItem('brickwright-cad:standalone:v1'),origin:performance.timeOrigin}))).toEqual(before);
});

test('stationary redraws reuse the camera readouts and the view cube',async({page})=>{
 await page.goto('/');await ready(page);
 const canvas=page.getByTestId('cad-canvas');
 const cube=page.getByRole('group',{name:'View cube',exact:true});
 const count=await canvas.evaluate(el=>{
  const observer=new MutationObserver(()=>{});
  observer.observe(el,{attributes:true,attributeFilter:[
   'data-camera-position','data-camera-target','data-camera-zoom','data-view','data-projection',
  ]});
  observer.observe(el.parentElement!.querySelector('.view-cube')!,{attributes:true,subtree:true});
  for(let i=0;i<4;i++)el.dispatchEvent(new Event('brickwright-simulation-capture'));
  const count=observer.takeRecords().length;
  observer.disconnect();
  return count;
 });
 expect(count).toBe(0);
 const initial=await canvas.getAttribute('data-camera-position');
 await cube.getByRole('button',{name:'Top',exact:true}).click();
 await expect(canvas).toHaveAttribute('data-view','top');
 await expect(canvas).not.toHaveAttribute('data-camera-position',initial!);
});
