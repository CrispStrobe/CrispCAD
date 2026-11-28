// SPDX-License-Identifier: BSD-3-Clause
// Drawing symbols the sheet font has no glyph for, drawn as lines: the depth symbol of hole callouts
// (↧, a downward arrow onto a line), the fourteen geometric characteristic symbols of ISO 1101 /
// ASME Y14.5, and the circled material condition modifiers. The PDF's font is Helvetica in WinAnsi,
// which has Ø, × and ° but none of these; drawing them keeps one look in the PDF, SVG and DXF.
//
// Text around a symbol is placed with Helvetica's advance widths (the standard metrics, in
// thousandths of an em), so a symbol between two words sits where the PDF draws the gap. SVG falls
// back to Arial, which has the same widths; a DXF reader draws text in its own font.
import type {GdtCharacteristic,SketchPoint} from '@brickwright/cad-core';
import type {DrawingLayout,DrawingPath,DrawingText} from './drawing-page.js';

/** The depth symbol's place in callout text. */
export const DEPTH_SYMBOL='↧';

const widths:Record<string,number>={' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":191,'(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,
 ':':278,';':278,'<':584,'=':584,'>':584,'?':556,'@':1015,A:667,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,J:500,K:667,L:556,M:833,N:722,O:778,P:667,Q:778,R:722,
 S:667,T:611,U:722,V:667,W:944,X:667,Y:667,Z:611,'[':278,'\\':278,']':278,'^':469,_:556,'`':333,a:556,b:556,c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,
 m:833,n:556,o:556,p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,y:500,z:500,'{':334,'|':260,'}':334,'~':584,'×':584,'Ø':778,'ø':611,'°':400,'±':584,'µ':556,
 'Ä':667,'Ö':778,'Ü':722,'ä':556,'ö':556,'ü':556,'ß':611,'é':556,'è':556,'–':556,'—':1000,'’':222,'…':1000};
/** Advance width of `text` in Helvetica at `size` (mm); digits are 0.556 em, unknown characters 0.556 em. */
export function helveticaWidth(text:string,size:number){
 let total=0;
 for(const character of text)total+=character>='0'&&character<='9'?556:widths[character]??556;
 return total*size/1000;
}
/** Width the depth symbol takes in a line of text of height `size`. */
export const depthSymbolWidth=(size:number)=>size*.75;

const arc=(cx:number,cy:number,r:number,start:number,sweep:number,steps=24):SketchPoint[]=>
 Array.from({length:steps+1},(_,i)=>{const a=start+sweep*i/steps;return [cx+r*Math.cos(a),cy+r*Math.sin(a)];});
const circle=(cx:number,cy:number,r:number)=>arc(cx,cy,r,0,2*Math.PI,32);

/** The depth symbol with its baseline at y, from x: a stem down onto a short line, arrowhead at the line. */
export function depthSymbol(x:number,y:number,size:number):SketchPoint[][]{
 const cx=x+depthSymbolWidth(size)/2,top=y+size*.95,half=size*.28;
 return [[[cx,top],[cx,y]],[[cx-half*.8,y+size*.38],[cx,y],[cx+half*.8,y+size*.38]],[[cx-half,y],[cx+half,y]]];
}

/**
 * Put a text on the page; a depth symbol in it is drawn as lines with the text either side placed
 * after it. Returns what was added (texts and paths), so a caller can treat it as one item.
 */
export function addSymbolText(page:Pick<DrawingLayout,'paths'|'texts'>,text:DrawingText,stroke:DrawingPath['stroke']='annotation'){
 const added={texts:[] as DrawingText[],paths:[] as DrawingPath[]};
 if(!text.text.includes(DEPTH_SYMBOL)||text.angle){
  page.texts.push(text);added.texts.push(text);return added;
 }
 let x=text.x;
 const parts=text.text.split(DEPTH_SYMBOL);
 for(const [i,part] of parts.entries()){
  if(part){const item={...text,x,text:part};page.texts.push(item);added.texts.push(item);x+=helveticaWidth(part,text.size);}
  if(i<parts.length-1){
   for(const points of depthSymbol(x,text.y,text.size)){const path={stroke,points};page.paths.push(path);added.paths.push(path);}
   x+=depthSymbolWidth(text.size);
  }
 }
 return added;
}

/** Width a line of text with symbols takes (Helvetica). */
export function symbolTextWidth(text:string,size:number){
 return text.split(DEPTH_SYMBOL).reduce((sum,part)=>sum+helveticaWidth(part,size),0)+(text.split(DEPTH_SYMBOL).length-1)*depthSymbolWidth(size);
}

/**
 * The symbol of a geometric characteristic, centred at (cx, cy) in a cell of height `h` (the frame's
 * height), as polylines. Shapes follow ISO 1101 Table 2 / ASME Y14.5 Figure 3-1.
 */
export function gdtSymbol(characteristic:GdtCharacteristic,cx:number,cy:number,h:number):SketchPoint[][]{
 const s=h*.3; // half the symbol's size
 switch(characteristic){
  case 'straightness':return [[[cx-s,cy],[cx+s,cy]]];
  case 'flatness':return [[[cx-s,cy-s*.5],[cx+s*.55,cy-s*.5],[cx+s,cy+s*.5],[cx-s*.55,cy+s*.5],[cx-s,cy-s*.5]]];
  case 'circularity':return [circle(cx,cy,s*.85)];
  case 'cylindricity':return [circle(cx,cy,s*.7),[[cx-s*1.05,cy-s*.95],[cx-s*.3,cy+s*.95]],[[cx+s*.3,cy-s*.95],[cx+s*1.05,cy+s*.95]]];
  case 'profile-line':return [arc(cx,cy-s*.45,s,0,Math.PI)];
  case 'profile-surface':{const a=arc(cx,cy-s*.45,s,0,Math.PI);return [[...a,a[0]]];}
  case 'parallelism':return [[[cx-s*.85,cy-s],[cx-s*.05,cy+s]],[[cx+s*.05,cy-s],[cx+s*.85,cy+s]]];
  case 'perpendicularity':return [[[cx-s,cy-s],[cx+s,cy-s]],[[cx,cy-s],[cx,cy+s]]];
  case 'angularity':return [[[cx+s,cy-s],[cx-s,cy-s],[cx+s*.8,cy+s*.6]]];
  case 'position':return [circle(cx,cy,s*.62),[[cx-s,cy],[cx+s,cy]],[[cx,cy-s],[cx,cy+s]]];
  case 'concentricity':return [circle(cx,cy,s*.4),circle(cx,cy,s*.85)];
  case 'symmetry':return [[[cx-s*.55,cy+s*.45],[cx+s*.55,cy+s*.45]],[[cx-s,cy],[cx+s,cy]],[[cx-s*.55,cy-s*.45],[cx+s*.55,cy-s*.45]]];
  case 'circular-runout':return runoutArrow(cx,cy,s);
  case 'total-runout':return [...runoutArrow(cx-s*.35,cy,s),...runoutArrow(cx+s*.35,cy,s).slice(0,1),[[cx-s*.95,cy-s],[cx+s*.25,cy-s]]];
 }
}
function runoutArrow(cx:number,cy:number,s:number):SketchPoint[][]{
 const from:SketchPoint=[cx-s*.6,cy-s],to:SketchPoint=[cx+s*.5,cy+s];
 const a=Math.atan2(to[1]-from[1],to[0]-from[0]),l=s*.7;
 return [[from,to],[[to[0]-l*Math.cos(a-.38),to[1]-l*Math.sin(a-.38)],to,[to[0]-l*Math.cos(a+.38),to[1]-l*Math.sin(a+.38)],[to[0]-l*Math.cos(a-.38),to[1]-l*Math.sin(a-.38)]]];
}

/** A circled modifier (Ⓜ, Ⓛ): its circle; the letter is text. */
export const modifierCircle=(cx:number,cy:number,h:number)=>circle(cx,cy,h*.32);
