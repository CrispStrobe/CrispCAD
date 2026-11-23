// SPDX-License-Identifier: BSD-3-Clause
import {expect,test,type Locator,type Page} from '@playwright/test';
import {sketchBulgeArc} from '@brickwright/cad-core';

async function startDrag(page:Page,vertex:Locator,dx:number,dy:number){
 await vertex.scrollIntoViewIfNeeded();
 const [start,end]=await vertex.evaluate((node,{dx,dy})=>{
  const circle=node as unknown as SVGCircleElement,matrix=circle.getScreenCTM()!;
  const x=circle.cx.baseVal.value,y=circle.cy.baseVal.value;
  return [new DOMPoint(x,y),new DOMPoint(x+dx,y-dy)].map(point=>{
   const screen=point.matrixTransform(matrix);
   return {x:screen.x,y:screen.y};
  });
 },{dx,dy});
 await page.mouse.move(start.x,start.y);
 await page.mouse.down();
 await page.mouse.move(end.x,end.y,{steps:4});
}

test('solves retained outline relations when parameters change and undoes each edit',async({page,hasTouch})=>{
 const press=async(control:ReturnType<typeof page.getByRole>)=>{
  if(hasTouch){
   await control.scrollIntoViewIfNeeded();
   await control.tap();
  }else await control.click();
 };
 const fill=async(control:ReturnType<typeof page.getByLabel>,value:string)=>{
  await control.fill(value);
  await control.blur();
 };
 const workers:string[]=[];
 page.on('worker',worker=>workers.push(worker.url()));
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const openParameters=page.getByRole('button',{name:'Parameters',exact:true});
 const parameters=page.getByRole('dialog',{name:'Model parameters'});
 const expression=parameters.getByLabel('Parameter expression',{exact:true});
 const applyParameters=parameters.getByRole('button',{name:'Apply parameters',exact:true});
 const closeParameters=parameters.getByRole('button',{name:'Close parameters',exact:true});
 const parameterStatus=parameters.getByRole('status',{name:'Parameter status'});
 await press(openParameters);
 await press(parameters.getByRole('button',{name:'Add parameter',exact:true}));
 await fill(parameters.getByLabel('Parameter name',{exact:true}),'reach');
 await fill(expression,'40');
 await press(applyParameters);
 await expect(parameterStatus).toContainText('Parameters applied');
 await press(closeParameters);
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('outline');
 const coordinates=sketch.getByLabel('Outline points X, Y (mm)');
 await fill(coordinates,'0, 0\n38, 3\n35, 22\n2, 20');
 await press(sketch.getByText('Outline constraints',{exact:true}));
 const kind=sketch.getByLabel('Constraint',{exact:true}),edge=sketch.getByLabel('Constrained segment');
 const other=sketch.getByLabel('Second segment'),length=sketch.getByLabel('Segment length (mm)');
 const add=sketch.getByRole('button',{name:'Add constraint',exact:true});
 const solve=sketch.getByRole('button',{name:'Solve outline',exact:true});
 const status=sketch.getByRole('status',{name:'Outline constraint status'});
 let constraintCount=0;
 const append=async(type:string,first:number,argument?:string|number)=>{
  await kind.selectOption(type);
  await edge.selectOption(String(first));
  if(type==='length')await fill(length,String(argument));
  else if(argument!==undefined)await other.selectOption(String(argument));
  await press(add);
  const newest=sketch.getByRole('button',{name:`Remove constraint ${++constraintCount}`,exact:true});
  await expect(newest).toBeVisible();
 };
 await append('horizontal',0);
 await press(solve);
 await expect(status).toContainText('Degrees of freedom: 5');
 await fill(coordinates,'0, 0\n38, 3\n35, 22\n2, 20');
 await append('vertical',1);
 await append('parallel',0,2);
 await append('perpendicular',2,3);
 await append('length',0,'reach');
 await append('equal',0,2);
 await append('length',1,'20');
 await press(solve);
 await expect(status).toContainText('Fully constrained');
 const shape=await coordinates.inputValue();
 const rounded=(value:string)=>value.split('\n').map(row=>row.split(',').map(value=>Math.round(Number(value)*1e6)/1e6+0));
 expect(rounded(shape)).toEqual([[0,0],[40,0],[40,20],[0,20]]);
 expect(workers.some(url=>url.includes('outline-constraints.worker'))).toBe(true);

 await append('length',0,'45');
 await press(solve);
 await expect(status).toContainText('Could not solve');
 await expect(coordinates).toHaveValue(shape);
 await press(sketch.getByRole('button',{name:'Remove constraint 8',exact:true}));
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 await press(sketch.getByRole('button',{name:'Create extrusion',exact:true}));
 await expect(sketch).toBeHidden();
 await expect(page.getByTestId('object-name')).toHaveCount(1);
 await press(openParameters);
 await fill(expression,'-10');
 await press(applyParameters);
 await expect(parameterStatus).toContainText('Dimension must be between');
 await fill(expression,'60');
 await press(applyParameters);
 await expect(parameterStatus).toContainText('Parameters applied');
 await press(closeParameters);
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 const expanded=await coordinates.inputValue();
 expect(rounded(expanded)).toEqual([[0,0],[60,0],[60,20],[0,20]]);
 const apply=sketch.getByRole('button',{name:'Apply sketch changes',exact:true});
 await fill(coordinates,expanded+'\n-10, 10');
 await expect(solve).toBeDisabled();
 await expect(status).toContainText('Restore the original point count');
 await expect(sketch.getByRole('button',{name:'Edit constraint 5',exact:true})).toBeVisible();
 await fill(coordinates,expanded);
 await press(sketch.getByRole('button',{name:'Edit constraint 7',exact:true}));
 await expect(length).toHaveValue('20');
 await fill(length,'25');
 await press(sketch.getByRole('button',{name:'Update constraint',exact:true}));
 await press(apply);
 await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('Solve the outline before saving');
 await press(solve);
 await expect(status).toContainText('Fully constrained');
 expect(rounded(await coordinates.inputValue())).toEqual([[0,0],[60,0],[60,25],[0,25]]);
 await press(apply);
 await expect(sketch).toBeHidden();
 const undo=page.getByRole('button',{name:'Undo',exact:true});
 await press(undo);
 await press(edit);
 await expect(coordinates).toHaveValue(expanded);
 await press(sketch.getByRole('button',{name:'Edit constraint 7',exact:true}));
 await expect(length).toHaveValue('20');
 const closeSketch=sketch.getByRole('button',{name:'Close sketch',exact:true});
 await press(closeSketch);
 const inline=page.getByLabel('Parameter reach (mm)',{exact:true});
 await fill(inline,'70');
 await expect(page.getByLabel('Size X (mm)',{exact:true})).toHaveValue('70');
 await press(undo);
 await expect(inline).toHaveValue('60');
 await press(undo);
 await press(edit);
 await expect(coordinates).toHaveValue(shape);
 await press(closeSketch);
 await press(undo);
 await expect(page.getByTestId('object-name')).toHaveCount(0);
});

