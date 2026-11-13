import {describe,it,expect} from 'vitest';
import {createCadSession,validateDocument} from '@brickwright/cad-core';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
describe('model clipboard and object identities',()=>{
 it('copies complete generated objects while leaving unrelated bodies out',()=>{
  const s=createCadSession();s.insert(createPresetDocument('screw'));const screw=s.state.selection[0];s.add({kind:'box',size:[10,10,10]});const before=s.serialize();const fragment=s.fragment([screw]);expect(fragment.roots).toEqual([screw]);expect(fragment.nodes[screw].generator?.preset).toBe('screw');expect(Object.keys(fragment.nodes).length).toBeGreaterThan(3);validateDocument(fragment);expect(s.serialize()).toBe(before);
 });
 it('merges formula namespaces on paste and offsets driven positions without baking',()=>{
  const source=createCadSession(),id=source.add({kind:'box',size:[10,10,10]});source.setParametric({version:1,parameters:{width:{expression:'40',unit:'mm'},unused:{expression:'50',unit:'mm'}},bindings:[{nodeId:id,property:'width',expression:'width'},{nodeId:id,property:'positionX',expression:'width / 2'}]});
  const fragment=source.fragment([id]);expect(Object.keys(fragment.parametric!.parameters)).toEqual(['width']);const target=createCadSession();target.setParametric({version:1,parameters:{width:{expression:'99',unit:'mm'},width_2:{expression:'80',unit:'mm'}},bindings:[]});
  target.insert(fragment,[10,0,0],{mergeParameters:true,label:'Paste objects'});const pasted=target.state.selection[0],node=target.state.document.nodes[pasted];expect(node.id).not.toBe(id);expect(node.transform.position[0]).toBe(30);expect(target.state.document.parametric!.parameters.width.expression).toBe('99');expect(target.state.document.parametric!.parameters.width_3.expression).toBe('40');
  const d=structuredClone(target.state.document.parametric!);d.parameters.width_3.expression='60';target.setParametric(d);expect(target.state.document.nodes[pasted].transform.position[0]).toBe(40);expect((target.state.document.nodes[pasted] as {size:number[]}).size[0]).toBe(60);
 });
 it('duplicates driven transforms with live formulas and gives copies unique names',()=>{
  const s=createCadSession(),id=s.add({kind:'box',size:[10,10,10]},{name:'Part'});s.setParametric({version:1,parameters:{x:{expression:'20',unit:'mm'}},bindings:[{nodeId:id,property:'positionX',expression:'x'}]});s.duplicate([id]);const a=s.state.selection[0];s.duplicate([id]);const b=s.state.selection[0];expect(s.state.document.nodes[a].name).toBe('Part copy');expect(s.state.document.nodes[b].name).toBe('Part copy 2');expect(s.state.document.nodes[a].transform.position[0]).toBe(30);const d=structuredClone(s.state.document.parametric!);d.parameters.x.expression='40';s.setParametric(d);expect(s.state.document.nodes[a].transform.position[0]).toBe(50);
 });
 it('remaps an entire copied mechanism and preserves its joints',()=>{
  const s=createCadSession(createPresetDocument('hinge')),old=[...s.state.document.roots],fragment=s.fragment(old);s.insert(fragment,[20,0,0],{mergeParameters:true,label:'Paste objects'});expect(s.state.document.roots).toHaveLength(6);expect(s.state.document.joints).toHaveLength(4);expect(s.state.document.joints!.slice(2).every(j=>!old.includes(j.bodyA)&&!old.includes(j.bodyB))).toBe(true);validateDocument(s.state.document);
 });
 it('does not pretend that a user-created combination is still a generated preset',()=>{
  const s=createCadSession();s.insert(createPresetDocument('screw'));const screw=s.state.selection[0],box=s.add({kind:'box',size:[10,10,10]});const combined=s.combine('union',[screw,box]);expect(s.state.document.nodes[combined].physics?.sourcePreset).toBeUndefined();expect(s.state.document.nodes[screw].generator?.preset).toBe('screw');
 });
});
