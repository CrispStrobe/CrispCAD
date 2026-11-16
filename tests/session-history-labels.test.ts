import {expect,it} from 'vitest';
import {createCadSession} from '@brickwright/cad-core';
it('exposes exact edit labels and depths through undo, branching, redo and project replacement',()=>{
 const s=createCadSession();s.rename('First');s.rename('Second');s.rename('Third');
 expect(s.history.past).toEqual(['Rename design','Rename design','Rename design']);expect(s.history.future).toEqual([]);
 s.undo();s.undo();expect(s.state.document.title).toBe('First');expect(s.history.past).toHaveLength(1);expect(s.history.future).toHaveLength(2);
 s.redo();expect(s.state.document.title).toBe('Second');expect(s.history.future).toHaveLength(1);
 s.rename('Branch');expect(s.history.future).toEqual([]);expect(s.history.past).toHaveLength(3);
 s.load(s.serialize());expect(s.history).toEqual({past:[],future:[]});
});