test('drives the radius of a closed outline arc and rejects a radius below half its chord',async({page,hasTouch})=>{
 const press=async(control:ReturnType<typeof page.getByRole>)=>{
  if(hasTouch){await control.scrollIntoViewIfNeeded();await control.tap();}
  else await control.click();
 };
 const fill=async(control:ReturnType<typeof page.getByLabel>,value:string)=>{
  await control.fill(value);
  await control.blur();
 };
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const parametersButton=page.getByRole('button',{name:'Parameters',exact:true});
 const parameters=page.getByRole('dialog',{name:'Model parameters'});
 const applyParameters=parameters.getByRole('button',{name:'Apply parameters',exact:true});
 const closeParameters=parameters.getByRole('button',{name:'Close parameters',exact:true});
 const parameterStatus=parameters.getByRole('status',{name:'Parameter status'});
 const expression=parameters.getByLabel('Parameter expression',{exact:true});
 await press(parametersButton);
 await press(parameters.getByRole('button',{name:'Add parameter',exact:true}));
 await fill(parameters.getByLabel('Parameter name',{exact:true}),'rim');
 await fill(expression,'50');
 await press(applyParameters);
 await expect(parameterStatus).toContainText('Parameters applied');
 await press(closeParameters);
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('outline');
 const coordinates=sketch.getByLabel('Outline points X, Y (mm)');
 await fill(coordinates,'0, 0, 0.25\n40, 0\n40, 40\n0, 40');
 await press(sketch.getByText('Outline constraints',{exact:true}));
 await sketch.getByLabel('Constraint',{exact:true}).selectOption('radius');
 await fill(sketch.getByLabel('Arc radius (mm)',{exact:true}),'rim');
 const edge=sketch.getByLabel('Constrained segment'),add=sketch.getByRole('button',{name:'Add constraint',exact:true});
 const status=sketch.getByRole('status',{name:'Outline constraint status'});
 await edge.selectOption('1');
 await press(add);
 await expect(status).toContainText('Curve the segment');
 await edge.selectOption('0');
 await press(add);
 await press(sketch.getByRole('button',{name:'Solve outline',exact:true}));
 await expect(status).toContainText('Outline solved');
 const radius=async()=>{
  const rows=(await coordinates.inputValue()).split('\n').map(row=>row.split(',').map(Number));
  expect(rows.map(row=>row.slice(0,2))).toEqual([[0,0],[40,0],[40,40],[0,40]]);
  return sketchBulgeArc([0,0],[40,0],rows[0][2])!.radius;
 };
 expect(await radius()).toBeCloseTo(50);
 await press(sketch.getByRole('button',{name:'Create extrusion',exact:true}));
 await expect(sketch).toBeHidden();
 await press(parametersButton);
 await fill(expression,'19');
 await press(applyParameters);
 await expect(parameterStatus).toContainText('half its chord length');
 await fill(expression,'25');
 await press(applyParameters);
 await expect(parameterStatus).toContainText('Parameters applied');
 await press(closeParameters);
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 expect(await radius()).toBeCloseTo(25);
 await press(sketch.getByRole('button',{name:'Close sketch',exact:true}));
 await press(page.getByRole('button',{name:'Undo',exact:true}));
 await press(edit);
 expect(await radius()).toBeCloseTo(50);
});

