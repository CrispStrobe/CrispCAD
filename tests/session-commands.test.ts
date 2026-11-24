// SPDX-License-Identifier: BSD-3-Clause
import {describe,expect,it} from 'vitest';
import {createCadSession,createDocument,defaultCodeProgram,defaultSimulationSettings,identityTransform,parseSessionCommand,serializeSessionCommand} from '@brickwright/cad-core';
import type {ApplySessionCommand,CadSession,SessionCommandRecord} from '@brickwright/cad-core';

const box=()=>({kind:'box' as const,size:[10,20,30] as [number,number,number]});
function observe(session:CadSession){
  const records:SessionCommandRecord[]=[];
  const unsubscribe=session.subscribeCommands(record=>records.push(record));
  return {records,unsubscribe};
}
function applyRecord(records:SessionCommandRecord[]):SessionCommandRecord&{command:ApplySessionCommand}{
  const record=records.filter(record=>record.command.kind==='apply').at(-1);
  if(!record||record.command.kind!=='apply')throw new Error('Expected a recorded model command');
  return record as SessionCommandRecord&{command:ApplySessionCommand};
}
function bodyOperationFixture(kind:'mirror'|'pattern',nested=false){
  const session=createCadSession(),source=session.add(box());
  const body=kind==='mirror'?session.mirrorBody(source,{plane:'YZ',offset:0})
    :session.patternBody(source,{mode:'linear',axis:'X',count:2,spacing:20});
  const dependent=nested?session.combine('union',[body,session.add(box())]):body;
  const other=session.add(box());
  const edit=()=>kind==='mirror'?session.editMirror(body,{plane:'YZ',offset:5})
    :session.editPattern(body,{mode:'linear',axis:'X',count:3,spacing:20});
  return {session,body,dependent,other,edit};
}
const operationCases=[
  {kind:'mirror' as const,nested:false},{kind:'pattern' as const,nested:false},
  {kind:'mirror' as const,nested:true},{kind:'pattern' as const,nested:true},
];

