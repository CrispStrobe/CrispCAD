import {expect,test} from '@playwright/test';
import {clickTool} from './ui.js';
test('sketch dimensions, extrusion inputs and formulas remain editable after reopening',async({page})=>{
 await page.goto('/');const editor=page.locator('#cad-root');const ready=()=>expect(editor).toHaveAttribute('data-state','ready');await ready();
 await page.getByRole('button',{name:'Parameters',exact:true}).click();const parameters=page.getByRole('dialog',{name:'Model parameters',exact:true});await parameters.getByRole('button',{name:'Add parameter',exact:true}).click();await parameters.getByLabel('Parameter name',{exact:true}).fill('width');await parameters.getByLabel('Parameter expression',{exact:true}).fill('40');await parameters.getByRole('button',{name:'Apply parameters',exact:true}).click();await parameters.getByRole('button',{name:'Close parameters',exact:true}).click();
 await page.getByRole('button',{name:'Sketch',exact:true}).click();const sketch=page.getByRole('dialog',{name:'Sketch and extrusion',exact:true});await expect(sketch).toBeVisible();await sketch.getByLabel('Sketch name',{exact:true}).fill('Mounting plate');await sketch.getByLabel('Sketch width (mm)',{exact:true}).fill('width');await sketch.getByLabel('Sketch depth (mm)',{exact:true}).fill('width / 2');await sketch.getByLabel('Extrusion distance (mm)',{exact:true}).fill('width / 8');await expect(sketch.getByLabel('Sketch preview',{exact:true})).toContainText('40 × 20 mm');await sketch.getByRole('button',{name:'Create extrusion',exact:true}).click();await expect(sketch).not.toBeVisible();await ready();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});if(!await edit.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();await edit.click();await sketch.getByLabel('Sketch depth (mm)',{exact:true}).fill('-10');await expect(sketch.getByRole('button',{name:'Apply sketch changes',exact:true})).toBeDisabled();await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('Dimension');await expect(sketch).toBeVisible();await sketch.getByLabel('Sketch depth (mm)',{exact:true}).fill('width / 2');await sketch.getByLabel('Extrusion distance (mm)',{exact:true}).fill('8');await sketch.getByRole('button',{name:'Apply sketch changes',exact:true}).click();await ready();await page.getByRole('button',{name:'Undo',exact:true}).click();await ready();
 await page.reload();await ready();await page.getByTestId('object-name').click();if(!await edit.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();await edit.click();await expect(sketch.getByLabel('Extrusion distance (mm)',{exact:true})).toHaveValue('width / 8');await sketch.getByRole('button',{name:'Close sketch',exact:true}).click();
 await page.getByRole('button',{name:'Parameters',exact:true}).click();await parameters.getByLabel('Parameter expression',{exact:true}).fill('60');await parameters.getByRole('button',{name:'Apply parameters',exact:true}).click();await ready();await parameters.getByText('Feature dependencies',{exact:true}).click();await expect(parameters.locator('.design-dependencies')).toContainText('Mounting plate ← width');await parameters.getByRole('button',{name:'Close parameters',exact:true}).click();await edit.click();await expect(sketch.getByLabel('Sketch preview',{exact:true})).toContainText('60 × 30 mm');await page.screenshot({path:`test-results/sketch-${test.info().project.name}.png`,fullPage:true});await sketch.getByRole('button',{name:'Close sketch',exact:true}).click();
});
test('circle extrusion can be created on a side plane and deleted immediately from Objects',async({page})=>{
 await page.goto('/');const editor=page.locator('#cad-root');await expect(editor).toHaveAttribute('data-state','ready');await page.getByRole('button',{name:'Sketch',exact:true}).click();const sketch=page.getByRole('dialog',{name:'Sketch and extrusion',exact:true});await sketch.getByLabel('Profile',{exact:true}).selectOption('circle');await sketch.getByLabel('Sketch plane',{exact:true}).selectOption('YZ');await sketch.getByLabel('Sketch radius (mm)',{exact:true}).fill('12');await sketch.getByLabel('Symmetric extrusion',{exact:true}).check();await sketch.getByRole('button',{name:'Create extrusion',exact:true}).click();await expect(sketch).not.toBeVisible();await expect(editor).toHaveAttribute('data-state','ready');const objects=page.locator('.tree');if(!await objects.isVisible())await page.getByRole('button',{name:'Objects',exact:true}).click();await page.getByTestId('object-name').click();await page.keyboard.press('Backspace');await expect(page.getByTestId('object-name')).toHaveCount(0);await expect(editor).toHaveAttribute('data-state','ready');await page.getByRole('button',{name:'Undo',exact:true}).click();await expect(page.getByTestId('object-name')).toHaveCount(1);
});