test('retains a smooth join from an outline arc to an adjoining straight segment',async({page,hasTouch})=>{
 const press=async(control:ReturnType<typeof page.getByRole>)=>{
  if(hasTouch){await control.scrollIntoViewIfNeeded();await control.tap();}
  else await control.click();
 };
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('outline');
 const coordinates=sketch.getByLabel('Outline points X, Y (mm)');
 await coordinates.fill('0, 0\n10, 0, 0.2\n20, 10\n20, 20\n0, 20');
 await coordinates.blur();
 await press(sketch.getByText('Outline constraints',{exact:true}));
 await sketch.getByLabel('Constraint',{exact:true}).selectOption('tangent');
 await sketch.getByLabel('Constrained segment').selectOption('1');
 const other=sketch.getByLabel('Second segment'),status=sketch.getByRole('status',{name:'Outline constraint status'});
 const add=sketch.getByRole('button',{name:'Add constraint',exact:true});
 await other.selectOption('3');
 await press(add);
 await expect(status).toContainText('adjoining straight segment');
 await other.selectOption('0');
 await press(add);
 await press(sketch.getByRole('button',{name:'Solve outline',exact:true}));
 await expect(status).toContainText('Outline solved');
 const solved=await coordinates.inputValue();
 const bulge=Number(solved.split('\n')[1].split(',')[2]);
 expect(sketchBulgeArc([10,0],[20,10],bulge)?.radius).toBeCloseTo(10,9);
 await press(sketch.getByRole('button',{name:'Create extrusion',exact:true}));
 await expect(sketch).toBeHidden();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await expect(coordinates).toHaveValue(solved);
 await expect(sketch.getByRole('button',{name:'Edit constraint 1',exact:true})).toBeVisible();
});

