// SPDX-License-Identifier: BSD-3-Clause
import type {CodeProgram} from './code.js';
import {t} from './i18n.js';
export interface CodeExample {id:string;title:{en:string;de:string};group:'basics'|'parts'|'patterns'|'booleans';source:string}
const item=(id:string,en:string,de:string,group:CodeExample['group'],source:string):CodeExample=>({id,title:{en,de},group,source:source.replace(/;\s*/g,';\n').replace(/,\s*(?=(?:box|cylinder|sphere|move|rotate|scale|union|subtract|intersect|repeat)\()/g,',\n  ').trim()+'\n'});
/** Independently authored modeling examples. Not OpenSCAD/JSCAD imports. */
export const codeExamples:readonly CodeExample[]=Object.freeze([
 item('box','Dimensioned box','Bemaßter Quader','basics','param width:mm=30; param depth:mm=20; param height:mm=10; return box(width,depth,height);'),
 item('cylinder','Cylinder','Zylinder','basics','param radius:mm=10; param height:mm=20; return cylinder(radius,height);'),
 item('sphere','Sphere','Kugel','basics','param radius:mm=12; return sphere(radius,64);'),
 item('ellipsoid','Ellipsoid','Ellipsoid','basics','param radius:mm=10; return scale([1.6,1,0.7],sphere(radius,64));'),
 item('units','Dimensions with units','Maße mit Einheiten','basics','param width:mm=2 in; param depth:mm=3 cm; param height:mm=5; return box(width,depth,height);'),
 item('angled-beam','Angled beam','Schräger Balken','basics','param angle:deg=30; return rotate([0,0,angle],box(50,8,6));'),
 item('mounting-plate','Four-hole mounting plate','Montageplatte mit vier Bohrungen','parts','param width:mm=60; param depth:mm=40; param thickness:mm=5; param bore:mm=3; let plate=box(width,depth,thickness); let holes=move([-20,-10,0],repeat(2,[40,0,0],repeat(2,[0,20,0],cylinder(bore,thickness*2)))); return subtract(plate,holes);'),
 item('three-bores','Three-bore plate','Platte mit drei Bohrungen','parts','param thickness:mm=5; let plate=box(60,25,thickness); let holes=move([-20,0,0],repeat(3,[20,0,0],cylinder(3,thickness*2))); return subtract(plate,holes);'),
 item('washer','Washer','Unterlegscheibe','parts','param outer:mm=12; param bore:mm=4; param thickness:mm=2; return subtract(cylinder(outer,thickness),cylinder(bore,thickness*2));'),
 item('spacer','Tubular spacer','Rohrförmiger Abstandshalter','parts','param outer:mm=7; param bore:mm=3; param height:mm=18; return subtract(cylinder(outer,height),cylinder(bore,height*2));'),
 item('sleeve','Thin sleeve','Dünnwandige Hülse','parts','param radius:mm=15; param wall:mm=2; param height:mm=25; return subtract(cylinder(radius,height),cylinder(radius-wall,height*2));'),
 item('boss','Mounting boss','Befestigungsdom','parts','let base=move([0,0,2],box(35,35,4)); let boss=move([0,0,10],cylinder(8,20)); return subtract(union(base,boss),cylinder(3,50));'),
 item('hub','Flanged hub','Nabe mit Flansch','parts','let flange=move([0,0,2],cylinder(18,4)); let hub=move([0,0,10],cylinder(9,20)); return subtract(union(flange,hub),cylinder(4,60));'),
 item('shaft-collar','Split shaft collar','Geschlitzter Stellring','parts','let ring=subtract(cylinder(14,10),cylinder(7,30)); return subtract(ring,move([10,0,0],box(20,2,30)));'),
 item('l-bracket','L bracket','Winkelhalter','parts','param width:mm=30; param length:mm=40; param wall:mm=4; let foot=move([0,0,wall/2],box(length,width,wall)); let upright=move([-length/2+wall/2,0,15],box(wall,width,30)); return union(foot,upright);'),
 item('u-channel','U channel','U-Profil','parts','param wall:mm=3; let outside=box(50,30,20); let inside=move([0,0,wall],box(60,30 mm-wall*2,20)); return subtract(outside,inside);'),
 item('tray','Open tray','Offene Schale','parts','param wall:mm=3; return subtract(box(60,40,20),move([0,0,wall],box(60 mm-wall*2,40 mm-wall*2,20)));'),
 item('lid','Lid with locating rim','Deckel mit Zentrierrand','parts','let top=move([0,0,2],box(60,40,4)); let rim=subtract(box(54,34,6),box(48,28,12)); return union(top,rim);'),
 item('handle','Rounded-end handle','Griff mit runden Enden','parts','let middle=box(40,12,6); let ends=move([-20,0,0],repeat(2,[40,0,0],cylinder(6,6))); return union(middle,ends);'),
 item('cable-clip','Open cable clip','Offener Kabelclip','parts','let ring=subtract(cylinder(12,8),cylinder(8,20)); return subtract(ring,move([12,0,0],box(20,9,20)));'),
 item('drill-jig','Drilling guide','Bohrlehre','parts','param spacing:mm=15; let block=box(60,20,18); let holes=move([-spacing,0,0],repeat(3,[spacing,0,0],cylinder(2.5,40))); return subtract(block,holes);'),
 item('counterbore','Counterbored plate','Platte mit Zylindersenkung','parts','let plate=box(40,30,12); let through=cylinder(3,40); let recess=move([0,0,6],cylinder(6,8)); return subtract(plate,through,recess);'),
 item('standoff-array','Standoffs on a base','Abstandsbolzen auf einer Grundplatte','patterns','let base=move([0,0,2],box(65,30,4)); let posts=move([-24,0,10],repeat(4,[16,0,0],cylinder(4,20))); return union(base,posts);'),
 item('perforated-tile','Perforated tile','Lochplatte','patterns','let base=box(70,40,4); let holes=move([-24,-12,0],repeat(5,[12,0,0],repeat(3,[0,12,0],cylinder(3,10)))); return subtract(base,holes);'),
 item('ventilation-panel','Ventilation slots','Lüftungsschlitze','patterns','let plate=box(65,45,4); let slots=move([-24,0,0],repeat(7,[8,0,0],box(3,30,12))); return subtract(plate,slots);'),
 item('comb','Comb','Kamm','patterns','let spine=box(60,6,5); let teeth=move([-24,12,0],repeat(9,[6,0,0],box(3,24,5))); return union(spine,teeth);'),
 item('ribbed-platform','Ribbed platform','Gerippte Plattform','patterns','let plate=move([0,0,2],box(60,40,4)); let ribs=move([-24,0,8],repeat(7,[8,0,0],box(3,40,12))); return union(plate,ribs);'),
 item('wedge','Wedge by intersection','Keil durch Schnittmenge','booleans','return intersect(box(40,30,20),move([0,0,-15],rotate([0,30,0],box(80,40,30))));'),
 item('lens','Intersection lens','Linsenförmige Schnittmenge','booleans','return intersect(move([-6,0,0],sphere(15)),move([6,0,0],sphere(15)));'),
 item('dome','Hemisphere','Halbkugel','booleans','return intersect(sphere(20,64),move([0,0,15],box(50,50,30)));'),
 item('hollow-dome','Hollow dome','Hohlkuppel','booleans','let shell=subtract(sphere(20,64),sphere(17,64)); return intersect(shell,move([0,0,15],box(50,50,30)));'),
 item('ball-seat','Spherical seat','Kugelförmige Aufnahme','booleans','return subtract(box(40,40,16),move([0,0,14],sphere(15,64)));'),
 item('cross-brace','Cross brace','Kreuzstrebe','booleans','return union(rotate([0,0,45],box(60,8,5)),rotate([0,0,-45],box(60,8,5)));'),
 item('forward-references','Named dependencies','Benannte Abhängigkeiten','basics','param height:mm=width/2; param width:mm=30; let result=union(base,post); let base=box(width,width,4); let post=move([0,0,height/2],cylinder(5,height)); return result;')
]);
export function codeExampleProgram(id:string):CodeProgram{const example=codeExamples.find(e=>e.id===id);if(!example)throw new Error(t('Unknown code example'));return {version:1,language:'brickwright-cad-script',source:example.source,parameters:{}};}
