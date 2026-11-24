// SPDX-License-Identifier: BSD-3-Clause
// Runs kernelCAD's MIT sketch relaxation solver (copied in ./kcad) on the ladder fixture.
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ts from 'typescript';
const here=new URL('.',import.meta.url).pathname,fixture=JSON.parse(readFileSync(join(here,'fixture.json'),'utf8'));
const out=mkdtempSync(join(tmpdir(),'kcad-solver-'));
for(const f of ['solver','types'])writeFileSync(join(out,`${f}.mjs`),ts.transpileModule(readFileSync(join(here,'kcad',`${f}.ts`),'utf8').replace('from "./types"','from "./types.mjs"'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const {ConstraintSolver}=await import(join(out,'solver.mjs'));
const width=i=>10+(i%3),height=8,jitter=k=>1.5*Math.sin(k*12.9898+78.233);
function expected(n,first){const xs=[0];for(let i=0;i<n;i++)xs.push(xs[i]+(i===0?first:width(i)));return xs;}
function build(n){const entities=new Map(),constraints=[];let k=0,c=0;const xs=expected(n,width(0));
 for(let i=0;i<=n;i++){entities.set(`b${i}`,{id:`b${i}`,type:'POINT',x:i===0?0:xs[i]+jitter(++k),y:i===0?0:jitter(++k),fixed:i===0});entities.set(`t${i}`,{id:`t${i}`,type:'POINT',x:xs[i]+jitter(++k),y:height+jitter(++k),fixed:false});}
 const add=(type,entities,value)=>constraints.push({id:`c${++c}`,type,entities,...(value===undefined?{}:{value})});
 for(let i=0;i<n;i++){add('HORIZONTAL',[`b${i}`,`b${i+1}`]);add('HORIZONTAL',[`t${i}`,`t${i+1}`]);add('DISTANCE',[`b${i}`,`b${i+1}`],width(i));}
 for(let i=0;i<=n;i++)add('VERTICAL',[`b${i}`,`t${i}`]);add('DISTANCE',['b0','t0'],height);
 return {entities,constraints};}
function error(state,n,first){const xs=expected(n,first);let e=0;for(let i=0;i<=n;i++){const b=state.entities.get(`b${i}`),t=state.entities.get(`t${i}`);e=Math.max(e,Math.abs(b.x-xs[i]),Math.abs(b.y),Math.abs(t.x-xs[i]),Math.abs(t.y-height));}return e;}
// Optional --iterations N overrides the shipped 100-sweep cap (private field) to separate configuration from method.
const cap=process.argv.includes('--iterations')?Number(process.argv[process.argv.indexOf('--iterations')+1]):undefined;
const solver=new ConstraintSolver(),results=[];if(cap)solver.iterations=cap;
for(const n of fixture.sizes){const state=build(n);let clock=performance.now();const cold=solver.solve(state),coldMs=performance.now()-clock,coldError=error(state,n,width(0));const warm=[],errors=[],converged=[];
 for(let s=0;s<fixture.samples+fixture.warmups;s++){const first=s%2?10:12;state.constraints.find(c=>c.type==='DISTANCE'&&c.entities[0]==='b0'&&c.entities[1]==='b1').value=first;clock=performance.now();const r=solver.solve(state);const ms=performance.now()-clock;if(s>=fixture.warmups){warm.push(ms);errors.push(error(state,n,first));converged.push(r.converged);}}
 const sorted=[...warm].sort((a,b)=>a-b);
 results.push({solver:'kernelCAD relaxation',iterationCap:cap??100,bays:n,coordinates:4*(n+1),constraints:state.constraints.length,cold:{ms:coldMs,converged:cold.converged,reportedResidual:cold.residual,iterations:cold.iterations,maxCoordinateErrorMm:coldError},medianEditMs:sorted[sorted.length>>1],maxEditCoordinateErrorMm:Math.max(...errors),editsReportedConverged:converged.filter(Boolean).length,edits:converged.length});}
process.stdout.write(JSON.stringify({runtime:`node ${process.version}`,results},null,1)+'\n');