test('retains a directed tangent join between adjoining arcs',async({page,hasTouch})=>{
 const press=async(control:ReturnType<typeof page.getByRole>)=>{
  if(hasTouch){await control.scrollIntoViewIfNeeded();await control.tap();}
  else await control.click();
 };
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('outline');
 const coordinates=sketch.getByLabel('Outline points X, Y (mm)');
 await coordinates.fill('0, 0\n10, 0, 0.16\n16, 2, 0.15\n20, 10\n20, 20\n0, 20');
 await coordinates.blur();
 await press(sketch.getByText('Outline constraints',{exact:true}));
 await sketch.getByLabel('Constraint',{exact:true}).selectOption('arc-tangent');
 await sketch.getByLabel('Constrained segment').selectOption('2');
 const other=sketch.getByLabel('Second segment'),status=sketch.getByRole('status',{name:'Outline constraint status'});
 const add=sketch.getByRole('button',{name:'Add constraint',exact:true});
 await other.selectOption('3');
 await press(add);
 await expect(status).toContainText('adjoining arc');
 await other.selectOption('1');
 await press(add);
 await press(sketch.getByRole('button',{name:'Solve outline',exact:true}));
 await expect(status).toContainText('Outline solved');
 const solved=await coordinates.inputValue(),rows=solved.split('\n').map(row=>row.split(',').map(Number));
 expect(rows[1][2]).toEqual(.16);
 const a=sketchBulgeArc([10,0],[16,2],rows[1][2])!,b=sketchBulgeArc([16,2],[20,10],rows[2][2])!;
 expect(a.start+a.sweep).toBeCloseTo(b.start,10);
 await press(sketch.getByRole('button',{name:'Create extrusion',exact:true}));
 await expect(sketch).toBeHidden();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await expect(coordinates).toHaveValue(solved);
 await press(sketch.getByRole('button',{name:'Edit constraint 1',exact:true}));
 await expect(sketch.getByLabel('Constraint',{exact:true})).toHaveValue('arc-tangent');
 await expect(other).toHaveValue('1');
});

test('edits and retains independent constraints on a region boundary and a cutout',async({page,hasTouch})=>{
 const press=async(control:ReturnType<typeof page.getByRole>)=>{
  if(hasTouch){await control.scrollIntoViewIfNeeded();await control.tap();}
  else await control.click();
 };
 const fill=async(control:ReturnType<typeof page.getByLabel>,value:string)=>{
  await control.fill(value);
  await control.blur();
 };
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('region');
 const rows=sketch.getByLabel('Region loops (mm)');
 await fill(rows,'0, 0 | 50, 0 | 50, 40 | 0, 40\n10, 10 | 20, 10 | 20, 20 | 10, 20');
 await press(sketch.getByText('Region loop constraints',{exact:true}));
 const picker=sketch.getByLabel('Constrained loop',{exact:true});
 const addLength=async(expression:string)=>{
  await press(sketch.locator('summary:visible').filter({hasText:/^Outline constraints$/}));
  await sketch.getByRole('combobox',{name:'Constraint',exact:true}).selectOption('length');
  await fill(sketch.getByRole('textbox',{name:'Segment length (mm)',exact:true}),expression);
  await press(sketch.getByRole('button',{name:'Add constraint',exact:true}));
  await press(sketch.getByRole('button',{name:'Solve outline',exact:true}));
  await expect(sketch.getByRole('status',{name:'Outline constraint status'})).toContainText('Outline solved');
 };
 await addLength('50');
 await picker.selectOption({label:'Outline loop 2'});
 await addLength('15');
 const solved=await rows.inputValue();
 expect(Number(solved.split('\n')[1].split('|')[1].split(',')[0])).toBeCloseTo(25,5);
 await fill(rows,solved+'\nCIRCLE 35, 20, 2');
 await expect(sketch.getByRole('status',{name:'Region constraint status'})).toContainText('Restore the original region loops');
 const create=sketch.getByRole('button',{name:'Create extrusion',exact:true});
 await press(create);
 await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('Restore the original region loops');
 await fill(rows,solved);
 await press(create);
 await expect(sketch).toBeHidden();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await expect(rows).toHaveValue(solved);
 await press(sketch.getByRole('button',{name:'Edit constraint 1',exact:true}));
 await expect(sketch.getByRole('textbox',{name:'Segment length (mm)',exact:true})).toHaveValue('50');
 await picker.selectOption({label:'Outline loop 2'});
 await press(sketch.getByRole('button',{name:'Edit constraint 1',exact:true}));
 await expect(sketch.getByRole('textbox',{name:'Segment length (mm)',exact:true})).toHaveValue('15');
});

