// SPDX-License-Identifier: BSD-3-Clause
import {expect,test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const payload=(units:number)=>Buffer.from([
 '0','SECTION','2','HEADER','9','$INSUNITS','70',units,'0','ENDSEC','0','SECTION','2','ENTITIES',
 '0','LWPOLYLINE','8','Guides','90',3,'70',0,'10',0,'20',0,'10',1,'20',0,'42',-.5,'10',1,'20',2,
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
 await file.setInputFiles({name:'inch guide.dxf',mimeType:'application/dxf',buffer:payload(0)});
 await expect(path.getByRole('status',{name:'Sketch status'})).toContainText('has no units');
 await expect(points).toHaveValue(before);

 await file.setInputFiles({name:'inch guide.dxf',mimeType:'application/dxf',buffer:payload(1)});
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