test('sketch help, field errors and a real-size DXF are available in the editor',async({page},testInfo)=>{
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await page.getByRole('button',{name:'Sketch',exact:true}).click();
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 const info=sketch.getByRole('button',{name:'About sketching and extrusion'});
 await info.click();
 await expect(info).toHaveAttribute('aria-expanded','true');
 await expect(sketch.getByText('Extrusion adds thickness', {exact:false})).toBeVisible();
 await info.click();
 const width=sketch.getByLabel('Sketch width (mm)',{exact:true});
 await width.fill('0');
 await expect(width).toHaveAttribute('aria-invalid','true');
 await expect(sketch.getByRole('status')).toContainText('Sketch width (mm)');
 await width.fill('42');
 await sketch.getByRole('button',{name:'Create extrusion',exact:true}).click();
 await expect(sketch).not.toBeVisible();
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const exportButton=page.getByRole('button',{name:'Export sketch as DXF',exact:true});
 if(!await exportButton.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();
 const [download]=await Promise.all([page.waitForEvent('download'),exportButton.click()]);
 await download.saveAs(testInfo.outputPath('rectangle.dxf'));
 const {readFile}=await import('node:fs/promises');
 const dxf=await readFile(testInfo.outputPath('rectangle.dxf'),'utf8');
 expect(dxf).toContain('$INSUNITS\r\n70\r\n4');
 expect(dxf).toContain('LWPOLYLINE');
 expect(dxf).toContain('10\r\n-21\r\n20\r\n-15');
 expect(dxf).toContain('10\r\n21\r\n20\r\n15');
});

test('DXF import previews an editable outline and commits it only on Create',async({page})=>{
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await page.getByRole('button',{name:'Sketch',exact:true}).click();
 const sketch=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await sketch.getByText('Import DXF or DWG outline',{exact:true}).click();
 const text=['0','SECTION','2','HEADER','9','$INSUNITS','70',1,'0','ENDSEC','0','SECTION','2','ENTITIES',
  '0','LWPOLYLINE','90',4,'70',1,'10',1,'20',1,'10',2,'20',1,'10',2,'20',2,'10',1,'20',2,
  '0','ENDSEC','0','EOF'].join('\n');
 const file=sketch.getByLabel('Choose DXF file',{exact:true});
 await file.setInputFiles({name:'invalid.dxf',mimeType:'application/dxf',buffer:Buffer.from('not a DXF')});
 await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('not a supported text DXF');
 await expect(sketch.getByRole('button',{name:'Create extrusion',exact:true})).toBeDisabled();
 await expect(sketch.getByLabel('Profile',{exact:true})).toHaveValue('rectangle');

 const paperOnly=text.replace('0\nLWPOLYLINE\n','0\nLWPOLYLINE\n67\n1\n');
 await file.setInputFiles({name:'paper-only.dxf',mimeType:'application/dxf',buffer:Buffer.from(paperOnly)});
 await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('no model-space entities');
 await expect(sketch.getByLabel('Profile',{exact:true})).toHaveValue('rectangle');

 await file.setInputFiles({name:'plate.dxf',mimeType:'application/dxf',buffer:Buffer.from(text)});
 await expect(sketch.getByLabel('Profile',{exact:true})).toHaveValue('outline');
 const points=sketch.getByLabel('Outline points X, Y (mm)',{exact:true});
 await expect(points).toHaveValue('25.4, 25.4\n50.8, 25.4\n50.8, 50.8\n25.4, 50.8');
 await expect(sketch.getByLabel('Sketch preview',{exact:true})).toContainText('25.4 × 25.4 mm');
 await points.fill('0, 0\n38, 0\n30, 20\n0, 20');
 await sketch.getByRole('button',{name:'Create extrusion',exact:true}).click();
 await expect(sketch).not.toBeVisible();
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});
 if(!await edit.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();
 await edit.click();
 await expect(points).toHaveValue('0, 0\n38, 0\n30, 20\n0, 20');
 await sketch.getByRole('button',{name:'Close sketch',exact:true}).click();
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByTestId('object-name')).toHaveCount(0);
});

