// SPDX-License-Identifier: BSD-3-Clause
import type {OutlineSolveRequest} from './outline-constraint-solve.js';

declare const solveBrickwrightOutline:(data:string)=>string;
const solverUrl=new URL('../assets/sketch-constraints.dart.js?no-inline',import.meta.url);
let solver:Promise<unknown>|undefined;
self.onmessage=async({data}:MessageEvent<OutlineSolveRequest>)=>{
 try{
  await (solver??=import(/* @vite-ignore */ solverUrl.href));
  self.postMessage(JSON.parse(solveBrickwrightOutline(JSON.stringify(data))));
 }catch{
  self.postMessage({status:'unavailable'});
 }
};
