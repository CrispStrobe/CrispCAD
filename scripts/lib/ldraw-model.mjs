// SPDX-License-Identifier: BSD-3-Clause
// Original bounded archival converter, based on the published LDraw format/BFC specifications.
// No filesystem, renderer implementation, primitive substitution, welding or repair.
import {compileCode} from '../../packages/core/dist/index.js';

const pathKey = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(value) || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Invalid LDraw bundle path.');
  return value.toLowerCase();
};
// Exact decimal affine arithmetic: index mathematically identical authored vertices.
// No epsilon merge or coordinate rounding. Precision refusals bound BigInt work.
const rational=(n,d=1n)=>{if(d===0n)throw Error('Invalid exact denominator.');if(d<0n){n=-n;d=-d;}let a=n<0n?-n:n,b=d;while(b){const t=a%b;a=b;b=t;}n/=a||1n;d/=a||1n;if(n.toString().length>256||d.toString().length>256)throw Error('LDraw exact arithmetic precision budget exceeded.');return[n,d];};
const add=(a,b)=>rational(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
const mul=(a,b)=>rational(a[0]*b[0],a[1]*b[1]);
const neg=a=>[-a[0],a[1]],sub=(a,b)=>add(a,neg(b));
const decimal=s=>{const [mantissa,exponent='0']=s.toLowerCase().split('e'),negative=mantissa.startsWith('-'),unsigned=mantissa.replace(/^[+-]/,''),[whole,fraction='']=unsigned.split('.'),power=Number(exponent)-fraction.length,digits=whole+fraction;if(digits.length>128||Math.abs(power)>128)throw Error('LDraw decimal precision budget exceeded.');return power>=0?rational(BigInt(digits)*(negative?-1n:1n)*10n**BigInt(power)):rational(BigInt(digits)*(negative?-1n:1n),10n**BigInt(-power));};
const value=a=>Number(a[0])/Number(a[1]),zero=rational(0n),one=rational(1n),unit=rational(2n,5n);
const identity=[one,zero,zero,zero,zero,one,zero,zero,zero,zero,one,zero];
const determinant=m=>add(sub(mul(m[0],sub(mul(m[5],m[10]),mul(m[6],m[9]))),mul(m[1],sub(mul(m[4],m[10]),mul(m[6],m[8])))),mul(m[2],sub(mul(m[4],m[9]),mul(m[5],m[8]))));
const transform=(m,p)=>[0,1,2].map(r=>add(add(add(mul(m[4*r],p[0]),mul(m[4*r+1],p[1])),mul(m[4*r+2],p[2])),m[4*r+3]));
const compose=(a,b)=>[0,1,2].flatMap(r=>[0,1,2,3].map(c=>add(add(add(mul(a[4*r],b[c]),mul(a[4*r+1],b[4+c])),mul(a[4*r+2],b[8+c])),c===3?a[4*r+3]:zero)));
// https://ldraw.org/article/512.html: LDraw permits slightly warped quads, whereas
// native polyhedron faces must be planar. Preserve exact vertices; use a fixed
// diagonal only for validated convex quads that fail native planarity.
function nativeFaces(face,points){
 if(face.length!==4)return[face];
 const p=face.map(i=>points[i]),sub3=(a,b)=>a.map((v,i)=>v-b[i]),cross3=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot3=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
 const normal=[0,0,0];for(let i=0;i<4;i++){const a=p[i],b=p[(i+1)%4];normal[0]+=(a[1]-b[1])*(a[2]+b[2]);normal[1]+=(a[2]-b[2])*(a[0]+b[0]);normal[2]+=(a[0]-b[0])*(a[1]+b[1]);}
 const length=Math.hypot(...normal),extent=Math.max(1,...p.flatMap(a=>a.map((v,i)=>Math.abs(v-p[0][i]))));if(length===0)throw Error('Degenerate LDraw quad refused.');
 if(p.every(a=>Math.abs(dot3(sub3(a,p[0]),normal)/length)<=extent*1e-7))return[face];
 // Both diagonals must have consistently oriented, nonzero normals; the ordinary
 // <1degree LDraw criterion is stricter than the justified3degree exception.
 for(let i=0;i<2;i++){const a=p[i],b=p[(i+1)%4],c=p[(i+2)%4],d=p[(i+3)%4],n1=cross3(sub3(b,a),sub3(c,a)),n2=cross3(sub3(c,a),sub3(d,a)),l1=Math.hypot(...n1),l2=Math.hypot(...n2);if(!l1||!l2||dot3(n1,n2)/(l1*l2)<=Math.cos(Math.PI/180))throw Error('LDraw quad exceeds supported coplanarity or convexity.');}
 return[[face[0],face[1],face[2]],[face[0],face[2],face[3]]];
}

/** Accept only a complete, certified, single-colour geometry bundle. Preserve authored facets.
 * Original/expanded byte32KiB, files32, depth32, instances1024, construction work16384,
 * points/faces256 and the native compiler's existing budgets all remain hard bounds.
 */
export function convertLDrawBundle({rootPath,files}) {
  if (!Array.isArray(files) || !files.length || files.length>32) throw Error('LDraw bundle exceeds32files.');
  const bundle=new Map();let originalBytes=0,expandedBytes=0,work=0,instances=0;
  for (const file of files) {
    const path=pathKey(file.path);if(bundle.has(path)||!(file.bytes instanceof Uint8Array))throw Error('Duplicate or invalid LDraw source.');
    const bytes=file.bytes.slice();originalBytes+=bytes.length;if(originalBytes>32768)throw Error('LDraw original source exceeds32768bytes.');
    bundle.set(path,new TextDecoder('latin1').decode(bytes));
  }
  const root=pathKey(rootPath);if(!bundle.has(root))throw Error('LDraw root is missing.');
  const points=[],faces=[],pointIndex=new Map(),active=new Set(),visited=new Set(),edges=[];
  const charge=()=>{if(++work>16384)throw Error('LDraw construction work exceeds16384.');};
  const resolve=(ref)=>{ref=pathKey(ref.replaceAll('\\','/'));const candidates=['parts/'+ref,'p/'+ref];const found=candidates.find(p=>bundle.has(p));if(!found)throw Error('Missing LDraw dependency: '+ref);return found;};
  const numbers=(tokens,count)=>{if(tokens.length!==count)throw Error('Invalid LDraw numeric record arity.');return tokens.map(s=>{if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s))throw Error('Invalid LDraw number.');const n=Number(s);if(!Number.isFinite(n)||Math.abs(n)>1e6)throw Error('LDraw numeric range exceeded.');return decimal(s);});};
  const vertex=(m,v)=>{charge();const [x,y,z]=transform(m,v),exact=[mul(x,unit),mul(z,unit),neg(mul(y,unit))],p=exact.map(value);if(p.some(n=>!Number.isFinite(n)||Math.abs(n)>100000))throw Error('LDraw transformed coordinate exceeded native bounds.');const key=exact.map(v=>v.join('/')).join(',');if(!pointIndex.has(key)){if(points.length>=256)throw Error('LDraw point array exceeds256.');pointIndex.set(key,points.length);points.push(p);}return pointIndex.get(key);};
  function visit(path,m,inverted,depth) {
    if(depth>32||active.has(path))throw Error('LDraw dependency depth/cycle refused.');
    if(++instances>1024)throw Error('LDraw expanded instances exceed1024.');
    const text=bundle.get(path);expandedBytes+=files.find(f=>pathKey(f.path)===path).bytes.length;if(expandedBytes>32768)throw Error('LDraw expanded source exceeds32768bytes.');
    active.add(path);visited.add(path);let certified=false,cw=false,invertNext=false;
    try{for(const raw of text.split(/\r?\n/)){
      if(!raw.trim())continue;charge();const t=raw.trim().split(/\s+/),kind=t[0];
      if(kind==='0'){
        if(t[1]==='BFC'){
          const command=t.slice(2).join(' ');
          if(command==='CERTIFY CCW'||command==='CERTIFY'){certified=true;cw=false;}
          else if(command==='CERTIFY CW'){certified=true;cw=true;}
          else if(command==='CW'||command==='CLIP CW')cw=true;
          else if(command==='CCW'||command==='CLIP CCW')cw=false;
          else if(command==='INVERTNEXT'){if(invertNext)throw Error('Repeated BFC INVERTNEXT.');invertNext=true;}
          else if(command!=='CLIP')throw Error('Unsupported LDraw BFC directive: '+command);
        }else if(['!TEXMAP','!DATA'].includes(t[1]))throw Error('LDraw external texture/data unsupported.');
        continue;
      }
      if(!certified)throw Error('Uncertified LDraw geometry refused.');
      if(!['1','2','3','4','5'].includes(kind))throw Error('Unsupported LDraw record.');
      if(invertNext&&kind!=='1')throw Error('BFC INVERTNEXT requires a subfile.');
      if(kind==='1'){
        if(t[1]!=='16')throw Error('LDraw fixed-colour subfile unsupported.');
        const a=numbers(t.slice(2,14),12),local=[a[3],a[4],a[5],a[0],a[6],a[7],a[8],a[1],a[9],a[10],a[11],a[2]],det=determinant(local);if(det[0]===0n)throw Error('Singular LDraw transform refused.');
        const target=resolve(t.slice(14).join(' '));edges.push({from:path,to:target});visit(target,compose(m,local),inverted !== (invertNext !== (det[0] < 0n)),depth+1);invertNext=false;
      }else if(kind==='3'||kind==='4'){
        if(t[1]!=='16')throw Error('LDraw fixed-colour face unsupported.');const n=kind==='3'?3:4,a=numbers(t.slice(2),n*3);let face=Array.from({length:n},(_,i)=>vertex(m,a.slice(3*i,3*i+3)));if(inverted!==cw)face.reverse();if(new Set(face).size!==face.length)throw Error('Degenerate LDraw face refused.');const emitted=nativeFaces(face,points);if(faces.length+emitted.length>256)throw Error('LDraw face array exceeds256.');if(emitted.length>1)charge();faces.push(...emitted);
      }else numbers(t.slice(2),kind==='2'?6:12); // authored line/conditional-edge display is not solid geometry
    }if(invertNext)throw Error('Dangling BFC INVERTNEXT.');}finally{active.delete(path);}
  }
  visit(root,identity,false,0);
  if(visited.size!==bundle.size)throw Error('Unused/undeclared LDraw closure files refused.');
  if(points.length<4||faces.length<4)throw Error('LDraw source has no volumetric construction.');
  const program={version:1,language:'brickwright-cad-script',parameters:{},source:'// Original LDraw facets; nominal0.4mm/LDU and -Y-up to Z-up.\nreturn polyhedron('+JSON.stringify(points)+', '+JSON.stringify(faces)+');\n'};
  const compiled=compileCode(program);
  return {program,compiled,points,faces,edges,metrics:{originalBytes,expandedBytes,instances,work,points:points.length,faces:faces.length},warnings:['Original display edge/conditional-edge lines and inherited colour appearance are omitted; all authored solid faces are retained. No primitive substitution or mesh repair.']};
}