test('DXF plate previews two open mounting holes and retains their edited dimensions', async ({page,hasTouch}) => {
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 const editor = page.locator('#cad-root');
 await expect(editor).toHaveAttribute('data-state', 'ready');
 await page.getByRole('button', {name: 'Sketch', exact: true}).click();
 const sketch = page.getByRole('dialog', {name: 'Sketch and extrusion'});
 await sketch.getByText('Import DXF or DWG outline', {exact: true}).click();
 const text = ['0','SECTION','2','HEADER','9','$INSUNITS','70',4,'0','ENDSEC',
  '0','SECTION','2','TABLES','0','TABLE','2','LAYER',
  '0','LAYER','2','Outline','70',4,'62',5,'420',16711935,'370',35,
  '0','LAYER','2','Bores','70',0,'62',1,'290',0,
  '0','ENDTAB','0','ENDSEC','0','SECTION','2','ENTITIES',
  '0','CIRCLE','8','Bores','10',10,'20',15,'40',2,'30',10,'210',0,'220',.6,'230',.8,
  '0','LWPOLYLINE','8','Outline','90',4,'70',1,'43',1.5,'10',0,'20',0,'10',40,'20',0,'10',40,'20',30,'10',0,'20',30,'38',10,'210',0,'220',.6,'230',.8,
  '0','CIRCLE','8','Bores','10',30,'20',15,'40',3,'30',10,'210',0,'220',.6,'230',.8,
  '0','TEXT','8','Notes','1','Fixture labels',
  '0','CIRCLE','8','Bores','67',1,'10',100,'20',120,'40',15,
  '0','TEXT','8','Paper details','410','Sheet 1','1','Sheet notes',
  '0','ENDSEC','0','EOF'].join('\n');
 await sketch.getByLabel('Choose DXF file').setInputFiles({name: 'Motor plate.dxf', mimeType: 'application/dxf', buffer: Buffer.from(text)});
 const layers=sketch.getByRole('group',{name:'DXF layers',exact:true});
 const importLayers=sketch.getByRole('button',{name:'Import selected layers',exact:true});
 await expect(layers).toBeVisible();
 await expect(sketch.getByText('Paper-space layout entities were skipped.',{exact:true})).toBeVisible();
 await expect(layers.getByRole('checkbox',{name:'Paper details',exact:true})).toHaveCount(0);
 await expect(sketch.getByLabel('Profile',{exact:true})).toHaveValue('rectangle');
 await press(importLayers);
 await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('Exclude layers');
 await press(layers.getByRole('button',{name:'Deselect all layers',exact:true}));
 await expect(importLayers).toBeDisabled();
 await press(layers.getByRole('checkbox',{name:'Bores',exact:true}));
 await press(layers.getByRole('checkbox',{name:'Outline',exact:true}));
 await press(importLayers);
 await expect(sketch.getByText('The source plane was unfolded into the selected sketch plane at actual size.',{exact:true})).toBeVisible();
 const loops = sketch.getByLabel('Region loops (mm)');
 await expect(loops).toHaveValue(/CIRCLE 10, 15, 2[\s\S]*CIRCLE 30, 15, 3/);
 await expect(sketch.locator('.sketch-top')).toHaveAttribute('d', /^M .* Z M .* Z M .* Z$/);
 const initial = await loops.inputValue();
 expect(initial).toContain('40, 30, 0, 1.5, 1.5');
 const apply = sketch.getByRole('button', {name: 'Create extrusion', exact: true});
 await loops.fill(initial.replace('CIRCLE 10, 15, 2', 'CIRCLE 0, 15, 4'));
 await expect(apply).toBeDisabled();
 await expect(sketch.getByRole('status', {name: 'Sketch status'})).toContainText('separate holes');
 const edited = initial.replace('CIRCLE 10, 15, 2', 'CIRCLE 10, 15, 4');
 await loops.fill(edited);
 await apply.click();
 await expect(sketch).toBeHidden();
 await expect(editor).toHaveAttribute('data-state', 'ready');
 const edit = page.getByRole('button', {name: 'Edit sketch & extrusion', exact: true});
 if (!await edit.isVisible()) await page.getByRole('button', {name: 'Properties', exact: true}).click();
 await edit.click();
 await expect(loops).toHaveValue(edited);
 await sketch.getByRole('button', {name: 'Close sketch', exact: true}).click();
 await page.getByRole('button', {name: 'Undo', exact: true}).click();
 await expect(page.getByTestId('object-name')).toHaveCount(0);
});

