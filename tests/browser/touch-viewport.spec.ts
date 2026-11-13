import {expect,test} from '@playwright/test';
import {addShape} from './ui.js';
test('model pinch keeps the page at 1x and three touches cannot enlarge the browser chrome',async({page,browserName})=>{
 test.skip(browserName!=='chromium','CDP multi-touch input is Chromium-only; physical iPad accessibility zoom is an OS setting.');
 await page.goto('/');const root=page.locator('#cad-root');await expect(root).toHaveAttribute('data-state','ready');await addShape(page,'Box');await expect(root).toHaveAttribute('data-state','ready');await page.getByLabel('View direction',{exact:true}).selectOption('top');await page.getByRole('button',{name:'Fit',exact:true}).click();await page.getByLabel('Show on-canvas parameters',{exact:true}).check();const canvas=page.getByTestId('cad-canvas'),bounds=(await canvas.boundingBox())!,input=page.getByLabel('On-canvas Position X',{exact:true}),before=Number(await input.getAttribute('data-anchor-x')),doc=await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'));
 const cdp=await page.context().newCDPSession(page),cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height*.22;
 const points=(distance:number)=>[{x:cx-distance,y:cy,id:1},{x:cx+distance,y:cy,id:2}];await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(35)});for(const distance of [38,42,46,50])await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(distance)});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await expect.poll(async()=>Math.abs(Number(await input.getAttribute('data-anchor-x'))-before)).toBeGreaterThan(10);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[...points(40),{x:cx,y:cy+50,id:3}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[...points(75),{x:cx,y:cy+90,id:3}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 expect(await page.evaluate(()=>visualViewport!.scale)).toBeCloseTo(1,5);expect(await canvas.boundingBox()).toEqual(bounds);expect(await page.evaluate(()=>localStorage.getItem('brickwright-cad:standalone:v1'))).toBe(doc);await cdp.detach();
});