test('positions a cutout from the first vertex of its reference loop and rolls back a collision',async({page,hasTouch})=>{
 const press=async(control:ReturnType<typeof page.getByRole>)=>{
  if(hasTouch){await control.scrollIntoViewIfNeeded();await control.tap();}
  else await control.click();
 };
 const fill=async(control:ReturnType<typeof page.getByLabel>,value:string)=>{
  await control.fill(value);
  await control.blur();
 };
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('region');
 const rows=sketch.getByLabel('Region loops (mm)');
 await fill(rows,'0, 0 | 60, 0 | 60, 40 | 0, 40\n10, 10 | 18, 10 | 18, 18 | 10, 18');
 await press(sketch.getByText('Region loop positions',{exact:true}));
 await sketch.getByLabel('Reference loop',{exact:true}).selectOption({label:'Outline loop 1'});
 await sketch.getByLabel('Positioned loop',{exact:true}).selectOption({label:'Outline loop 2'});
 const offset=sketch.getByLabel('X offset (mm)',{exact:true});
 await fill(offset,'25');
 await press(sketch.getByRole('button',{name:'Add loop position',exact:true}));
 const positioned='0, 0 | 60, 0 | 60, 40 | 0, 40\n25, 10 | 33, 10 | 33, 18 | 25, 18';
 await expect(rows).toHaveValue(positioned);
 const editPosition=sketch.getByRole('button',{name:'Edit loop position 1',exact:true});
 await press(editPosition);
 await fill(offset,'55');
 await press(sketch.getByRole('button',{name:'Update loop position',exact:true}));
 await expect(sketch.getByRole('status',{name:'Region position status'})).toContainText('separate holes');
 await expect(rows).toHaveValue(positioned);
 await press(sketch.getByRole('button',{name:'Create extrusion',exact:true}));
 await expect(sketch).toBeHidden();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await expect(rows).toHaveValue(positioned);
 await press(editPosition);
 await expect(offset).toHaveValue('25');
 await expect(sketch.getByLabel('Y offset (mm)',{exact:true})).toHaveValue('10');
});