test('DXF and the 1:1 PDF follow the driving spacing of the mounting holes', async ({page}) => {
 await page.goto('/');
 const ready = () => expect(page.locator('#cad-root')).toHaveAttribute('data-state', 'ready');
 await ready();
 const openParameters = page.getByRole('button', {name: 'Parameters', exact: true});
 const parameters = page.getByRole('dialog', {name: 'Model parameters'});
 const applyParameters = parameters.getByRole('button', {name: 'Apply parameters'});
 const closeParameters = parameters.getByRole('button', {name: 'Close parameters'});
 await openParameters.click();
 await parameters.getByRole('button', {name: 'Add parameter'}).click();
 await parameters.getByLabel('Parameter name', {exact: true}).fill('spacing');
 await parameters.getByLabel('Parameter expression', {exact: true}).fill('20');
 await applyParameters.click();
 await closeParameters.click();

 await page.getByRole('button', {name: 'Sketch', exact: true}).click();
 const sketch = page.getByRole('dialog', {name: 'Sketch and extrusion'});
 await sketch.getByLabel('Profile', {exact: true}).selectOption('region');
 const region = '0, 0 | 40, 0 | 40, 30 | 0, 30\nCIRCLE 20 mm - spacing / 2, 15, 2\nCIRCLE 20 mm + spacing / 2, 15, 2';
 await sketch.getByLabel('Region loops (mm)').fill(region);
 await sketch.getByRole('button', {name: 'Create extrusion'}).click();
 await expect(sketch).toBeHidden();
 await ready();

 await openParameters.click();
 await parameters.getByLabel('Parameter expression', {exact: true}).fill('28');
 await applyParameters.click();
 await ready();
 await closeParameters.click();
 const exportButton = page.getByRole('button', {name: 'Export sketch as DXF'});
 if (!await exportButton.isVisible()) await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
 const path = await download.path();
 if (!path) throw new Error('Expected a local DXF download');
 const dxf = await (await import('node:fs/promises')).readFile(path, 'utf8');
 expect(dxf).toContain('10\r\n6\r\n20\r\n15');
 expect(dxf).toContain('10\r\n34\r\n20\r\n15');
 await page.getByRole('button', {name: 'Edit sketch & extrusion'}).click();
 await expect(sketch.getByLabel('Region loops (mm)')).toHaveValue(region);
 await sketch.getByRole('button', {name: 'Close sketch'}).click();
 const [pdfDownload] = await Promise.all([
  page.waitForEvent('download'), page.getByRole('button', {name: 'Export drilling template (PDF)'}).click()
 ]);
 const pdfPath = await pdfDownload.path();
 if (!pdfPath) throw new Error('Expected a local PDF download');
 const pdf = await (await import('node:fs/promises')).readFile(pdfPath, 'utf8');
 expect(pdf).toMatch(/^%PDF-1\.6/);
 expect(pdf).toContain('15 16 m 65 16 l S');
 expect(pdf).toContain('91 142.1 m 91 144.9 l S');
 expect(pdf).toContain('119 142.1 m 119 144.9 l S');
});

test('rounded DXF outlines preserve the editable bulge through export', async ({page}) => {
 await page.goto('/');
 const editor = page.locator('#cad-root');
 await expect(editor).toHaveAttribute('data-state', 'ready');
 await page.getByRole('button', {name: 'Sketch', exact: true}).click();
 const sketch = page.getByRole('dialog', {name: 'Sketch and extrusion'});
 await sketch.getByText('Import DXF or DWG outline', {exact: true}).click();
 const text = ['0','SECTION','2','HEADER','9','$INSUNITS','70',4,'0','ENDSEC','0','SECTION','2','ENTITIES',
  '0','LWPOLYLINE','90',4,'70',1,'10',0,'20',0,'42',1,'10',40,'20',0,'10',40,'20',30,'10',0,'20',30,
  '0','ENDSEC','0','EOF'].join('\n');
 await sketch.getByLabel('Choose DXF file').setInputFiles({name: 'Rounded plate.dxf', mimeType: 'application/dxf', buffer: Buffer.from(text)});
 const points = sketch.getByLabel('Outline points X, Y (mm)');
 await expect(points).toHaveValue('0, 0, 1\n40, 0\n40, 30\n0, 30');
 await expect(sketch.getByLabel('Sketch preview')).toContainText('40 × 50 mm');
 await points.fill('0, 0, 0.5\n40, 0\n40, 30\n0, 30');
 await sketch.getByRole('button', {name: 'Create extrusion'}).click();
 await expect(sketch).toBeHidden();
 await expect(editor).toHaveAttribute('data-state', 'ready');
 const exportButton = page.getByRole('button', {name: 'Export sketch as DXF'});
 if (!await exportButton.isVisible()) await page.getByRole('button', {name: 'Properties', exact: true}).click();
 const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
 const path = await download.path();
 if (!path) throw new Error('Expected a local DXF download');
 const dxf = await (await import('node:fs/promises')).readFile(path, 'utf8');
 expect(dxf).toContain('10\r\n0\r\n20\r\n0\r\n42\r\n0.5');
});

