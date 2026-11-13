// SPDX-License-Identifier: BSD-3-Clause
import * as THREE from 'three';
import {Font} from 'three/addons/loaders/FontLoader.js';
import type {FontData} from 'three/addons/loaders/FontLoader.js';
import sans from './fonts/droid_sans_regular.typeface.json' with {type:'json'};
import serif from './fonts/droid_serif_regular.typeface.json' with {type:'json'};
import mono from './fonts/droid_sans_mono_regular.typeface.json' with {type:'json'};
import {t} from '@brickwright/cad-core';
const fonts={sans:new Font(sans as unknown as FontData),serif:new Font(serif as unknown as FontData),mono:new Font(mono as unknown as FontData)};
/** Bundled Apache-2.0 fonts. Preserve case and validate every glyph explicitly. */
export function fontLettering(text:string,font:'sans'|'serif'|'mono',height:number,depth:number){
 const selected=fonts[font];for(const character of [...text])if(!selected.data.glyphs[character])throw new Error(t`The selected font has no glyph for “${character}”`);
 const shapes=selected.generateShapes(text,height);if(!shapes.length)throw new Error(t('Enter text containing visible characters'));
 const geometry=new THREE.ExtrudeGeometry(shapes,{depth,bevelEnabled:false,curveSegments:8});geometry.computeBoundingBox();const bounds=geometry.boundingBox!;geometry.translate(-bounds.min.x,-bounds.min.y,0);geometry.computeBoundingBox();return geometry;
}
export function roundedPlate(width:number,height:number,radius:number,depth:number){
 const r=Math.min(radius,width/2,height/2),shape=new THREE.Shape();shape.moveTo(r,0);shape.lineTo(width-r,0);shape.quadraticCurveTo(width,0,width,r);shape.lineTo(width,height-r);shape.quadraticCurveTo(width,height,width-r,height);shape.lineTo(r,height);shape.quadraticCurveTo(0,height,0,height-r);shape.lineTo(0,r);shape.quadraticCurveTo(0,0,r,0);
 return new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:10});
}