describe('replayable session commands',()=>{
  it('records a GUI edit, then undoes and replays its canonical command as exactly one step',()=>{
    const session=createCadSession(),{records}=observe(session),id=session.add(box());
    const expected=session.serialize(),record=applyRecord(records);
    expect(record.text).toMatch(/^apply /);
    expect(record.summary).toBe(session.state.label);
    expect(parseSessionCommand(record.text)).toEqual(record.command);
    session.undo();
    expect(session.executeCommand(record.text)).toBe(true);
    expect(session.serialize()).toBe(expected);
    expect(session.state.selection).toEqual([id]);
    expect(session.history.past).toHaveLength(1);
    expect(session.state.canRedo).toBe(false);
    expect(records.map(record=>record.command.kind)).toEqual(['apply','undo','apply']);
    session.undo();
    expect(session.state.document.roots).toEqual([]);
    expect(session.state.canUndo).toBe(false);
  });

  it('replays graph creation, booleans, copying and deletion with their original identities',()=>{
    const initial=createDocument(),source=createCadSession(initial),{records}=observe(source);
    const a=source.add(box()),b=source.add(box()),operation=source.combine('subtract',[a,b]);
    source.duplicate([operation]);source.remove([operation]);
    const target=createCadSession(initial);
    for(const record of records)target.executeCommand(record.text);
    expect(target.state.document).toEqual(source.state.document);
    expect(target.state.selection).toEqual(source.state.selection);
    expect(target.history.past).toEqual(source.history.past);
    target.undo();source.undo();
    expect(target.state.document).toEqual(source.state.document);
  });

  it('captures arbitrary atomic assembly edits, including settings and several object fields',()=>{
    const session=createCadSession(),id=session.add(box()),before=session.serialize(),{records}=observe(session);
    session.editAssembly('Configure assembly',draft=>{
      draft.title='Mechanism';draft.version=8;draft.simulation={...defaultSimulationSettings(),gravity:[0,0,0]};
      draft.nodes[id].name='Base';draft.nodes[id].color='#123456';draft.nodes[id].transform.rotation=[0,0,30];
    });
    const expected=session.serialize(),record=applyRecord(records);
    expect(record.command.changes.map(change=>change.path)).toEqual(expect.arrayContaining([
      ['title'],['version'],['simulation'],['nodes',id,'name'],['nodes',id,'color'],['nodes',id,'transform','rotation'],
    ]));
    session.undo();expect(session.serialize()).toBe(before);
    session.executeCommand(record.text);expect(session.serialize()).toBe(expected);
    expect(session.history.past.at(-1)).toBe('Configure assembly');
  });

  it('captures retained sketches, code programs and their edits without losing source',()=>{
    const initial=createDocument(),session=createCadSession(initial),{records}=observe(session);
    const sketch=session.addSketch({kind:'rectangle',id:'profile',width:20,depth:30},{plane:'XZ'});
    session.extrudeSketch(sketch,{distance:8});
    session.updateSketch(sketch,{name:'Side profile',profile:{kind:'rectangle',id:'profile',width:40,depth:30}});
    const code=session.addCode(defaultCodeProgram(),'Scripted plate');
    const program=defaultCodeProgram();program.parameters.width='80';session.updateCode(code,program);
    const replay=createCadSession(initial);
    for(const record of records)replay.executeCommand(serializeSessionCommand(record.command));
    expect(replay.state.document).toEqual(session.state.document);
    expect(replay.state.document.nodes[code]).toMatchObject({program:{parameters:{width:'80'}}});
    expect(replay.state.document.sketches![sketch]).toMatchObject({name:'Side profile',plane:'XZ',profile:{width:40}});
    expect(replay.history.past).toHaveLength(5);
  });

  it('records derived parameter values and the live model source in the same command',()=>{
    const session=createCadSession(),id=session.add(box()),{records}=observe(session);
    session.enableModelSource();
    session.setParametric({version:1,parameters:{width:{expression:'45 mm',unit:'mm'}},bindings:[{nodeId:id,property:'width',expression:'width'}]});
    const expected=session.serialize(),record=applyRecord(records);
    expect(record.command.changes.some(change=>change.path[0]==='modelSource')).toBe(true);
    expect(record.command.changes.some(change=>change.path.join('.')===`nodes.${id}.size`)).toBe(true);
    session.undo();session.executeCommand(record.text);
    expect(session.serialize()).toBe(expected);
    expect(records.filter(record=>record.command.kind==='apply')).toHaveLength(2);
  });

  it('rejects stale values, wrong projects and invalid geometry without changing model or either history stack',()=>{
    const session=createCadSession(),id=session.add(box()),{records}=observe(session);
    session.update(id,{size:[25,20,30]});const record=applyRecord(records);
    session.undo();session.update(id,{size:[40,20,30]});
    const before=session.state,history=session.history,count=records.length;
    expect(()=>session.executeCommand(record.text)).toThrow(/stale/);
    expect(session.state.document).toBe(before.document);expect(session.state.revision).toBe(before.revision);
    expect(session.history).toEqual(history);expect(records).toHaveLength(count);
    expect(()=>createCadSession().executeCommand(record.text)).toThrow(/different project/);
    session.undo();
    const invalid=parseSessionCommand(record.text) as ApplySessionCommand;
    invalid.changes.find(change=>change.path.at(-1)==='size')!.after={present:true,value:[-1,20,30]};
    const validBefore=session.serialize(),validHistory=session.history,validRevision=session.state.revision;
    expect(()=>session.executeCommand(invalid)).toThrow(/dimensions/);
    expect(session.serialize()).toBe(validBefore);expect(session.history).toEqual(validHistory);
    expect(session.state.revision).toBe(validRevision);
    expect(session.state.canRedo).toBe(true);
  });

  it('preserves unrelated edits while checking every property written by a replay',()=>{
    const session=createCadSession(),id=session.add(box()),{records}=observe(session);
    session.update(id,{color:'#123456'});const record=applyRecord(records);
    session.undo();session.rename('Unrelated title');session.executeCommand(record.text);
    expect(session.state.document.title).toBe('Unrelated title');
    expect(session.state.document.nodes[id].color).toBe('#123456');
    session.undo();expect(session.state.document.title).toBe('Unrelated title');
    expect(session.state.document.nodes[id].color).not.toBe('#123456');
  });

  it('rejects a recorded sketch edit when a joint was attached to its dependent body',()=>{
    const session=createCadSession(),sketch=session.addSketch({kind:'rectangle',id:'profile',width:20,depth:30});
    const extrusion=session.extrudeSketch(sketch,{distance:8}),operand=session.add(box());
    const body=session.combine('union',[extrusion,operand]),other=session.add(box()),{records}=observe(session);
    const patch={profile:{kind:'rectangle' as const,id:'profile',width:25,depth:30}};
    session.updateSketch(sketch,patch);const record=applyRecord(records);
    expect(record.command.context).toEqual({sketchJoints:[{sketchId:sketch,joints:[]}]});
    session.undo();session.addJoint('fixed',body,other,[0,0,0],[0,0,1]);
    const before=session.serialize(),history=session.history,revision=session.state.revision,count=records.length;
    expect(()=>session.updateSketch(sketch,patch)).toThrow(/Detach joints/);
    expect(()=>session.executeCommand(record.text)).toThrow(/stale: joint relationships/);
    expect(session.serialize()).toBe(before);expect(session.history).toEqual(history);
    expect(session.state.revision).toBe(revision);expect(records).toHaveLength(count);
  });

  it('preserves unrelated names, colors and joints when replaying a sketch edit',()=>{
    const session=createCadSession(),sketch=session.addSketch({kind:'rectangle',id:'profile',width:20,depth:30});
    const body=session.extrudeSketch(sketch,{distance:8}),a=session.add(box()),b=session.add(box()),{records}=observe(session);
    session.updateSketch(sketch,{profile:{kind:'rectangle',id:'profile',width:25,depth:30}});
    const record=applyRecord(records);session.undo();
    session.update(body,{name:'Retained name',color:'#123456'});
    const joint=session.addJoint('fixed',a,b,[0,0,0],[0,0,1]);
    expect(session.executeCommand(record.text)).toBe(true);
    expect(session.state.document.sketches![sketch].profile).toMatchObject({width:25});
    expect(session.state.document.nodes[body]).toMatchObject({name:'Retained name',color:'#123456'});
    expect(session.state.document.joints!.map(entry=>entry.id)).toEqual([joint]);
    session.undo();expect(session.state.document.sketches![sketch].profile).toMatchObject({width:20});
    expect(session.state.document.joints!.map(entry=>entry.id)).toEqual([joint]);
  });

  it('detects a previously unrelated joint reconnected to the edited sketch',()=>{
    const session=createCadSession(),sketch=session.addSketch({kind:'rectangle',id:'profile',width:20,depth:30});
    const body=session.extrudeSketch(sketch,{distance:8}),a=session.add(box()),b=session.add(box());
    session.addJoint('fixed',a,b,[0,0,0],[0,0,1]);const {records}=observe(session);
    session.updateSketch(sketch,{profile:{kind:'rectangle',id:'profile',width:25,depth:30}});
    const record=applyRecord(records);session.undo();
    session.editAssembly('Reconnect joint',draft=>{draft.joints![0].bodyA=body;});
    const before=session.serialize();
    expect(()=>session.executeCommand(record.text)).toThrow(/stale: joint relationships/);
    expect(session.serialize()).toBe(before);
  });

  it('replays an accepted atomic assembly edit with its original joint context',()=>{
    const session=createCadSession(),sketch=session.addSketch({kind:'rectangle',id:'profile',width:20,depth:30});
    const body=session.extrudeSketch(sketch,{distance:8}),other=session.add(box());
    const joint=session.addJoint('fixed',body,other,[0,0,0],[0,0,1]),{records}=observe(session);
    session.editAssembly('Resize connected assembly',draft=>{
      draft.sketches![sketch].profile={kind:'rectangle',id:'profile',width:25,depth:30};
      draft.joints![0].anchorA=[5,0,0];
    });
    const expected=session.serialize(),record=applyRecord(records);
    expect(record.command.context).toEqual({sketchJoints:[{sketchId:sketch,joints:[{id:joint,bodyA:body,bodyB:other}]}]});
    expect(Object.isFrozen(record.command.context!.sketchJoints![0].joints)).toBe(true);
    session.undo();const history=session.history.past.length;
    expect(session.executeCommand(record.text)).toBe(true);expect(session.serialize()).toBe(expected);
    expect(session.history.past).toHaveLength(history+1);
    // Earlier version-1 records remain readable and replayable without new fields.
    const legacy=structuredClone(record.command);delete legacy.context;session.undo();
    expect(session.executeCommand(serializeSessionCommand(legacy))).toBe(true);
    expect(session.serialize()).toBe(expected);
  });

  it('validates optional read context before replaying any document changes',()=>{
    const session=createCadSession(),sketch=session.addSketch({kind:'rectangle',id:'profile',width:20,depth:30}),{records}=observe(session);
    session.updateSketch(sketch,{profile:{kind:'rectangle',id:'profile',width:25,depth:30}});
    const valid=structuredClone(applyRecord(records).command);session.undo();
    const before=session.serialize(),history=session.history;
    for(const context of [
      null,{}, {sketchJoints:[]}, {sketchJoints:Array(1)},
      {sketchJoints:[{sketchId:sketch,joints:[],extra:true}]},
      {sketchJoints:[{sketchId:sketch,joints:[]},{sketchId:sketch,joints:[]}]},
      {sketchJoints:[{sketchId:sketch,joints:Array(1)}]},
      {sketchJoints:[{sketchId:sketch,joints:[{id:'joint',bodyA:'same',bodyB:'same'}]}]},
    ])expect(()=>session.executeCommand({...valid,context} as ApplySessionCommand)).toThrow(/Invalid session command/);
    expect(session.serialize()).toBe(before);expect(session.history).toEqual(history);
  });

  it.each(operationCases)('rejects a recorded $kind edit after attaching a joint (nested: $nested)',({kind,nested})=>{
    const {session,body,dependent,other,edit}=bodyOperationFixture(kind,nested),{records}=observe(session);
    edit();const record=applyRecord(records);
    expect(record.command.context).toEqual({bodyOperations:[{bodyId:body,kind,joints:[],tracers:[]}]});
    session.undo();session.addJoint('fixed',dependent,other,[0,0,0],[0,0,1]);
    const before=session.serialize(),history=session.history,revision=session.state.revision,count=records.length;
    expect(edit).toThrow(/Detach .* joints/);
    expect(()=>session.executeCommand(record.text)).toThrow(/stale: joint or tracer relationships/);
    expect(session.serialize()).toBe(before);expect(session.history).toEqual(history);
    expect(session.state.revision).toBe(revision);expect(records).toHaveLength(count);
  });

  it.each(operationCases)('rejects a recorded $kind edit after attaching a tracer (nested: $nested)',({kind,nested})=>{
    const {session,dependent,edit}=bodyOperationFixture(kind,nested),{records}=observe(session);
    edit();const record=applyRecord(records);session.undo();session.addTracer(dependent,[0,0,0]);
    const before=session.serialize(),history=session.history,revision=session.state.revision,count=records.length;
    expect(edit).toThrow(/Remove .* motion tracers/);
    expect(()=>session.executeCommand(record.text)).toThrow(/stale: joint or tracer relationships/);
    expect(session.serialize()).toBe(before);expect(session.history).toEqual(history);
    expect(session.state.revision).toBe(revision);expect(records).toHaveLength(count);
  });

  it.each(['mirror','pattern'] as const)('preserves unrelated edits while replaying a %s operation',kind=>{
    const {session,body,other,edit}=bodyOperationFixture(kind),third=session.add(box()),{records}=observe(session);
    edit();const record=applyRecord(records);session.undo();
    session.update(body,{name:'Retained name',color:'#123456'});
    const joint=session.addJoint('fixed',other,third,[0,0,0],[0,0,1]);
    const tracer=session.addTracer(other,[1,2,3]);
    expect(session.executeCommand(record.text)).toBe(true);
    expect(session.state.document.nodes[body]).toMatchObject({name:'Retained name',color:'#123456',
      ...(kind==='mirror'?{offset:5}:{pattern:{count:3}})});
    expect(session.state.document.joints!.map(entry=>entry.id)).toEqual([joint]);
    expect(session.state.document.tracers!.map(entry=>entry.id)).toEqual([tracer]);
    session.undo();
    expect(session.state.document.nodes[body]).toMatchObject({name:'Retained name',color:'#123456',
      ...(kind==='mirror'?{offset:0}:{pattern:{count:2}})});
    expect(session.state.document.joints!.map(entry=>entry.id)).toEqual([joint]);
    expect(session.state.document.tracers!.map(entry=>entry.id)).toEqual([tracer]);
  });

  it.each(['joint','tracer'] as const)('detects an existing %s reconnected to the edited operation',relationship=>{
    const {session,body,other,edit}=bodyOperationFixture('mirror',true),third=session.add(box());
    session.addJoint('fixed',other,third,[0,0,0],[0,0,1]);session.addTracer(other,[0,0,0]);
    const {records}=observe(session);edit();const record=applyRecord(records);session.undo();
    session.editAssembly('Reconnect dependency',draft=>{
      const dependent=draft.roots.find(id=>draft.nodes[id].kind==='boolean')!;
      if(relationship==='joint')draft.joints![0].bodyA=dependent;
      else draft.tracers![0].bodyId=dependent;
    });
    const before=session.serialize(),history=session.history;
    expect(()=>session.executeCommand(record.text)).toThrow(/stale: joint or tracer relationships/);
    expect(session.serialize()).toBe(before);expect(session.history).toEqual(history);
    expect(session.state.document.nodes[body]).toMatchObject({offset:0});
  });

  it('preserves connection settings when replaying an accepted operation-only assembly edit',()=>{
    const {session,body,other}=bodyOperationFixture('mirror');
    session.addJoint('fixed',body,other,[0,0,0],[0,0,1]);session.addTracer(body,[0,0,0]);
    const {records}=observe(session);
    session.editAssembly('Adjust connected mirror',draft=>{const node=draft.nodes[body];if(node.kind==='mirror')node.offset=5;});
    const record=applyRecord(records);session.undo();
    session.updateJoint(session.state.document.joints![0].id,{collideConnected:true});
    session.editAssembly('Move tracer',draft=>{draft.tracers![0].point=[1,2,3];draft.tracers![0].color='#123456';});
    expect(session.executeCommand(record.text)).toBe(true);
    expect(session.state.document.nodes[body]).toMatchObject({offset:5});
    expect(session.state.document.joints![0].collideConnected).toBe(true);
    expect(session.state.document.tracers![0]).toMatchObject({point:[1,2,3],color:'#123456'});
    session.undo();expect(session.state.document.nodes[body]).toMatchObject({offset:0});
    expect(session.state.document.joints![0].collideConnected).toBe(true);
    expect(session.state.document.tracers![0]).toMatchObject({point:[1,2,3],color:'#123456'});
  });

  it.each(['mirror','pattern'] as const)('replays an atomic %s and connection edit with version-1 compatibility',kind=>{
    const {session,body,other}=bodyOperationFixture(kind);
    const joint=session.addJoint('fixed',body,other,[0,0,0],[0,0,1]),tracer=session.addTracer(body,[0,0,0]),{records}=observe(session);
    session.editAssembly('Adjust connected operation',draft=>{
      const node=draft.nodes[body];
      if(node.kind==='mirror')node.offset=5;else if(node.kind==='pattern')node.pattern.count=3;
      draft.joints![0].anchorA=[5,0,0];draft.tracers![0].point=[5,0,0];
    });
    const expected=session.serialize(),record=applyRecord(records);
    expect(record.command.context).toEqual({bodyOperations:[{bodyId:body,kind,
      joints:[{id:joint,bodyA:body,bodyB:other}],tracers:[{id:tracer,bodyId:body}]}]});
    expect(Object.isFrozen(record.command.context!.bodyOperations![0].tracers)).toBe(true);
    expect(parseSessionCommand(serializeSessionCommand(record.command))).toEqual(record.command);
    expect(record.command.version).toBe(1);
    session.undo();const history=session.history.past.length;
    expect(session.executeCommand(record.text)).toBe(true);expect(session.serialize()).toBe(expected);
    expect(session.history.past).toHaveLength(history+1);
    const legacy=structuredClone(record.command);delete legacy.context;session.undo();
    expect(session.executeCommand(serializeSessionCommand(legacy))).toBe(true);
    expect(session.serialize()).toBe(expected);
  });

  it('combines sketch and body-operation read dependencies in one atomic record',()=>{
    const session=createCadSession(),sketch=session.addSketch({kind:'rectangle',id:'profile',width:20,depth:30});
    const extrusion=session.extrudeSketch(sketch,{distance:8}),body=session.mirrorBody(extrusion,{plane:'YZ',offset:0}),{records}=observe(session);
    session.editAssembly('Adjust sketch and mirror',draft=>{
      const profile=draft.sketches![sketch].profile;if(profile.kind==='rectangle')profile.width=25;
      const node=draft.nodes[body];if(node.kind==='mirror')node.offset=5;
    });
    const record=applyRecord(records),expected=session.serialize();
    expect(record.command.context).toEqual({sketchJoints:[{sketchId:sketch,joints:[]}],
      bodyOperations:[{bodyId:body,kind:'mirror',joints:[],tracers:[]}]});
    session.undo();expect(session.executeCommand(serializeSessionCommand(record.command))).toBe(true);
    expect(session.serialize()).toBe(expected);
    const legacy=structuredClone(record.command);delete legacy.context!.bodyOperations;session.undo();
    expect(session.executeCommand(serializeSessionCommand(legacy))).toBe(true);
    expect(session.serialize()).toBe(expected);
  });

  it('rejects malformed body-operation read context without changing state or history',()=>{
    const {session,body,edit}=bodyOperationFixture('mirror'),{records}=observe(session);edit();
    const valid=structuredClone(applyRecord(records).command);session.undo();
    const entry={bodyId:body,kind:'mirror',joints:[],tracers:[]};
    const before=session.serialize(),history=session.history,revision=session.state.revision,count=records.length;
    for(const context of [
      {bodyOperations:null},{bodyOperations:[]},{bodyOperations:Array(1)},
      {bodyOperations:[entry,entry]},{bodyOperations:[{...entry,extra:true}]},
      {bodyOperations:[{...entry,bodyId:'missing space'}]},{bodyOperations:[{...entry,kind:'box'}]},
      {bodyOperations:[{bodyId:body,kind:'mirror',tracers:[]}]},
      {bodyOperations:[{...entry,joints:Array(1)}]},
      {bodyOperations:[{...entry,joints:[{id:'joint',bodyA:body,bodyB:body}]}]},
      {bodyOperations:[{...entry,joints:[{id:'joint',bodyA:body,bodyB:'other',extra:true}]}]},
      {bodyOperations:[{...entry,joints:Array(2).fill({id:'joint',bodyA:body,bodyB:'other'})}]},
      {bodyOperations:[{bodyId:body,kind:'mirror',joints:[]}]},
      {bodyOperations:[{...entry,tracers:Array(1)}]},
      {bodyOperations:[{...entry,tracers:[{id:'bad id',bodyId:body}]}]},
      {bodyOperations:[{...entry,tracers:[{id:'tracer',bodyId:'missing space'}]}]},
      {bodyOperations:[{...entry,tracers:[{id:'tracer',bodyId:body,extra:true}]}]},
      {bodyOperations:[{...entry,tracers:Array(2).fill({id:'tracer',bodyId:body})}]},
      {bodyOperations:[{...entry,tracers:Array.from({length:33},(_,i)=>({id:`tracer${i}`,bodyId:body}))}]},
      {sketchJoints:[],bodyOperations:[entry]},
    ]){
      expect(()=>serializeSessionCommand({...valid,context} as ApplySessionCommand)).toThrow(/Invalid session command/);
      expect(()=>session.executeCommand({...valid,context} as ApplySessionCommand)).toThrow(/Invalid session command/);
    }
    expect(session.serialize()).toBe(before);expect(session.history).toEqual(history);
    expect(session.state.revision).toBe(revision);expect(records).toHaveLength(count);
  });

  it('shares existing selection and undo/redo behavior without adding modeling history',()=>{
    const session=createCadSession(),id=session.add(box()),{records}=observe(session),revision=session.state.revision;
    expect(session.executeCommand('select []')).toBe(true);
    expect(session.executeCommand(`select ${JSON.stringify([id])}`)).toBe(true);
    expect(session.executeCommand({version:1,kind:'select',ids:[id]})).toBe(false);
    expect(session.state.revision).toBe(revision);expect(session.history.past).toHaveLength(1);
    expect(records.map(record=>record.command.kind)).toEqual(['select','select']);
    expect(()=>session.executeCommand('select ["missing"]')).toThrow(/existing/);
    expect(session.executeCommand('undo')).toBe(true);expect(session.state.document.roots).toEqual([]);
    expect(session.executeCommand('undo')).toBe(false);
    expect(session.executeCommand('redo')).toBe(true);expect(session.state.document.roots).toEqual([id]);
    expect(session.executeCommand('redo')).toBe(false);
    expect(records.map(record=>record.text)).toEqual(['select []',`select ${JSON.stringify([id])}`,'undo','redo']);
  });

  it('excludes no-ops, rejected edits and project loads from the action journal',()=>{
    const session=createCadSession(),id=session.add(box()),{records,unsubscribe}=observe(session),revision=session.state.revision;
    session.update(id,{color:session.state.document.nodes[id].color});session.select([id,id,'missing']);
    session.editAssembly('Reorder keys',draft=>{const title=draft.title;delete (draft as Partial<typeof draft>).title;draft.title=title;});
    expect(()=>session.update(id,{size:[0,20,30]})).toThrow();
    expect(records).toEqual([]);expect(session.state.revision).toBe(revision);
    session.load(createDocument('Other project'));expect(records).toEqual([]);
    unsubscribe();session.rename('Not observed');expect(records).toEqual([]);
  });

  it('detaches and freezes observations and never retains mutable replay input',()=>{
    const session=createCadSession(),{records}=observe(session),id=session.add(box()),record=applyRecord(records);
    expect(Object.isFrozen(record)).toBe(true);expect(Object.isFrozen(record.command)).toBe(true);
    expect(Object.isFrozen(record.command.changes)).toBe(true);
    expect(()=>record.command.changes.push(record.command.changes[0])).toThrow();
    const replayInput=parseSessionCommand(record.text) as ApplySessionCommand;
    session.undo();session.executeCommand(replayInput);
    replayInput.selection.length=0;replayInput.changes.length=0;
    expect(session.state.selection).toEqual([id]);expect(session.state.document.nodes[id]).toBeDefined();
    expect(record.text).toBe(serializeSessionCommand(record.command));
    expect(JSON.stringify(session.state.document)).not.toContain('changes');
  });

  it('records a mesh transform without duplicating mesh buffers',()=>{
    const session=createCadSession(),id=session.add({kind:'mesh',id:'mesh',name:'Tetra',color:'#ffffff',transform:identityTransform(),positions:[0,0,0,1,0,0,0,1,0,0,0,1],indices:[0,2,1,0,1,3,0,3,2,1,2,3]});
    const {records}=observe(session);
    session.transform([{id,transform:{...identityTransform(),position:[15,25,35]}}]);
    const record=applyRecord(records);
    expect(record.command.changes).toEqual([{path:['nodes',id,'transform','position'],before:{present:true,value:[0,0,0]},after:{present:true,value:[15,25,35]}}]);
    expect(record.text).not.toContain('positions');expect(record.text).not.toContain('indices');
    session.undo();session.executeCommand(record.text);
    expect(session.state.document.nodes[id].transform.position).toEqual([15,25,35]);
  });

  it('rejects malformed, unsupported, overlapping, non-JSON and prototype-changing commands',()=>{
    const session=createCadSession(),{records}=observe(session);session.add(box());
    const valid=structuredClone(applyRecord(records).command);
    for(const text of ['','undo extra','redo extra','apply {','select {}','eval alert(1)'])expect(()=>parseSessionCommand(text),text).toThrow();
    for(const value of [
      {...valid,version:2},
      {...valid,changes:[...valid.changes,valid.changes[0]]},
      {...valid,changes:[{path:['id'],before:{present:true,value:session.state.document.id},after:{present:true,value:'other'}}]},
      {...valid,changes:[{path:['__proto__','polluted'],before:{present:false},after:{present:true,value:true}}]},
      {...valid,changes:[{path:['title'],before:{present:true,value:session.state.document.title},after:{present:true,value:()=>1}}]},
      {...valid,changes:[{path:['nodes'],before:{present:true,value:{}},after:{present:true,value:{}}},{path:['nodes','child'],before:{present:false},after:{present:true,value:{}}}]},
    ])expect(()=>session.executeCommand(value as ApplySessionCommand)).toThrow();
    expect(({} as {polluted?:boolean}).polluted).toBeUndefined();
    expect(session.history.past).toHaveLength(1);
  });

  it('isolates observer failures and clears command subscriptions on disposal',()=>{
    const session=createCadSession();session.subscribeCommands(()=>{throw new Error('Presentation failed');});
    const {records}=observe(session);
    expect(()=>session.add(box())).not.toThrow();expect(records).toHaveLength(1);
    session.dispose();session.rename('No listeners');expect(records).toHaveLength(1);
  });

  it('preserves opaque legacy own properties without following inherited prototype paths',()=>{
    const initial=createDocument() as ReturnType<typeof createDocument>&{opaque:Record<string,unknown>};
    initial.opaque=JSON.parse('{"constructor":"old","prototype":{"value":1},"__proto__":{"own":true},"":"empty-key"}');
    Object.defineProperty(initial,'__proto__',{value:{saved:'top-level legacy data'},enumerable:true,writable:true,configurable:true});
    const session=createCadSession(initial),{records}=observe(session);
    // Ordinary model edits must remain available with opaque legacy metadata.
    session.rename('Legacy project');
    const rename=applyRecord(records);session.undo();session.executeCommand(rename.text);
    expect(Object.getPrototypeOf(session.state.document)).toBe(Object.prototype);
    expect(Object.hasOwn(session.state.document,'__proto__')).toBe(true);
    expect((session.state.document as unknown as Record<string,unknown>).__proto__).toEqual({saved:'top-level legacy data'});
    // Editing existing opaque names must not interpret them as object prototypes.
    session.editAssembly('Legacy properties',draft=>{
      const opaque=(draft as unknown as {opaque:Record<string,unknown>}).opaque;
      opaque.constructor='new';opaque.prototype={value:2};opaque.__proto__={own:'updated'};opaque['']='changed';
      (draft as unknown as {__proto__:{saved:string}}).__proto__.saved='updated top-level legacy data';
    });
    const expected=session.serialize(),record=applyRecord(records);
    session.undo();session.executeCommand(record.text);expect(session.serialize()).toBe(expected);
    expect(Object.getPrototypeOf(session.state.document)).toBe(Object.prototype);
    expect(Object.getPrototypeOf((session.state.document as unknown as {opaque:object}).opaque)).toBe(Object.prototype);
    const unsafe={...structuredClone(record.command),changes:[{path:['missing','__proto__','polluted'],before:{present:false as const},after:{present:true as const,value:true}}]};
    expect(()=>session.executeCommand(unsafe)).toThrow(/stale/);
    expect(({} as {polluted?:boolean}).polluted).toBeUndefined();
  });

  it('compares opaque arrays using saved JSON slots and keeps their replayable before-values',()=>{
    const initial=createDocument() as ReturnType<typeof createDocument>&{opaque:{items:unknown[];optional?:unknown}};
    initial.opaque={items:Array(1),optional:undefined};
    const session=createCadSession(initial),{records}=observe(session),before=session.serialize();
    session.editAssembly('Clear opaque slots',draft=>{(draft as unknown as typeof initial).opaque.items=[];});
    const record=applyRecord(records);
    expect(record.command.changes).toEqual([{path:['opaque','items'],before:{present:true,value:[null]},after:{present:true,value:[]}}]);
    session.undo();expect(session.serialize()).toBe(before);session.executeCommand(record.text);
    expect((session.state.document as unknown as typeof initial).opaque.items).toEqual([]);
    const revision=session.state.revision;
    session.editAssembly('Remove omitted metadata',draft=>{delete (draft as unknown as typeof initial).opaque.optional;});
    expect(session.state.revision).toBe(revision);
  });

  it('rejects sparse command identifiers and paths before touching live state',()=>{
    const session=createCadSession(),{records}=observe(session);session.add(box());
    const valid=structuredClone(applyRecord(records).command),revision=session.state.revision,history=session.history;
    const sparse=Array(1) as string[];
    for(const command of [
      {version:1 as const,kind:'select' as const,ids:sparse},
      {...valid,selection:sparse},
      {...valid,changes:[{path:sparse,before:{present:false as const},after:{present:true as const,value:'x'}}]},
    ]){
      expect(()=>serializeSessionCommand(command)).toThrow();
      expect(()=>session.executeCommand(command)).toThrow();
    }
    expect(session.state.revision).toBe(revision);expect(session.history).toEqual(history);
  });

  it('records deeply nested but valid saved extension fields without imposing a document depth limit',()=>{
    const initial=createDocument() as ReturnType<typeof createDocument>&{opaque:Record<string,unknown>};
    initial.opaque={};let cursor=initial.opaque;
    for(let i=0;i<160;i++){const child={};cursor.child=child;cursor=child;}cursor.value='before';
    const session=createCadSession(initial),{records}=observe(session);
    session.editAssembly('Deep metadata',draft=>{
      let cursor=(draft as unknown as typeof initial).opaque;
      for(let i=0;i<160;i++)cursor=cursor.child as Record<string,unknown>;
      cursor.value='after';
    });
    const expected=session.serialize(),record=applyRecord(records);
    expect(record.command.changes[0].path).toHaveLength(128);
    session.undo();session.executeCommand(record.text);expect(session.serialize()).toBe(expected);
  });
});
