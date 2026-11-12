import {it,expect,vi} from 'vitest';
import {newId,sha256Hex,createCadSession} from '@brickwright/cad-core';
it('native custom-scheme hosts retain secure UUIDs and identical SHA-256 without secure-context-only APIs',async()=>{
 const original=globalThis.crypto;vi.stubGlobal('crypto',{getRandomValues:original.getRandomValues.bind(original)});
 try{const ids=new Set(Array.from({length:1000},()=>newId()));expect(ids.size).toBe(1000);expect([...ids].every(id=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');const session=createCadSession();session.add({kind:'box',size:[10,20,30]});expect(session.state.document.roots).toHaveLength(1);}finally{vi.unstubAllGlobals();}
});
