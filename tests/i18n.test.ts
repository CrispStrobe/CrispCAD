import {afterEach,expect,it} from 'vitest';
import {createCadSession,createDocument,defaultCodeProgram,setLocale,getLocale,t,translateHistoryLabel,serializeDocument,parseDocument,compileCode} from '@brickwright/cad-core';
afterEach(()=>setLocale('en'));
it('localizes diagnostics and new defaults while preserving saved names, code and numeric definitions',()=>{
 const session=createCadSession(createDocument('My unübersetztes model'));const program=defaultCodeProgram(),id=session.addCode(program,'User shape');const raw=serializeDocument(session.state.document);setLocale('de-DE');expect(getLocale()).toBe('de');expect(t('Shapes')).toBe('Formen');expect(createDocument().title).toBe('Unbenanntes Modell');expect(parseDocument(raw)).toEqual(session.state.document);expect(parseDocument(raw).nodes[id].name).toBe('User shape');expect(()=>compileCode({...program,source:'return nonsense;'})).toThrow('Zeile');expect(t`Edit ${'Custom {1} <name>'}`).toContain('Custom {1} <name>');setLocale('en');expect(t('Shapes')).toBe('Shapes');expect(serializeDocument(session.state.document)).toBe(raw);
});
it('translates known history labels for display and keeps arbitrary labels intact',()=>{
 setLocale('de');expect(translateHistoryLabel('Place shape')).toBe('Form platzieren');expect(translateHistoryLabel('Change solid/hole role')).toBe('Körper/Bohrung ändern');expect(translateHistoryLabel('Transform selection')).not.toBe('Transform selection');expect(translateHistoryLabel('Restored iteration 42')).toContain('42');expect(translateHistoryLabel('Customer milestone: screw v2')).toBe('Customer milestone: screw v2');setLocale('fr');expect(getLocale()).toBe('en');expect(translateHistoryLabel('Add code object')).toBe('Add code object');
});