test('positions both loops by selected edge midpoints and reopens the same references',async({page,hasTouch})=>{
 const press=async(control:ReturnType<typeof page.getByRole>)=>{
  if(hasTouch){await control.scrollIntoViewIfNeeded();await control.tap();}
  else await control.click();
 };
 const fill=async(control:ReturnType<typeof page.getByLabel>,value:string)=>{
  await control.fill(value);
  await control.blur();
 };
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('region');
 const rows=sketch.getByLabel('Region loops (mm)');
 await fill(rows,'0, 0 | 60, 0 | 60, 40 | 0, 40\n10, 10 | 18, 10 | 18, 18 | 10, 18');
 await press(sketch.getByText('Region loop positions',{exact:true}));
 await sketch.getByLabel('Reference loop',{exact:true}).selectOption({label:'Outline loop 1'});
 await sketch.getByLabel('Positioned loop',{exact:true}).selectOption({label:'Outline loop 2'});
 const reference=sketch.getByLabel('Reference anchor',{exact:true}),target=sketch.getByLabel('Positioned anchor',{exact:true});
 await reference.selectOption({label:'Edge 1 midpoint'});
 await target.selectOption({label:'Edge 4 midpoint'});
 await fill(sketch.getByLabel('X offset (mm)',{exact:true}),'-5');
 await press(sketch.getByRole('button',{name:'Add loop position',exact:true}));
 const positioned='0, 0 | 60, 0 | 60, 40 | 0, 40\n25, 10 | 33, 10 | 33, 18 | 25, 18';
 await expect(rows).toHaveValue(positioned);
 await fill(rows,positioned.replace('25, 18','25, 18 | 24, 14'));
 await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('missing edge');
 await fill(rows,positioned);
 await press(sketch.getByRole('button',{name:'Create extrusion',exact:true}));
 await expect(sketch).toBeHidden();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await press(sketch.getByRole('button',{name:'Edit loop position 1',exact:true}));
 await expect(reference.locator('option:checked')).toHaveText('Edge 1 midpoint');
 await expect(target.locator('option:checked')).toHaveText('Edge 4 midpoint');
 await expect(rows).toHaveValue(positioned);
});

test('matches edges on separate region loops and re-solves when the reference changes',async({page,hasTouch})=>{
 const press=async(control:ReturnType<typeof page.getByRole>)=>{
  if(hasTouch){await control.scrollIntoViewIfNeeded();await control.tap();}
  else await control.click();
 };
 const fill=async(control:ReturnType<typeof page.getByLabel>,value:string)=>{
  await control.fill(value);
  await control.blur();
 };
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await press(page.getByRole('button',{name:'Sketch',exact:true}));
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('region');
 const rows=sketch.getByLabel('Region loops (mm)');
 await fill(rows,'0, 0 | 75, 0 | 75, 40 | 0, 40\n10, 10 | 22, 10 | 22, 20 | 10, 20\n40, 10 | 48, 10 | 48, 20 | 40, 20');
 await press(sketch.getByText('Region edge matches',{exact:true}));
 await sketch.getByLabel('Edge reference loop',{exact:true}).selectOption({label:'Outline loop 2'});
 await sketch.getByLabel('Edge target loop',{exact:true}).selectOption({label:'Outline loop 3'});
 await press(sketch.getByRole('button',{name:'Add edge length match',exact:true}));
 const status=sketch.getByRole('status',{name:'Region edge match status'});
 await expect(status).toContainText('Region edge matches solved');
 const measured=async()=>{
  const [a,b]=(await rows.inputValue()).split('\n')[2].split('|').map(row=>row.split(',').map(Number));
  return Math.hypot(b[0]-a[0],b[1]-a[1]);
 };
 expect(await measured()).toBeCloseTo(12);
 const handle=(loop:number)=>sketch.locator(`[data-resize="vertex"][data-loop="${loop}"][data-vertex="1"]`);
 const sketchStatus=sketch.getByRole('status',{name:'Sketch status'});
 const beforeDrag=await rows.inputValue();
 await startDrag(page,handle(1),2,0);
 await expect(rows).toHaveValue(beforeDrag);
 await page.mouse.up();
 await expect(sketchStatus).toContainText('Outline solved');
 expect(await measured()).toBeCloseTo(14);
 const solvedDrag=await rows.inputValue();
 await startDrag(page,handle(1),0,-12);
 await page.mouse.up();
 await expect(sketchStatus).toContainText('A region needs one outside boundary');
 await expect(rows).toHaveValue(solvedDrag);
 await startDrag(page,handle(2),0,3);
 await page.mouse.up();
 await expect(sketchStatus).toContainText('Outline solved');
 expect(await measured()).toBeCloseTo(14);
 expect((await rows.inputValue()).split('\n')[1]).toBe(solvedDrag.split('\n')[1]);
 await fill(rows,(await rows.inputValue()).replace('24, 10','26, 10'));
 const create=sketch.getByRole('button',{name:'Create extrusion',exact:true});
 await press(create);
 await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('Solve region edge matches before saving');
 await press(sketch.getByRole('button',{name:'Solve region edge matches',exact:true}));
 await expect(status).toContainText('Region edge matches solved');
 expect(await measured()).toBeCloseTo(16);
 await press(create);
 await expect(sketch).toBeHidden();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});
 if(!await edit.isVisible())await press(page.getByRole('button',{name:'Properties',exact:true}));
 await press(edit);
 await expect(sketch.getByRole('button',{name:'Remove edge match 1',exact:true})).toBeVisible();
 expect(await measured()).toBeCloseTo(16);
});