test('outline vertex drags are snapped drafts, preserve arcs and reject a crossing', async ({page}) => {
 await page.goto('/');
 const ready = () => expect(page.locator('#cad-root')).toHaveAttribute('data-state', 'ready');
 await ready();
 await page.getByRole('button', {name: 'Sketch', exact: true}).click();
 const sketch = page.getByRole('dialog', {name: 'Sketch and extrusion'});
 await sketch.getByLabel('Profile', {exact: true}).selectOption('outline');
 const points = sketch.getByLabel('Outline points X, Y (mm)');
 await points.fill('0, 0\n@40, 0, 0.1\n@-10, 30\n0, 30');
 const point = sketch.locator('[data-resize="vertex"][data-vertex="1"]');
 const move = async (dx:number,dy:number) => {
  const [a,b]=await point.evaluate((el,[dx,dy])=>{
   const handle=el as SVGCircleElement;
   const matrix=handle.getScreenCTM()!;
   const x=handle.cx.baseVal.value,y=handle.cy.baseVal.value;
   return [[x,y],[x+dx,y-dy]].map(([x,y])=>{
    const point=new DOMPoint(x,y).matrixTransform(matrix);
    return {x:point.x,y:point.y};
   });
  },[dx,dy]);
  await page.mouse.move(a.x,a.y);
  await page.mouse.down();
  await page.mouse.move(b.x,b.y);
  await page.mouse.up();
 };
 await move(-4,5);
 const edited = '0, 0\n36, 5, 0.1\n30, 30\n0, 30';
 await expect(points).toHaveValue(edited);
 await move(-46,20);
 await expect(points).toHaveValue(edited);
 await expect(sketch.getByRole('status',{name:'Sketch status'})).toContainText('without crossings');
 await sketch.getByRole('button', {name:'Create extrusion'}).click();
 await expect(sketch).toBeHidden();
 await ready();
 const edit=page.getByRole('button',{name:'Edit sketch & extrusion',exact:true});
 if(!await edit.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();
 await edit.click();
 await expect(points).toHaveValue(edited);
 await sketch.getByRole('button',{name:'Close sketch',exact:true}).click();
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByTestId('object-name')).toHaveCount(0);
});

test('outline vertices snap to an analytic intersection between reference sketches', async ({page}) => {
 await page.goto('/');
 const ready=()=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await ready();
 const open=page.getByRole('button',{name:'Sketch',exact:true});
 const dialog=page.getByRole('dialog',{name:'Sketch and extrusion'});
 const name=dialog.getByLabel('Sketch name',{exact:true});
 const profile=dialog.getByLabel('Profile',{exact:true});
 const create=dialog.getByRole('button',{name:'Create extrusion'});
 await open.click();
 await name.fill('Rectangle guide');
 await create.click();
 await ready();
 await open.click();
 await name.fill('Circle guide');
 await profile.selectOption('circle');
 await dialog.getByLabel('Circle center X, Y (mm)',{exact:true}).fill('17.5, 15');
 await dialog.getByLabel('Sketch radius (mm)',{exact:true}).fill('5');
 await create.click();
 await ready();

 await open.click();
 await profile.selectOption('outline');
 await dialog.getByText('Sketch snap references',{exact:true}).click();
 const first=dialog.getByLabel('Reference sketch',{exact:true});
 const second=dialog.getByLabel('Second reference sketch',{exact:true});
 await first.selectOption({label:'Rectangle guide'});
 await second.selectOption({label:'Circle guide'});
 await expect(dialog.locator('.sketch-reference')).toBeVisible();
 const [start,target]=await dialog.locator('[data-resize="vertex"][data-vertex="1"]').evaluate(node=>{
  const handle=node as SVGCircleElement;
  const matrix=handle.getScreenCTM()!,x=handle.cx.baseVal.value,y=handle.cy.baseVal.value;
  return [[x,y],[x-27.2,y-15.2]].map(([x,y])=>{
   const point=new DOMPoint(x,y).matrixTransform(matrix);
   return {x:point.x,y:point.y};
  });
 });
 await page.mouse.move(start.x,start.y);
 await page.mouse.down();
 await page.mouse.move(target.x,target.y);
 await expect(dialog.locator('.sketch-snap-marker')).toBeVisible();
 await expect(dialog.locator('.sketch-snap-label')).toHaveText('Intersection');
 await page.mouse.up();
 await expect(dialog.getByLabel('Outline points X, Y (mm)')).toHaveValue('0, 0\n12.5, 15\n30, 30\n0, 30');
 await expect(page.getByTestId('object-name')).toHaveCount(2);
 await create.click();
 await ready();
 await expect(page.getByTestId('object-name')).toHaveCount(3);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByTestId('object-name')).toHaveCount(2);
});

