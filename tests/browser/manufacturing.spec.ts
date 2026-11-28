// SPDX-License-Identifier: BSD-3-Clause
// Check for manufacturing (Phase 6.3) in the editor, by touch: File › Check for manufacturing…,
// first on the meshes (the exact kernel is not fetched), then on the exact B-rep (fetched on
// demand); a finding is tapped, marked in the 3D view and stepped through from the bar, and the
// report comes back; then suggested dogbones and the injection-moulding checks. The check reads the model and adds no history entry.
import {expect,test} from '@playwright/test';
import {CAD_SCRIPT_REVISION,createCadSession,serializeDocument} from '@brickwright/cad-core';

test('checks a milled pocket for CNC on the mesh and on the exact B-rep and marks the findings',async({page})=>{
 test.setTimeout(300_000);
 const requests:string[]=[];page.on('request',request=>requests.push(new URL(request.url()).pathname));
 const exactFetched=()=>requests.some(path=>/\/assets\/exact\/smlibwasm-[^/]+\.wasm$/.test(path));
 // A 70 × 50 × 20 block with a 40 × 30 × 10 pocket whose vertical corners are R2.5.
 const session=createCadSession();
 session.addCode({version:CAD_SCRIPT_REVISION,language:'brickwright-cad-script',source:'return subtract(box(70,50,20), extrudeProfile(11, offset2d(2.5, true, 32, rectangle2d(35,25,true))));',parameters:{}},'Pocket block');
 await page.addInitScript(document=>localStorage.setItem('brickwright-cad:standalone:v1',document),serializeDocument(session.state.document));
 await page.goto('/');
 const root=page.locator('#cad-root');
 await expect(root).toHaveAttribute('data-state','ready',{timeout:120_000});
 const iterations=await page.getByLabel('Model iteration',{exact:true}).locator('option').count();

 await page.getByLabel('File menu',{exact:true}).tap();
 await page.getByRole('button',{name:'Check for manufacturing…',exact:true}).tap();
 const dialog=page.getByRole('dialog',{name:'Check for manufacturing',exact:true});
 await expect(dialog).toBeVisible();
 await expect(dialog.getByLabel('Process',{exact:true})).toHaveValue('cnc');

 // On the meshes: corners are found as creases only, and the exact kernel stays unloaded.
 await dialog.getByRole('checkbox',{name:/Exact B-rep where available/}).uncheck();
 await dialog.getByRole('button',{name:'Run check',exact:true}).tap();
 const body=dialog.locator('.manufacturing-body').first();
 await expect(body.locator('h3 .manufacturing-source')).toHaveText('mesh',{timeout:60_000});
 await expect(body).toContainText('exact geometry not requested');
 await expect(body.locator('dd[data-check="edges.radius"]')).toHaveAttribute('data-status','not-checked');
 expect(exactFetched()).toBe(false);

 // On the exact B-rep: four corner fillets R2.5 below the R3 of a Ø6 end mill.
 await dialog.getByRole('checkbox',{name:/Exact B-rep where available/}).check();
 await dialog.getByRole('button',{name:'Run check',exact:true}).tap();
 await expect(body.locator('h3 .manufacturing-source')).toHaveText('exact B-rep',{timeout:120_000});
 expect(exactFetched()).toBe(true);
 const corners=body.locator('dd[data-check="cnc.internal-corners"]');
 await expect(corners).toHaveAttribute('data-status','fail');
 await expect(corners).toContainText('R2.5');
 await expect(corners.locator('button.manufacturing-finding')).toHaveCount(4);
 await expect(body.locator('dd[data-check="cnc.undercuts"]')).toHaveAttribute('data-status','pass');
 await expect(dialog).toContainText('smlib');

 // Tap a finding: the dialog steps aside and the faces are marked in the 3D view.
 await corners.locator('button.manufacturing-finding').first().tap();
 await expect(dialog).toBeHidden();
 const bar=page.getByRole('toolbar',{name:'Manufacturing finding'});
 await expect(bar).toBeVisible();
 await expect(bar).toContainText('1/');
 await expect(bar).toContainText('Corner fillet R2.5 below the R3 tool radius');
 const canvas=page.locator('canvas[data-finding]');
 await expect(canvas).toHaveCount(1);
 await bar.getByRole('button',{name:'Next',exact:true}).tap();
 await expect(bar).toContainText('2/');
 await bar.getByRole('button',{name:'Back to report',exact:true}).tap();
 await expect(dialog).toBeVisible();
 await expect(page.locator('canvas[data-finding]')).toHaveCount(0);

 // A Ø4 end mill reaches the corners; they are deeper than three times their radius, so it warns.
 await dialog.getByLabel('End mill diameter (mm)',{exact:true}).fill('4');
 await dialog.getByRole('button',{name:'Run check',exact:true}).tap();
 await expect(corners).toHaveAttribute('data-status','warn',{timeout:60_000});
 // Dogbones: back at Ø6 the four R2.5 corners need one each; with suggestions on, a finding marks
 // the relief hole's circles in the 3D view.
 await dialog.getByLabel('End mill diameter (mm)',{exact:true}).fill('6');
 await dialog.getByRole('checkbox',{name:'Suggest dogbones',exact:true}).tap();
 await dialog.getByRole('button',{name:'Run check',exact:true}).tap();
 const dogbones=body.locator('dd[data-check="cnc.dogbones"]');
 await expect(dogbones).toHaveAttribute('data-status','warn',{timeout:60_000});
 await expect(dogbones.locator('button.manufacturing-finding')).toHaveCount(4);
 await expect(dogbones.locator('button.manufacturing-finding').first()).toContainText('dogbone Ø6 centred at');
 await expect(body.locator('dd[data-check="cnc.pocket-depth"]')).toHaveAttribute('data-status','pass');
 await expect(body.locator('dd[data-check="cnc.pocket-depth"]')).toContainText('the deepest 10 mm');
 await dogbones.locator('button.manufacturing-finding').first().tap();
 await expect(bar).toContainText('Dogbones');
 await expect(page.locator('canvas[data-finding]')).toHaveCount(1);
 await bar.getByRole('button',{name:'Back to report',exact:true}).tap();
 // Injection moulding: the pocket's walls and the block's sides have no draft along +z.
 await dialog.getByLabel('Process',{exact:true}).selectOption('molding');
 await expect(dialog.getByLabel('Mould opens along',{exact:true})).toBeVisible();
 await dialog.getByRole('button',{name:'Run check',exact:true}).tap();
 await expect(body.locator('dd[data-check="mold.draft"]')).toHaveAttribute('data-status','fail',{timeout:60_000});
 await expect(body.locator('dd[data-check="mold.undercuts"]')).toHaveAttribute('data-status','pass');
 await expect(body.locator('dd[data-check="mold.wall-uniformity"]')).toBeVisible();
 if(process.env.MANUFACTURING_SHOT)await dialog.screenshot({path:process.env.MANUFACTURING_SHOT});
 await dialog.getByRole('button',{name:'Close',exact:true}).tap();
 await expect(dialog).toBeHidden();
 expect(await page.getByLabel('Model iteration',{exact:true}).locator('option').count()).toBe(iterations);
 await expect(root).not.toHaveAttribute('data-state','error');
});