test('drags a constrained outline vertex in the draft and keeps dimensions on Apply',async({page})=>{
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await page.getByRole('button',{name:'Sketch',exact:true}).click();
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByLabel('Profile',{exact:true}).selectOption('outline');
 const coordinates=sketch.getByLabel('Outline points X, Y (mm)');
 const initial='0, 0\n40, 0\n40, 20\n0, 20';
 await coordinates.fill(initial);
 await sketch.getByText('Outline constraints',{exact:true}).click();
 const kind=sketch.getByLabel('Constraint',{exact:true}),edge=sketch.getByLabel('Constrained segment');
 const add=sketch.getByRole('button',{name:'Add constraint',exact:true});
 await kind.selectOption('horizontal');
 await edge.selectOption('0');
 await add.click();
 await kind.selectOption('length');
 await edge.selectOption('0');
 await sketch.getByLabel('Segment length (mm)').fill('40');
 await add.click();
 await kind.selectOption('vertical');
 await edge.selectOption('1');
 await add.click();
 await sketch.getByText('Outline constraints',{exact:true}).click();

 const first=sketch.locator('[data-resize="vertex"][data-vertex="0"]');
 const vertex=sketch.locator('[data-resize="vertex"][data-vertex="2"]');
 await expect(first).toHaveCount(0);
 const preview=sketch.locator('.sketch-preview');
 await preview.evaluate(node=>node.addEventListener('pointerdown',event=>{
  (node as HTMLElement).dataset.testPointerId=String((event as PointerEvent).pointerId);
 },{once:true}));
 await startDrag(page,vertex,8,6);
 await expect(coordinates).toHaveValue(initial);
 await expect(sketch.locator('.sketch-snap-marker')).toHaveCount(1);
 await preview.dispatchEvent('pointercancel',{pointerId:Number(await preview.getAttribute('data-test-pointer-id'))});
 await page.mouse.up();
 await expect(sketch.locator('.sketch-snap-marker')).toHaveCount(0);
 await expect(coordinates).toHaveValue(initial);

 await startDrag(page,vertex,8,6);
 await page.mouse.up();
 await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('Outline solved');
 const solved=(await coordinates.inputValue()).split('\n').map(row=>row.split(',').map(Number));
 expect(solved[0]).toEqual([0,0]);
 expect(solved[1][0]).toBeCloseTo(40,6);
 expect(solved[1][1]).toBeCloseTo(0,6);
 expect(solved[2][0]).toBeCloseTo(40,6);
 expect(solved[2][1]).toBeCloseTo(26,0);
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 await sketch.getByRole('button',{name:'Create extrusion',exact:true}).click();
 await expect(sketch).toBeHidden();
 await expect(page.getByTestId('object-name')).toHaveCount(1);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByTestId('object-name')).toHaveCount(0);
});
