// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';

test('draw an outline on the 2D grid, save it, and extrude it later',async({page,hasTouch})=>{
  const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
  await page.goto('/');
  await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
  await press(page.getByRole('button',{name:'Sketch',exact:true}));
  const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
  await sketch.getByLabel('Sketch name').fill('Drawn bracket');
  await press(sketch.getByRole('button',{name:'Draw outline in 2D'}));
  const grid=sketch.getByRole('img',{name:'2D outline drawing grid'});
  for(const [x,y] of [[0,0],[30,0],[30,15],[10,15],[10,25],[0,25],[0,0]]){
    const point=await grid.evaluate((node,[x,y])=>{
      const p=new DOMPoint(x,-y).matrixTransform((node as unknown as SVGSVGElement).getScreenCTM()!);
      return {x:p.x,y:p.y};
    },[x,y]);
    if(hasTouch)await page.touchscreen.tap(point.x,point.y);
    else await page.mouse.click(point.x,point.y);
  }
  const outline=sketch.getByLabel('Outline points X, Y (mm)');
  await expect(outline).toHaveValue('0, 0\n30, 0\n30, 15\n10, 15\n10, 25\n0, 25');
  await press(sketch.getByRole('button',{name:'Save sketch',exact:true}));
  await expect(sketch).toBeHidden();
  await expect(page.getByTestId('object-name')).toHaveCount(0);
  const saved=page.getByRole('button',{name:'Edit sketch: Drawn bracket',exact:true});
  if(!await saved.isVisible())await press(page.getByRole('button',{name:'Objects',exact:true}));
  await press(saved);
  await expect(outline).toHaveValue('0, 0\n30, 0\n30, 15\n10, 15\n10, 25\n0, 25');
  await press(sketch.getByRole('button',{name:'Close sketch'}));
  await press(page.getByRole('button',{name:'Extrude sketch: Drawn bracket',exact:true}));
  await press(sketch.getByRole('button',{name:'Create extrusion',exact:true}));
  await expect(sketch).toBeHidden();
  await expect(page.getByTestId('object-name')).toHaveText('Extrusion');
});
