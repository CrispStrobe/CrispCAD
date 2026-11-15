// SPDX-License-Identifier: BSD-3-Clause
import {expect,it} from 'vitest';
import {Box3,OrthographicCamera,PerspectiveCamera,Vector3,Vector4} from 'three';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {projectedBoxIntersects} from '../packages/editor/src/vendor/box-selection.js';
const viewport={width:1000,height:1000};
it('selects intersecting edges with real perspective and orthographic projections and excludes objects behind the eye',()=>{
  for(const camera of [new PerspectiveCamera(90,1,1,100),new OrthographicCamera(-5,5,5,-5,1,100)]){
    camera.updateMatrixWorld();
    const project=(min:number[],max:number[])=>{
      const box=new Box3(new Vector3(...min),new Vector3(...max)),points:Vector4[]=[];
      for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new Vector4(x,y,z,1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix));
      return points;
    };
    const edge={left:390,right:410,top:440,bottom:460};
    expect(projectedBoxIntersects(project([-1,-1,-5],[1,1,-3]),edge,viewport)).toBe(true);
    expect(projectedBoxIntersects(project([-1,-1,3],[1,1,5]),edge,viewport)).toBe(false);
    expect(projectedBoxIntersects(project([-1,-1,-105],[1,1,-101]),edge,viewport)).toBe(false);
  }
});
it('keeps the vendored interaction source pinned to its recorded hash',()=>{
  const manifest=JSON.parse(readFileSync('docs/brickwright-provenance.json','utf8'));
  const entry=manifest.files.find((entry:{file:string})=>entry.file.endsWith('/box-selection.js'));
  expect(entry.commit).toMatch(/^[a-f0-9]{40}$/);
  expect(createHash('sha256').update(readFileSync(entry.file)).digest('hex')).toBe(entry.sha256);
});
