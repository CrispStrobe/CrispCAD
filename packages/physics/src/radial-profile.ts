// SPDX-License-Identifier: BSD-3-Clause
/** Retain original profile vertices while bounding each skipped chain's distance
 * to its replacement chord. Endpoints and sharp corners survive. This is only
 * candidate generation: actual mesh/compound CSG qualification still decides. */
export function simplifyRadialProfile(profile:readonly (readonly number[])[],tolerance:number):number[]{
 if(profile.length<3)return profile.map((_,i)=>i);
 const keep=new Set([0,profile.length-1]),pending:Array<[number,number]>=[[0,profile.length-1]];
 while(pending.length){const [a,b]=pending.pop()!,A=profile[a],B=profile[b],dx=B[0]-A[0],dy=B[1]-A[1],length=dx*dx+dy*dy;let worst=tolerance*tolerance,split=-1;
  for(let i=a+1;i<b;i++){const p=profile[i],t=length?Math.max(0,Math.min(1,((p[0]-A[0])*dx+(p[1]-A[1])*dy)/length)):0,d=(p[0]-A[0]-t*dx)**2+(p[1]-A[1]-t*dy)**2;if(d>worst){worst=d;split=i;}}
  if(split>=0){keep.add(split);pending.push([a,split],[split,b]);}
 }
 return [...keep].sort((a,b)=>a-b);
}
