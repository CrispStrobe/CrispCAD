// @vitest-environment happy-dom
// SPDX-License-Identifier: BSD-3-Clause
// Shape library thumbnails are drawn on the page's thread. A card that a search has replaced must
// say it is no longer wanted, so the editor skips its thumbnail: in BrickWright's SDK check a
// search for "Box" followed by "Add Box" waited 15-40 s behind thumbnails of the essentials the
// search had just removed.
import {afterEach,expect,it,vi} from 'vitest';
import type {ShapePreset} from '../packages/editor/src/shapes.js';

vi.mock('../packages/editor/src/shapes.js',async importOriginal=>({...await importOriginal<typeof import('../packages/editor/src/shapes.js')>(),presetPreview:()=>'data:image/png;base64,',evaluatedPreview:()=>'data:image/png;base64,'}));
const {mountShapePicker}=await import('../packages/editor/src/shape-picker.js');

// Every observed card is on screen at once.
class ShowAll {constructor(private readonly callback:(entries:{isIntersecting:boolean;target:Element}[])=>void){} observe(target:Element){queueMicrotask(()=>this.callback([{isIntersecting:true,target}]));} unobserve(){} disconnect(){}}
afterEach(()=>{document.body.replaceChildren();vi.unstubAllGlobals();});

it('asks for thumbnails with a test that turns false once the card is replaced or the library closes',async()=>{
 vi.stubGlobal('IntersectionObserver',ShowAll);
 const parent=document.createElement('div'),trigger=document.createElement('button');document.body.append(parent,trigger);
 const asked=new Map<string,()=>boolean>();
 const picker=mountShapePicker(parent,trigger,async()=>{},()=>{},(preset:ShapePreset,wanted:()=>boolean)=>{asked.set(preset.id,wanted);return new Promise<string>(()=>{});});
 picker.open(false);await new Promise(resolve=>setTimeout(resolve,0));
 const essentials=[...asked.keys()];
 expect(essentials.length).toBeGreaterThan(5);
 expect(essentials.every(id=>asked.get(id)!())).toBe(true);
 const search=parent.querySelector<HTMLInputElement>('input[type=search],input[aria-label="Search shapes"]')!;
 const before=new Map(asked);asked.clear();
 search.value='Box';search.dispatchEvent(new Event('input'));await new Promise(resolve=>setTimeout(resolve,0));
 // Every card the search replaced no longer wants its thumbnail (also those it shows again: they
 // are new cards with their own requests).
 expect(asked.has('box')).toBe(true);
 for(const id of essentials)expect(before.get(id)!(),id).toBe(false);
 expect(essentials.filter(id=>!asked.has(id)).length).toBeGreaterThan(5);
 // The new Box card wants its thumbnail until the library closes.
 expect(asked.get('box')!()).toBe(true);
 picker.toggle();
 expect(asked.get('box')!()).toBe(false);
 picker.dispose();
});
