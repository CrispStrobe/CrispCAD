// SPDX-License-Identifier: BSD-3-Clause
// CAD Script language revisions in documents (docs/CODE-MODE.md#language-revisions).
//
// Revision 1 and 2 differ only in `loft`: revision 1 splits each side quad along a fixed
// diagonal, revision 2 builds the ruled surface. The revision belongs to the program, so a
// document can hold old and new programs side by side and a saved program never changes its
// geometry. Rules, applied by every session commit:
//  - a program that does not call `loft` is stored at revision 1, where both revisions agree, so
//    documents without lofts stay readable by SDKs that predate revision 2;
//  - a new program keeps the revision it was created with (new content uses
//    CAD_SCRIPT_REVISION; copies, pastes and JSCAD imports keep revision 1 lofts);
//  - an edit of an existing program never introduces revision-1 lofts: only a program that
//    already called `loft` at revision 1 keeps revision 1 when edited;
//  - a document holding a revision-2 program is document version 42.
import {compileCode} from './code.js';
import type {CodeProgram} from './code.js';
import type {CadDocument} from './document.js';
import {sameModelValue} from './model-source.js';

const loftUse=new WeakMap<CodeProgram,boolean>();
/** True when the source calls `loft` anywhere; undefined when the program does not compile. */
export function programUsesLoft(program:CodeProgram):boolean|undefined{
 if(loftUse.has(program))return loftUse.get(program);
 let uses:boolean|undefined;
 try{uses=compileCode(program).usesLoft;}catch{uses=undefined;}
 if(uses!==undefined&&Object.isFrozen(program))loftUse.set(program,uses);
 return uses;
}
/** A revision-1 program with a loft: its lofts are triangulated along the fixed diagonal. */
export function hasTriangulatedLofts(program:CodeProgram):boolean{
 return program.version===1&&programUsesLoft(program)===true;
}
/** Apply the revision rules to the code nodes a commit changed (`previous` → `draft`). */
export function normalizeCodeRevisions(previous:CadDocument,draft:CadDocument):void{
 let ruled=false;
 for(const [id,node] of Object.entries(draft.nodes)){
  if(node.kind!=='code')continue;
  const before=previous.nodes[id],old=before?.kind==='code'?before.program:undefined;
  if(old&&(old===node.program||sameModelValue(old,node.program))){ruled||=node.program.version===2;continue;}
  let revision=node.program.version;
  if(old&&revision===1&&!hasTriangulatedLofts(old))revision=2;
  if(revision===2&&programUsesLoft(node.program)===false)revision=1;
  if(revision!==node.program.version)draft.nodes[id]={...node,program:{...node.program,version:revision}};
  ruled||=revision===2;
 }
 if(ruled&&draft.version<42)draft.version=42;
}
