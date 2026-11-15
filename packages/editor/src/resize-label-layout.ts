// SPDX-License-Identifier: BSD-3-Clause
export interface ScreenRect{left:number;top:number;right:number;bottom:number}
export interface DimensionEdge{p:readonly number[];q:readonly number[]}
const intersects=(a:ScreenRect,b:ScreenRect)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
/** Keep dimension numbers outside the selected footprint, on their dimension
 * lines. If there is no room, hide rather than clamp them onto the object. */
export function dimensionLabel(edges:readonly DimensionEdge[],object:ScreenRect,view:{width:number;height:number},occupied:readonly ScreenRect[],width:number,height=22){
 const cx=(object.left+object.right)/2,cy=(object.top+object.bottom)/2;
 for(const {p,q}of edges){const mx=(p[0]+q[0])/2,my=(p[1]+q[1])/2,dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);let nx=length>.01?-dy/length:Math.sign(mx-cx)||1,ny=length>.01?dx/length:0;if((mx-cx)*nx+(my-cy)*ny<0){nx=-nx;ny=-ny;}
  const placed=axisLabel([mx,my],[nx,ny],object,view,occupied,width,height);if(placed)return {...placed,p:[p[0]+nx*placed.offset,p[1]+ny*placed.offset],q:[q[0]+nx*placed.offset,q[1]+ny*placed.offset]};
 }
 return undefined;
}

/** Place an axis value along its actual projected direction, beyond the body. */
export function axisLabel(point:readonly number[],direction:readonly number[],object:ScreenRect,view:{width:number;height:number},occupied:readonly ScreenRect[],width:number,height=22){
 const [mx,my]=point,[nx,ny]=direction;if(Math.hypot(nx,ny)<.1)return undefined;
  const escape=[nx>1e-8?(object.right+8+width/2-mx)/nx:nx< -1e-8?(object.left-8-width/2-mx)/nx:Infinity,ny>1e-8?(object.bottom+8+height/2-my)/ny:ny< -1e-8?(object.top-8-height/2-my)/ny:Infinity].filter(v=>v>=0);
  if(mx-width/2>=object.right+8||mx+width/2<=object.left-8||my-height/2>=object.bottom+8||my+height/2<=object.top-8)escape.push(0);
  const start=Math.max(18,12+width/2*Math.abs(nx)+height/2*Math.abs(ny),Math.min(...escape));
  for(let step=0;step<12;step++){const offset=start+step*12,x=mx+nx*offset,y=my+ny*offset,rect={left:x-width/2,top:y-height/2,right:x+width/2,bottom:y+height/2};if(rect.left<5||rect.right>view.width-5||rect.top<5||rect.bottom>view.height-48)continue;if(intersects(rect,object)||occupied.some(o=>intersects(rect,{left:o.left-4,top:o.top-4,right:o.right+4,bottom:o.bottom+4})))continue;return {x,y,rect,offset};}
 return undefined;
}
