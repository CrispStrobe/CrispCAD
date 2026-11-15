// SPDX-License-Identifier: BSD-3-Clause
import {it,expect} from 'vitest';
import {createCadSession,parseDocument} from '@brickwright/cad-core';
import {createPresetDocument} from '../packages/editor/src/shapes.js';
it('persists unique motor ports through insert, duplicate, deletion and undo without renumbering survivors',()=>{
 const s=createCadSession(createPresetDocument('hinge'));s.insert(createPresetDocument('hinge'));
 const hinges=()=>s.state.document.joints!.filter(j=>j.kind==='hinge');
 expect(hinges().map(j=>j.control?.port)).toEqual(['A','B']);
 const ids=hinges().map(j=>j.id);
 s.setMotorPort(ids[1],'TURN');
 expect(()=>s.setMotorPort(ids[0],'TURN')).toThrow('duplicate');
 expect(s.state.document.joints![0].control?.port).toBe('A');
 s.select(s.state.document.roots);s.duplicate();
 expect(new Set(hinges().map(j=>j.control?.port)).size).toBe(4);
 const before=s.serialize();expect(parseDocument(before).joints!.find(j=>j.id===ids[1])!.control?.port).toBe('TURN');
 s.remove([s.state.document.joints![0].bodyA]);
 for(const j of hinges())expect(JSON.parse(before).joints.find((old:any)=>old.id===j.id).control.port).toBe(j.control?.port);
 s.undo();expect(s.serialize()).toBe(before);
 s.insert(createPresetDocument('hinge'));
 expect(new Set(hinges().map(j=>j.control?.port)).size).toBe(5);
});