test('curves an outline edge by dragging its midpoint and exports the signed bulge', async ({page}) => {
 await page.goto('/');
 const ready=()=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await ready();
 await page.getByRole('button',{name:'Sketch',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await dialog.getByLabel('Profile',{exact:true}).selectOption('outline');
 const points=dialog.getByLabel('Outline points X, Y (mm)');
 await expect(dialog.locator('[data-resize="curve"]')).toHaveCount(0);
 await dialog.getByRole('checkbox',{name:'Edit edge curves'}).check();
 const edge=dialog.locator('[data-resize="curve"][data-edge="0"]');
 const [start,destination]=await edge.evaluate(node=>{
  const handle=node as SVGCircleElement,x=handle.cx.baseVal.value,y=handle.cy.baseVal.value;
  const matrix=handle.getScreenCTM()!;
  return [y,y+10].map(y=>{
   const point=new DOMPoint(x,y).matrixTransform(matrix);
   return {x:point.x,y:point.y};
  });
 });
 await page.mouse.move(start.x,start.y);
 await page.mouse.down();
 await page.mouse.move(destination.x,destination.y);
 await page.mouse.up();
 await expect(points).toHaveValue('0, 0, 0.5\n40, 0\n30, 30\n0, 30');
 await dialog.getByRole('button',{name:'Create extrusion'}).click();
 await ready();
 const exportButton=page.getByRole('button',{name:'Export sketch as DXF'});
 if(!await exportButton.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();
 const [download]=await Promise.all([page.waitForEvent('download'),exportButton.click()]);
 const path=await download.path();
 if(!path)throw Error('Missing export');
 const dxf=await (await import('node:fs/promises')).readFile(path,'utf8');
 expect(dxf).toContain('10\r\n0\r\n20\r\n0\r\n42\r\n0.5');
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await expect(page.getByTestId('object-name')).toHaveCount(0);
});

test('imports a closed DXF chain of native lines and arcs as an editable outline', async ({page}) => {
 await page.goto('/');
 const ready=()=>expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 await ready();
 await page.getByRole('button',{name:'Sketch',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Sketch and extrusion'});
 await dialog.getByText('Import DXF or DWG outline',{exact:true}).click();
 const dxf=['0','SECTION','2','HEADER','9','$INSUNITS','70',4,'0','ENDSEC','0','SECTION','2','ENTITIES',
  '0','ARC','10',20,'20',0,'40',20,'50',180,'51',0,
  '0','LINE','10',0,'20',30,'11',0,'21',0,
  '0','LINE','10',0,'20',30,'11',40,'21',30,
  '0','LINE','10',40,'20',0,'11',40,'21',30,'0','ENDSEC','0','EOF'].join('\n');
 await dialog.getByLabel('Choose DXF file').setInputFiles({name:'Native arcs.dxf',mimeType:'application/dxf',buffer:Buffer.from(dxf)});
 await expect(dialog.getByLabel('Outline points X, Y (mm)')).toHaveValue('0, 0, 1\n40, 0\n40, 30\n0, 30');
 await expect(dialog.getByLabel('Sketch preview')).toContainText('40 × 50 mm');
 await dialog.getByRole('button',{name:'Create extrusion'}).click();
 await ready();
 const exportButton=page.getByRole('button',{name:'Export sketch as DXF'});
 if(!await exportButton.isVisible())await page.getByRole('button',{name:'Properties',exact:true}).click();
 const [download]=await Promise.all([page.waitForEvent('download'),exportButton.click()]);
 const path=await download.path();
 if(!path)throw Error('Missing export');
 const output=await (await import('node:fs/promises')).readFile(path,'utf8');
 expect(output).toContain('10\r\n0\r\n20\r\n0\r\n42\r\n1');
});
