// SPDX-License-Identifier: BSD-3-Clause
// Admission selection only: no geometry/source rewriting and no ambient filesystem.
export function reviewLDrawAuthoredRoot({rootPath,source,meshSha256,knownMeshByRoot={}}){
 const text=typeof source==='string'?source:new TextDecoder('latin1').decode(source);
 const lines=text.split(/\r?\n/),title=(lines[0]??'').replace(/^0\s+/,''),role=lines.find(l=>/^0\s+!LDRAW_ORG\s/.test(l))??'';
 if(/\bAlias\b/i.test(role)||/^[~\s]*[=_]/.test(title))return{eligible:false,cause:'declared_alias_not_distinct_authored_root',rootPath};
 const geometry=lines.map(l=>l.trim()).filter(l=>/^[1-5]\s/.test(l));
 if(geometry.length===1){
  const t=geometry[0].split(/\s+/),identity=['0','0','0','1','0','0','0','1','0','0','0','1'];
  if(t.length===15&&t[0]==='1'&&t[1]==='16'&&t.slice(2,14).every((v,i)=>Number(v)===Number(identity[i]))){
   const reference=t.slice(14).join(' ').replaceAll('\\','/').toLowerCase(),target=reference.startsWith('parts/')?reference:'parts/'+reference;
   if(knownMeshByRoot[target]===meshSha256)return{eligible:false,cause:'identity_only_wrapper_of_existing_geometry',rootPath,target};
  }
 }
 const replacement=text.match(/\bObsoleted\.?\s+Use\s+([a-z0-9_./-]+?)(?:\.dat)?\s+instead\b/i);
 if(replacement){
  const reference=replacement[1].toLowerCase().replace(/\.dat$/,''),target=(reference.startsWith('parts/')?reference:'parts/'+reference)+'.dat';
  if(knownMeshByRoot[target]===meshSha256)return{eligible:false,cause:'explicitly_superseded_identical_geometry',rootPath,target};
 }
 return{eligible:true,cause:'authored_root_not_alias_or_known_identity_duplicate',rootPath};
}
