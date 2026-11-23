// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const payload=(units:number)=>Buffer.from([
 '0','SECTION','2','HEADER','9','$INSUNITS','70',units,'0','ENDSEC',
 '0','SECTION','2','TABLES','0','TABLE','2','LTYPE',
 '0','LTYPE','2','Guide dash','73',2,'49',.5,'74',0,'49',-.25,'74',0,'0','ENDTAB',
 '0','TABLE','2','LAYER','0','LAYER','2','Guides','62',-5,'6','Guide dash','370',25,'290',0,'0','ENDTAB','0','ENDSEC',
 '0','SECTION','2','ENTITIES',
 '0','LWPOLYLINE','8','Guides','90',3,'70',0,'10',0,'20',0,'10',1,'20',0,'42',-.5,'10',1,'20',2,
 '0','LINE','8','Construction','10',3,'20',5,'11',6,'21',7,
 '0','ENDSEC','0','EOF'
].join('\n'));

test('import an inch DXF as an open guide, export mm and reimport the signed arc',async({page,hasTouch})=>{
 const press=(control:ReturnType<typeof page.getByRole>)=>hasTouch?control.tap():control.click();
 await page.goto('/');
 await expect(page.locator('#cad-root')).toHaveAttribute('data-state','ready');
 const open=page.getByRole('button',{name:'Sketch path',exact:true});
 await press(open);
 const path=page.getByRole('dialog',{name:'Sketch path',exact:true});
 const points=path.getByLabel('Path points X, Y (mm)');
 const before=await points.inputValue();
 await press(path.getByText('DXF path',{exact:true}));
 const file=path.getByLabel('Choose DXF file');
 await file.setInputFiles({name:'unitless guide.dxf',mimeType:'application/dxf',buffer:payload(0)});
 const layers=path.getByRole('group',{name:'DXF layers',exact:true});
 const importLayers=path.getByRole('button',{name:'Import selected layers',exact:true});
 await press(layers.getByRole('checkbox',{name:'Construction',exact:true}));
 await press(importLayers);
 await expect(path.getByRole('status',{name:'Sketch status'})).toContainText('has no units');
 await expect(points).toHaveValue(before);
 await press(path.getByRole('checkbox',{name:'Assume millimetres if the file has no units',exact:true}));
 await press(importLayers);
 await expect(points).toHaveValue('0, 0\n1, 0, -0.5\n1, 2');

 await file.setInputFiles({name:'inch guide.dxf',mimeType:'application/dxf',buffer:payload(1)});
 await expect(layers.getByRole('checkbox',{name:'Construction',exact:true})).toBeChecked();
 await press(layers.getByRole('checkbox',{name:'Construction',exact:true}));
 await press(importLayers);
 const scaled='0, 0\n25.4, 0, -0.5\n25.4, 50.8';
 await expect(points).toHaveValue(scaled);
 await expect(path.getByText('DXF layer: Guides',{exact:true})).toBeVisible();
 const [download]=await Promise.all([
  page.waitForEvent('download'),press(path.getByRole('button',{name:'Export path as DXF'}))
 ]);
 const exportPath=await download.path();
 if(!exportPath)throw Error('Expected to download a DXF');
 const text=await readFile(exportPath,'utf8');
 expect(text).toContain('$INSUNITS\r\n70\r\n4');
 expect(text).toContain('90\r\n3\r\n70\r\n0');
 expect(text).toContain('42\r\n-0.5');
 expect(text).toContain('62\r\n-5\r\n6\r\nGuide dash\r\n290\r\n0\r\n370\r\n25');
 expect(text).toContain('49\r\n12.7\r\n74\r\n0\r\n49\r\n-6.35');
 expect(text).not.toContain('Construction');
 await file.setInputFiles({name:'round trip.dxf',mimeType:'application/dxf',buffer:Buffer.from(text)});
 await expect(path.getByLabel('Sketch name')).toHaveValue('round trip');
 await expect(points).toHaveValue(scaled);
 await press(path.getByRole('button',{name:'Save path',exact:true}));
 await expect(path).toBeHidden();
 await expect(page.getByTestId('object-name')).toHaveCount(0);
 await press(page.getByRole('button',{name:'Sketch path: round trip',exact:true}));
 await press(path.getByText('DXF path',{exact:true}));
 await expect(path.getByText('DXF layer: Guides',{exact:true})).toBeVisible();
});
