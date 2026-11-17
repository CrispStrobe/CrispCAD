import {mountConnectorHandles} from './connector-handles.js';
import type {TracePath} from './motion-traces.js';
import type {SimulationPoint} from './simulation-authoring.js';
import {simulationTracers,localToWorldPoint} from '@brickwright/cad-core';
import type {SimulationPose} from './simulation-protocol.js';
// SPDX-License-Identifier: BSD-3-Clause
import * as THREE from 'three';
import {selectionRectangle,projectedBoxIntersects} from './vendor/box-selection.js';
import {surfaceMove} from './surface-move.js';
import {createMeshBounds} from './mesh-bounds.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {createSurfacePlacement} from './surface-placement.js';
import type {PlacementPointer} from './surface-placement.js';
import {PrecisionControls} from './precision-controls.js';
import {cameraWheelAction,cameraPointerAction} from './camera-input.js';
import type {NavigationPreset,CameraWheel} from './camera-input.js';
import {precisionTracker} from './precision.js';
import {assertDrivenEdit,isCube,constrainCubeTransform,t} from '@brickwright/cad-core';
import type { CadSession, Transform, Vec3 } from '@brickwright/cad-core';
import type { GeometryResult } from '@brickwright/cad-geometry';
import { TOUCH_SLOP_PX, createTouchTracker } from './vendor/touch-gestures.js';
import {displayGridSpacing,workplaneGridGeometry,type GridDisplay} from './workplane-grid.js';
import {surfaceGeometry} from './surface-geometry.js';
import {componentAppearance} from './component-appearance.js';
import {mountResizeControls} from './resize-controls.js';
import type {ResizeFrame} from './resize-math.js';
import {resizedTransforms} from './resize-math.js';
import {scalePivotRotation,applyGizmoDelta,transformMatrix} from './transform-selection.js';
import type {TransformPreview,TransformAxisAnchor} from './transform-readout.js';
import { snapDelta } from './vendor/transform-math.js';
const RAD = Math.PI / 180;
export type ViewDirection = 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left' | 'iso';
const directions: Record<ViewDirection, [number, number, number]> = { top: [0, -0.00001, 1], bottom: [0, -0.00001, -1], front: [0, -1, 0], back: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0], iso: [1, -1.4, 1] };
export function mountViewport(container: HTMLElement, session: CadSession, onError: (e: unknown) => void,appearance?:{background:string;baseplate:string}) {
  const colours={background:'#111e29',baseplate:'#233644',...appearance};const validColour=(value:string)=>/^#[0-9a-f]{6}$/i.test(value);if(!validColour(colours.background)||!validColour(colours.baseplate))throw new Error(t('Choose a six-digit colour'));
  const scene = new THREE.Scene(); scene.background = new THREE.Color(colours.background);
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 200000); camera.up.set(0, 0, 1); camera.position.set(180, -250, 220);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; const canvas = renderer.domElement;
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', t('3D workplane')); canvas.dataset.testid = 'cad-canvas'; container.append(canvas);
  const orbit = new OrbitControls(camera, canvas); orbit.target.set(0, 0, 10); orbit.enableDamping = false;
  orbit.maxPolarAngle = Math.PI * 0.98; orbit.minDistance = 2; orbit.maxDistance = 100000;
  orbit.touches.ONE = THREE.TOUCH.ROTATE; orbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  const lights = new THREE.HemisphereLight(0xb9d6ef, 0x304555, 2.4); lights.up.set(0, 0, 1); scene.add(lights);
  const key = new THREE.DirectionalLight(0xffe9ca, 3.2); key.position.set(-70, -90, 150); scene.add(key);
  const fill = new THREE.DirectionalLight(0x91c9ff, 1.5); fill.position.set(80, 50, 50); scene.add(fill);
  const workplane = new THREE.Group(); scene.add(workplane);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: colours.baseplate, side: THREE.DoubleSide })); plate.position.z = -0.14; workplane.add(plate);canvas.dataset.backgroundColour=colours.background;canvas.dataset.baseplateColour=colours.baseplate;
  const grid = new THREE.GridHelper(400, 400, '#52677a', '#2f4655'); grid.rotation.x = 0; grid.position.z = -0.1; workplane.add(grid);
  const majorGrid = new THREE.GridHelper(400, 40, '#8c9c99', '#536861'); majorGrid.rotation.x = 0; majorGrid.position.z = -0.08; workplane.add(majorGrid);
  plate.material.depthWrite=false;plate.renderOrder=-10;
  for(const lines of [grid,majorGrid]){lines.material.depthWrite=false;lines.material.transparent=true;lines.renderOrder=lines===grid?-9:-8;}majorGrid.material.opacity=.55;grid.material.opacity=.4;
  const border = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-200,-200,0), new THREE.Vector3(200,-200,0), new THREE.Vector3(200,200,0), new THREE.Vector3(-200,200,0)]), new THREE.LineBasicMaterial({ color: '#c5a35d' })); workplane.add(border);
  const axes = new THREE.AxesHelper(45); scene.add(axes);
  const textSprites: THREE.Sprite[] = [];
  function label(text: string, x: number, y: number, color = '#afc1c9') {
    const bitmap = document.createElement('canvas'); bitmap.width = 256; bitmap.height = 64; const ctx = bitmap.getContext('2d')!;
    ctx.font = '500 32px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.fillText(text, 128, 32);
    const texture = new THREE.CanvasTexture(bitmap); texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false, transparent: true })); sprite.position.set(x, y, 0.2); sprite.scale.set(23, 5.75, 1); workplane.add(sprite); textSprites.push(sprite);
  }
  for (let n = -200; n <= 200; n += 50) { label(String(n), n, -208); label(String(n), -210, n); }
  label('X · mm', 224, -200, '#f38f88'); label('Y · mm', -200, 218, '#8fcea1');
  const pivot = new THREE.Object3D(); scene.add(pivot);
  const gizmo = new PrecisionControls(camera, canvas); gizmo.setSize(0.85); gizmo.setSpace('world'); scene.add(gizmo.getHelper());
  let navigationPreset:NavigationPreset='tinkercad',spaceHeld=false;let cameraDrag:{id:number;x:number;y:number;kind:'pan'|'orbit';gizmoEnabled:boolean}|undefined;
  let fineEnabled=false,shiftHeld=false;gizmo.isFine=()=>fineEnabled||shiftHeld;
  gizmo.setTranslationSnap(1); gizmo.setRotationSnap(15 * RAD); gizmo.setScaleSnap(null);
  let simulating=false;let presentedPoses=new Map<string,SimulationPose>();
  const previewBalls=new Map<string,THREE.Mesh>();
  let simulationDrag:((value:{bodyId:string;point:Vec3;target:Vec3}|null)=>void)|undefined,grabEnabled=false,grab:{pointerId:number;bodyId:string;point:Vec3;plane:THREE.Plane;target:Vec3;pending?:number;orbit:boolean}|undefined;
  function endGrab(){if(!grab)return;const old=grab;grab=undefined;if(old.pending!==undefined)cancelAnimationFrame(old.pending);orbit.enabled=old.orbit;if(canvas.hasPointerCapture(old.pointerId))canvas.releasePointerCapture(old.pointerId);simulationDrag?.(null);}

  function clearPreviewBalls(){for(const mesh of previewBalls.values()){scene.remove(mesh);mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();}previewBalls.clear();}
  const traceGroup=new THREE.Group();scene.add(traceGroup);
  const traceLines=new Map<string,{line:THREE.Line;marker:THREE.Mesh}>();
  let pointPick:{done:(point:SimulationPoint|null)=>void;gizmo:boolean;cursor:string}|undefined;
  function cancelPointPick(){if(!pointPick)return;const previous=pointPick;pointPick=undefined;gizmo.enabled=previous.gizmo;canvas.style.cursor=previous.cursor;previous.done(null);}
  // Poses and traces arrive together. Coalesce their invalidations into one
  // browser frame; synchronous rendering here drew the same scene twice.
  function showTraces(paths:TracePath[]){
   const definitions=simulationTracers(session.state.document),byId=new Map(paths.map(path=>[path.id,path]));
   for(const [id,objects]of traceLines)if(!definitions.some(trace=>trace.id===id)){traceGroup.remove(objects.line,objects.marker);objects.line.geometry.dispose();(objects.line.material as THREE.Material).dispose();objects.marker.geometry.dispose();(objects.marker.material as THREE.Material).dispose();traceLines.delete(id);}
   for(const trace of definitions){let objects=traceLines.get(trace.id);if(!objects){const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(2000*3),3).setUsage(THREE.DynamicDrawUsage));const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:trace.color})),marker=new THREE.Mesh(new THREE.SphereGeometry(1.5,8,4),new THREE.MeshBasicMaterial({color:trace.color}));line.frustumCulled=false;traceGroup.add(line,marker);objects={line,marker};traceLines.set(trace.id,objects);}
    const sourcePoint=new THREE.Vector3(...localToWorldPoint(trace.point,session.state.document.nodes[trace.bodyId].transform)),pose=presentedPoses.get(trace.bodyId);if(pose)sourcePoint.applyQuaternion(new THREE.Quaternion(...pose.quaternion as [number,number,number,number])).add(new THREE.Vector3(...pose.positionMm as [number,number,number]));
    const recorded=byId.get(trace.id)?.samples,samples=recorded?.length?recorded:[{time:0,point:sourcePoint.toArray() as Vec3}],attribute=objects.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    for(let i=0;i<samples.length;i++)attribute.setXYZ(i,...samples[i].point);attribute.needsUpdate=true;objects.line.geometry.setDrawRange(0,samples.length);if(samples.length)objects.marker.position.set(...samples.at(-1)!.point);
   }
   canvas.dataset.motionTraces=String(definitions.length);scheduleDraw();
  }

  const meshes = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>();
  const meshBounds=createMeshBounds();
  const outlines = new Map<string, THREE.LineSegments>(); const ray = new THREE.Raycaster(); const pointer = new THREE.Vector2();
  const marquee=document.createElement('div');marquee.className='cad-selection-rectangle';marquee.hidden=true;container.append(marquee);
  let boxSelect:{pointerId:number;x:number;y:number;additive:boolean;base:string[];moved:boolean;gizmoEnabled:boolean}|undefined;
  function endBox(){if(!boxSelect)return;const id=boxSelect.pointerId;gizmo.enabled=boxSelect.gizmoEnabled;boxSelect=undefined;marquee.hidden=true;orbit.enabled=true;touches.reset();down=null;suppressTap=false;if(canvas.hasPointerCapture(id))canvas.releasePointerCapture(id);}
  let placementCommit:((point:PlacementPointer)=>void)|undefined,placementCanceled:(()=>void)|undefined,placementControls:{rotate:boolean;gizmo:boolean}|undefined;
  let surfaceSnapEnabled=true;canvas.dataset.surfaceSnap='true';
  const moveSurface=createSurfacePlacement(scene,()=>camera,canvas,meshes,()=>session.state.document,()=>gridStep,()=>fineEnabled,()=>surfaceSnapEnabled,'moveSnap');
  const surfacePlacement=createSurfacePlacement(scene,()=>camera,canvas,meshes,()=>session.state.document,()=>gridStep,()=>fineEnabled,()=>surfaceSnapEnabled);
  function endPlacement(notify=true){const wasActive=surfacePlacement.active;surfacePlacement.end();if(placementControls){orbit.enableRotate=placementControls.rotate;gizmo.enabled=placementControls.gizmo;placementControls=undefined;gizmo.getHelper().visible=true;}if(notify&&wasActive)placementCanceled?.();}
  const selectionBoxes=new Map<string,THREE.BoxHelper>();let activeMode:'select'|'translate'|'rotate'|'scale'='select';
  let directDrag:{pointerId:number;start:THREE.Vector3;plane:THREE.Plane;transforms:Map<string,Transform>;offset:Vec3;base:Vec3;updates?:{id:string;transform:Transform}[];moved:boolean;precision:ReturnType<typeof precisionTracker>;usedFine:boolean}|null=null;
  let disposed = false; let selected: string[] = []; let drag: { matrix: THREE.Matrix4; transforms: Map<string, Transform> } | null = null; let gridStep = 1; let multiSelect = false; let viewListener: ((view: ViewDirection) => void) | undefined;
  let gridDisplay:GridDisplay='snap',lastGridSpacing=-1;
  function refreshGrid(){const spacing=displayGridSpacing(gridDisplay,gridStep);canvas.dataset.gridDisplay=String(gridDisplay);canvas.dataset.displayGridSpacing=String(spacing);if(spacing===lastGridSpacing)return;lastGridSpacing=spacing;grid.visible=majorGrid.visible=spacing>0;grid.geometry.dispose();majorGrid.geometry.dispose();grid.geometry=workplaneGridGeometry(spacing,'#52677a','#2f4655');majorGrid.geometry=workplaneGridGeometry(spacing*10,'#8c9c99','#536861');}
  let resizeStyle:'dimensions'|'gizmo'='dimensions';
  let resizeControls:ReturnType<typeof mountResizeControls>|undefined,resizeFrame:ResizeFrame|undefined,resizeDelta:THREE.Matrix4|undefined,resizeFactors:Vec3=[1,1,1];
  const scaleFactors=()=>resizeDelta?resizeFactors:pivot.scale.toArray() as Vec3;
  const transformMode=()=>resizeDelta?'scale' as const:activeMode==='select'?'translate' as const:activeMode;
  let previewListener:((preview:TransformPreview)=>void)|undefined;let annotationsVisible=false;
  // Project an original SVG cube from the camera basis. The controls rotate with
  // the actual camera, including free orbit, without a second WebGL context.
  const ns = 'http://www.w3.org/2000/svg';
  const cube = document.createElement('div'); cube.className = 'view-cube'; cube.setAttribute('role', 'group'); cube.setAttribute('aria-label', t('View cube'));
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 132 132');
  const cubeCaption = document.createElement('span'); cubeCaption.className = 'cube-caption'; cubeCaption.textContent = t('VIEW'); cube.append(svg, cubeCaption); container.append(cube);
  const faceSpecs: { name: Exclude<ViewDirection, 'iso'>; normal: number[]; corners: number[][] }[] = [
    { name:'top',normal:[0,0,1],corners:[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
    { name:'bottom',normal:[0,0,-1],corners:[[-1,1,-1],[1,1,-1],[1,-1,-1],[-1,-1,-1]] },
    { name:'front',normal:[0,-1,0],corners:[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]] },
    { name:'back',normal:[0,1,0],corners:[[1,1,-1],[-1,1,-1],[-1,1,1],[1,1,1]] },
    { name:'right',normal:[1,0,0],corners:[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]] },
    { name:'left',normal:[-1,0,0],corners:[[-1,1,-1],[-1,-1,-1],[-1,-1,1],[-1,1,1]] },
  ];
  const faces = faceSpecs.map(spec => {
    const group = document.createElementNS(ns, 'g'); group.setAttribute('role', 'button'); group.setAttribute('aria-label', t(spec.name[0].toUpperCase() + spec.name.slice(1))); group.setAttribute('tabindex', '0');
    const polygon = document.createElementNS(ns, 'polygon'); const text = document.createElementNS(ns, 'text'); text.textContent = t(spec.name.toUpperCase()); text.setAttribute('text-anchor', 'middle'); text.setAttribute('dy', '.35em'); group.append(polygon, text); svg.append(group);
    group.addEventListener('click', () => setView(spec.name)); group.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView(spec.name); } }); return { ...spec, group, polygon, text };
  });
  function updateCube() {
    camera.updateMatrixWorld(); const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), toward = camera.position.clone().sub(orbit.target).normalize();
    for (const face of faces) {
      const visible = new THREE.Vector3(...face.normal as [number,number,number]).dot(toward) > 0.001;
      face.group.style.display = visible ? '' : 'none'; face.group.setAttribute('tabindex', visible ? '0' : '-1');
      const points = face.corners.map(p => { const v = new THREE.Vector3(...p as [number,number,number]); return [66 + v.dot(right) * 31, 63 - v.dot(up) * 31]; });
      face.polygon.setAttribute('points', points.map(p => p.join(',')).join(' ')); face.text.setAttribute('x', String(points.reduce((s,p) => s+p[0],0)/4)); face.text.setAttribute('y', String(points.reduce((s,p) => s+p[1],0)/4));
    }
    const exact = Object.entries(directions).find(([name, d]) => name !== 'iso' && new THREE.Vector3(...d).normalize().dot(toward) > 0.99999)?.[0];
    const view = (exact ?? 'iso') as ViewDirection; canvas.dataset.view = view; viewListener?.(view); canvas.dataset.projection = camera instanceof THREE.OrthographicCamera ? 'orthographic' : 'perspective';
  }
  const draw = () => { if (!disposed && (canvas.getClientRects().length||canvas.dataset.simulationRecording)) {canvas.dataset.cameraPosition=JSON.stringify(camera.position.toArray());canvas.dataset.cameraTarget=JSON.stringify(orbit.target.toArray());canvas.dataset.cameraZoom=String(camera instanceof THREE.OrthographicCamera?camera.zoom:camera.position.distanceTo(orbit.target));canvas.dataset.navigation=navigationPreset; canvas.dataset.transformAxis=gizmo.axis??'';updateCube();connectorHandles?.update();resizeControls?.update();publishPreview();for(const helper of selectionBoxes.values())helper.update(); renderer.render(scene, camera);if(canvas.dataset.simulationRecording)canvas.dispatchEvent(new Event('brickwright-simulation-frame')); } };
  canvas.addEventListener('brickwright-simulation-capture',draw);
  let pendingMove:PointerEvent|undefined;let pendingDraw:number|undefined;const scheduleDraw=()=>{if(pendingDraw!==undefined||disposed)return;pendingDraw=requestAnimationFrame(()=>{pendingDraw=undefined;const event=pendingMove;pendingMove=undefined;if(event)processDirectMove(event);draw();});};
  const connectorHandles=mountConnectorHandles(scene,()=>camera,canvas,session,()=>!simulating&&!spaceHeld&&!cameraDrag&&!pointPick&&!surfacePlacement.active,enabled=>{orbit.enabled=enabled;},()=>gridStep,()=>draw(),onError);
  const cameraChanged=()=>{surfacePlacement.refresh();scheduleDraw();};
  function flushDraw(){if(pendingDraw!==undefined){cancelAnimationFrame(pendingDraw);pendingDraw=undefined;const event=pendingMove;pendingMove=undefined;if(event)processDirectMove(event);draw();}}
  function publishPreview(){
    if(!previewListener)return;let poses=selected.filter(id=>session.state.document.roots.includes(id)).map(id=>({id,transform:structuredClone(session.state.document.nodes[id].transform)})),valid=true,warning:string|undefined;
    if(drag){try{const d=delta();poses=[...drag.transforms].map(([id,original])=>({id,transform:constrainCubeTransform(session.state.document.nodes[id],applyGizmoDelta(original,d,transformMode(),scaleFactors()))}));}catch(error){valid=false;warning=error instanceof Error?error.message:String(error);}}
    else if(directDrag?.updates)poses=directDrag.updates;
    else if(directDrag)poses=[...directDrag.transforms].map(([id,t])=>({id,transform:{...t,position:t.position.map((v,i)=>v+directDrag!.offset[i]) as Vec3}}));
    if(drag||directDrag?.moved)try{for(const {id,transform} of poses)assertDrivenEdit(session.state.document,{...session.state.document.nodes[id],transform});}catch(error){valid=false;warning=error instanceof Error?error.message:String(error);}
    const box=new THREE.Box3();for(const {id} of poses){const mesh=meshes.get(id);if(mesh)box.union(meshBounds.read(mesh));}
    const center=box.isEmpty()?new THREE.Vector3():box.getCenter(new THREE.Vector3());
    const project=(point:THREE.Vector3):[number,number]=>{const p=point.clone().project(camera);return [(p.x+1)*container.clientWidth/2,(1-p.y)*container.clientHeight/2];};
    const origin=project(center),anchors:TransformAxisAnchor[]=[];
    const axes=['X','Y','Z'] as const,key=activeMode==='rotate'?'rotation':activeMode==='scale'?'scale':'position';
    const widths=axes.map((_,i)=>Math.max(34,Math.min(92,String(Number((poses[0]?.transform[key][i]??0).toFixed(5))).length*7+12)));
    const fits=(point:[number,number],i:number)=>{const dx=point[0]-origin[0],dy=point[1]-origin[1],length=Math.hypot(dx,dy);if(length<12)return false;const distance=8+Math.abs(dx/length)*widths[i]/2+Math.abs(dy/length)*11,x=point[0]+dx/length*distance,y=point[1]+dy/length*distance;return x-widths[i]/2>=2&&x+widths[i]/2<=container.clientWidth-2&&y>=16&&y<=container.clientHeight-44;};
    if(annotationsVisible&&activeMode==='select'){
      const size=box.isEmpty()?new THREE.Vector3(20,20,20):box.getSize(new THREE.Vector3());
      axes.forEach((axis,i)=>{let point=origin,visible=false;
        for(const fraction of [1,.75,.5]){for(const sign of [1,-1]){const end=center.clone();end.setComponent(i,end.getComponent(i)+sign*fraction*Math.max(8,size.getComponent(i)*.65));const candidate=project(end);if(fits(candidate,i)){point=candidate;visible=true;break;}}if(visible)break;}
        const dx=point[0]-origin[0],dy=point[1]-origin[1],length=Math.hypot(dx,dy);anchors.push({axis,point,direction:[dx/(length||1),dy/(length||1)],visible,guide:{from:origin,to:point}});
      });
    }else if(annotationsVisible&&gizmo.object){
      // Read projected vertices from the actual visible helper, so rotation,
      // local scale, zoom and Three's camera-aligned rings stay synchronized.
      const helper=gizmo.getHelper();helper.updateMatrixWorld(true);
      const preferred=[[-.85,-.5],[.85,-.5],[.5,.86]];
      axes.forEach((axis,i)=>{let best=-Infinity,point:[number,number]=origin;
        helper.traverseVisible(object=>{if(object.name!==axis||!(object instanceof THREE.Mesh))return;const positions=object.geometry.getAttribute('position');if(!positions)return;
          for(let j=0;j<positions.count;j++){const p=project(new THREE.Vector3().fromBufferAttribute(positions,j).applyMatrix4(object.matrixWorld)),dx=p[0]-origin[0],dy=p[1]-origin[1];
            if(!fits(p,i))continue;const score=activeMode==='rotate'?dx*preferred[i][0]+dy*preferred[i][1]:Math.hypot(dx,dy)+(dx*preferred[i][0]+dy*preferred[i][1])*.01;
            if(score>best){best=score;point=p;}
          }
        });
        const dx=point[0]-origin[0],dy=point[1]-origin[1],length=Math.hypot(dx,dy);anchors.push({axis,point,direction:[dx/(length||1),dy/(length||1)],visible:best>-Infinity&&length>12});
      });
    }
    const screenCorners:THREE.Vector3[]=[];if(!box.isEmpty())for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])screenCorners.push(new THREE.Vector3(x,y,z));const points=screenCorners.map(project),screenBounds=points.length?{left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))}:undefined;
    previewListener({screenBounds,mode:activeMode,resizing:!!resizeDelta,dimensionHandles:resizeStyle==='dimensions',poses,dragging:!!drag||!!directDrag?.moved,valid,warning,axes:anchors,...(!box.isEmpty()?{bounds:{min:box.min.toArray() as Vec3,max:box.max.toArray() as Vec3}}:{})});
  }
  function measureResizeFrame(roots:string[]):ResizeFrame|undefined{
    if(!roots.length)return;const poses=roots.map(id=>session.state.document.nodes[id].transform),q=scalePivotRotation(poses),inverse=new THREE.Matrix4().makeRotationFromQuaternion(q.clone().invert()),box=new THREE.Box3(),point=new THREE.Vector3();
    for(const id of roots){const mesh=meshes.get(id)!;mesh.updateMatrixWorld();const matrix=inverse.clone().multiply(mesh.matrixWorld),positions=meshBounds.positions(mesh);if(positions)for(let i=0;i<positions.length;i+=3)box.expandByPoint(point.set(positions[i],positions[i+1],positions[i+2]).applyMatrix4(matrix));}
    const size=box.getSize(new THREE.Vector3()).toArray() as Vec3;if(size.some(v=>v<=1e-8))return;const center=box.getCenter(new THREE.Vector3()).applyQuaternion(q).toArray() as Vec3;
    const first=new THREE.Quaternion().setFromEuler(new THREE.Euler(...poses[0].rotation.map(v=>v*RAD) as Vec3,'ZYX')),mixed=poses.some(p=>Math.abs(first.dot(new THREE.Quaternion().setFromEuler(new THREE.Euler(...p.rotation.map(v=>v*RAD) as Vec3,'ZYX'))))<1-1e-12);
    return {center,size,rotation:q,ids:[...roots],uniformOnly:mixed||roots.some(id=>isCube(session.state.document.nodes[id]))};
  }
  const placeGizmo = () => {
    if (drag) return;
    if(simulating){resizeFrame=undefined;gizmo.detach();return;}
    const roots = selected.filter(id => session.state.document.roots.includes(id) && meshes.has(id));
    resizeFrame=roots.some(id=>session.state.document.nodes[id].reference)?undefined:measureResizeFrame(roots);
    if (!roots.length || activeMode==='select'||activeMode==='scale'&&resizeStyle==='dimensions') { gizmo.detach(); draw(); return; }
    const box = new THREE.Box3(); for (const id of roots) box.union(new THREE.Box3().setFromObject(meshes.get(id)!));
    pivot.position.copy(box.getCenter(new THREE.Vector3())); pivot.quaternion.copy(activeMode==='scale'?scalePivotRotation(roots.map(id=>session.state.document.nodes[id].transform)):new THREE.Quaternion()); pivot.scale.set(1, 1, 1); pivot.updateMatrixWorld(); gizmo.attach(pivot); draw();
  };
  const onDrag = (event: { value: unknown }) => { orbit.enabled = !event.value; };
  const startTransform = () => {
    const transforms = new Map<string, Transform>();
    for (const id of selected) if (session.state.document.roots.includes(id)) transforms.set(id, structuredClone(session.state.document.nodes[id].transform));
    pivot.updateMatrixWorld(); drag = { matrix: pivot.matrixWorld.clone(), transforms };
  };
  const delta = () => {if(resizeDelta)return resizeDelta.clone(); pivot.updateMatrixWorld(); return new THREE.Matrix4().multiplyMatrices(pivot.matrixWorld, drag!.matrix.clone().invert()); };
  const previewTransform = () => {
    if (!drag) return; const d = delta();
    for (const id of drag.transforms.keys()) { const mesh = meshes.get(id); if (mesh) { mesh.matrixAutoUpdate = false; try{const node=session.state.document.nodes[id],original=drag.transforms.get(id)!;const next=isCube(node)?constrainCubeTransform(node,applyGizmoDelta(original,d,transformMode(),scaleFactors())):undefined;mesh.matrix.copy(next?transformMatrix(next).multiply(transformMatrix(original).invert()):d);}catch{mesh.matrix.copy(d);} mesh.matrixWorldNeedsUpdate = true; } }
    draw();
  };
  const cancelTransform = () => {pendingMove=undefined;moveSurface.end();if(resizeControls?.active){resizeControls.cancel();return;}endBox();resizeDelta=undefined;
    if(directDrag){if(canvas.hasPointerCapture(directDrag.pointerId))canvas.releasePointerCapture(directDrag.pointerId);for(const id of directDrag.transforms.keys()){const mesh=meshes.get(id);if(mesh){mesh.matrix.identity();mesh.matrixWorldNeedsUpdate=true;}}directDrag=null;orbit.enableRotate=true;draw();}
    if (!drag) return;
    for (const id of drag.transforms.keys()) { const mesh = meshes.get(id); if (mesh) { mesh.matrix.identity(); mesh.matrixWorldNeedsUpdate = true; } }
    drag = null; gizmo.reset(); orbit.enabled = true; placeGizmo();
  };
  const endTransform = () => {
    if (!drag) return; const d = delta(); const updates: { id: string; transform: Transform }[] = [];
    try {
      for (const [id, original] of drag.transforms) updates.push({id,transform:constrainCubeTransform(session.state.document.nodes[id],applyGizmoDelta(original,d,transformMode(),scaleFactors()))});
    } catch(error){cancelTransform();onError(error);return;}
    drag = null;resizeDelta=undefined;
    try { session.transform(updates); draw(); } catch (e) { for (const mesh of meshes.values()) { mesh.matrix.identity(); mesh.matrixWorldNeedsUpdate = true; } onError(e); placeGizmo(); }
  };
  gizmo.addEventListener('dragging-changed', onDrag); gizmo.addEventListener('mouseDown', startTransform); gizmo.addEventListener('objectChange', previewTransform); gizmo.addEventListener('mouseUp', endTransform);
  const resize = new ResizeObserver(() => { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); if (camera instanceof THREE.PerspectiveCamera) camera.aspect = w / h; else { const half = (camera.top - camera.bottom) / 2; camera.left = -half * w / h; camera.right = half * w / h; } camera.updateProjectionMatrix();surfacePlacement.refresh(); draw(); }); resize.observe(container);
  orbit.addEventListener('change', cameraChanged); gizmo.addEventListener('change', scheduleDraw);
  let down: { x: number; y: number; t: number; pointerId: number } | null = null; const touches = createTouchTracker(); let suppressTap = false;
  function pointerRay(e:PointerEvent){const rect=canvas.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);}
  function zoomCamera(factor:number){if(!Number.isFinite(factor)||factor<=0)return;if(camera instanceof THREE.OrthographicCamera){camera.zoom=THREE.MathUtils.clamp(camera.zoom*factor,.01,1000);camera.updateProjectionMatrix();}else{const offset=camera.position.clone().sub(orbit.target);camera.position.copy(orbit.target).add(offset.setLength(THREE.MathUtils.clamp(offset.length()/factor,orbit.minDistance,orbit.maxDistance)));}orbit.update();draw();}
  function navigate(kind:'pan'|'orbit',dx:number,dy:number){
    if(kind==='pan'){const height=camera instanceof THREE.OrthographicCamera?(camera.top-camera.bottom)/camera.zoom:2*camera.position.distanceTo(orbit.target)*Math.tan((camera as THREE.PerspectiveCamera).fov*RAD/2);const unit=height/Math.max(1,canvas.clientHeight);camera.updateMatrixWorld();const offset=new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,0).multiplyScalar(-dx*unit).add(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld,1).multiplyScalar(dy*unit));camera.position.add(offset);orbit.target.add(offset);}
    else{const up=new THREE.Quaternion().setFromUnitVectors(camera.up,new THREE.Vector3(0,1,0)),offset=camera.position.clone().sub(orbit.target).applyQuaternion(up),spherical=new THREE.Spherical().setFromVector3(offset);spherical.theta-=dx*.005;spherical.phi=THREE.MathUtils.clamp(spherical.phi-dy*.005,.01,orbit.maxPolarAngle);camera.position.copy(orbit.target).add(offset.setFromSpherical(spherical).applyQuaternion(up.invert()));}orbit.update();draw();
  }
  // Camera drags disable OrbitControls, including its context-menu handler.
  // Always consume secondary-click menus on the workplane independently.
  const contextMenu=(event:MouseEvent)=>{event.preventDefault();event.stopImmediatePropagation();};canvas.addEventListener('contextmenu',contextMenu,true);
  const wheel=(event:WheelEvent)=>{event.preventDefault();event.stopImmediatePropagation();if(drag||directDrag?.moved||cameraDrag)return;const action=cameraWheelAction(event,navigationPreset,canvas.clientHeight);if(action)action.kind==='zoom'?zoomCamera(action.factor):navigate(action.kind,action.dx,action.dy);};canvas.addEventListener('wheel',wheel,{capture:true,passive:false});
  let gestureScale=1;const gesture=(event:Event)=>{event.preventDefault();const scale=(event as Event&{scale:number}).scale;if(event.type==='gesturestart'){gestureScale=1;return;}if(event.type==='gestureend'){gestureScale=1;return;}if(scale>0&&Number.isFinite(scale)){if(!drag&&!directDrag?.moved)zoomCamera(scale/gestureScale);gestureScale=scale;}};for(const name of ['gesturestart','gesturechange','gestureend'])canvas.addEventListener(name,gesture,{passive:false});
  const nativeGesture=(event:Event)=>{const data=(event as CustomEvent).detail;if(!data||!Number.isFinite(data.x)||!Number.isFinite(data.y))return;let hit:Element|null=document.elementFromPoint(data.x,data.y);while(hit?.shadowRoot)hit=hit.shadowRoot.elementFromPoint(data.x,data.y);if(hit!==canvas)return;data.handled=true;if(drag||directDrag?.moved||cameraDrag)return;if(data.kind==='zoom')zoomCamera(data.factor);else if(data.kind==='wheel'){const action=cameraWheelAction(data,navigationPreset,canvas.clientHeight);if(action)action.kind==='zoom'?zoomCamera(action.factor):navigate(action.kind,action.dx,action.dy);}};window.addEventListener('brickwright-camera-input',nativeGesture);
  const cameraKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&pointPick){event.preventDefault();event.stopImmediatePropagation();cancelPointPick();return;}if(event.code==='Space'){spaceHeld=true;event.preventDefault();}};canvas.addEventListener('keydown',cameraKey);
  const resetCameraKeys=()=>{endGrab();cancelPointPick();if(surfacePlacement.active)endPlacement();endBox();spaceHeld=false;shiftHeld=false;if(cameraDrag){gizmo.enabled=cameraDrag.gizmoEnabled;cameraDrag=undefined;orbit.enabled=true;}};window.addEventListener('blur',resetCameraKeys);
  const onDown = (e: PointerEvent) => {shiftHeld=e.shiftKey;canvas.dataset.fine=String(gizmo.isFine());
    canvas.focus({ preventScroll: true });
    const cameraAction=e.pointerType==='touch'?undefined:cameraPointerAction(e.button,e.shiftKey,e.altKey,e.ctrlKey,spaceHeld,navigationPreset);if(cameraAction&&!drag&&!directDrag){cameraDrag={id:e.pointerId,x:e.clientX,y:e.clientY,kind:cameraAction,gizmoEnabled:gizmo.enabled};orbit.enabled=false;gizmo.enabled=false;canvas.setPointerCapture(e.pointerId);e.preventDefault();e.stopImmediatePropagation();return;}
    if(pointPick&&e.button===0){pointerRay(e);const hit=ray.intersectObjects([...meshes.values()],false)[0];if(hit){const previous=pointPick;pointPick=undefined;gizmo.enabled=previous.gizmo;canvas.style.cursor=previous.cursor;const bodyId=[...meshes].find(([,mesh])=>mesh===hit.object)?.[0];if(bodyId)previous.done({bodyId,point:hit.point.toArray() as Vec3,normal:hit.face!.normal.clone().transformDirection(hit.object.matrixWorld).toArray() as Vec3});else previous.done(null);}e.preventDefault();e.stopImmediatePropagation();return;}
    if(simulating){if(grabEnabled&&simulationDrag&&e.button===0){if(grab){endGrab();return;}pointerRay(e);scene.updateMatrixWorld(true);const hit=ray.intersectObjects([...meshes.values(),...previewBalls.values()],false)[0];if(hit){const bodyId=hit.object.userData.id as string;if(session.state.document.nodes[bodyId]?.physics?.motion==='static')return;const point=hit.point.toArray() as Vec3;grab={pointerId:e.pointerId,bodyId,point,target:point,plane:new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),hit.point),orbit:orbit.enabled};orbit.enabled=false;canvas.setPointerCapture(e.pointerId);simulationDrag({bodyId,point,target:point});e.preventDefault();e.stopImmediatePropagation();}}return;}
    if (e.pointerType === 'touch') { touches.down({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }); if (touches.count > 1) suppressTap = true; }
    if (!down) { down = { x: e.clientX, y: e.clientY, t: e.timeStamp, pointerId: e.pointerId }; if (e.pointerType !== 'touch') suppressTap = false; }
    if(surfacePlacement.active){surfacePlacement.move(e);draw();return;}
    if (gizmo.axis) suppressTap = true;
    if(touches.count>1){endBox();if(directDrag)cancelTransform();return;}
    if(activeMode==='select'&&e.button===0&&!gizmo.axis&&(e.pointerType!=='touch'||multiSelect)){pointerRay(e);if(!ray.intersectObjects([...meshes.values()],false).length){boxSelect={pointerId:e.pointerId,x:e.clientX,y:e.clientY,additive:multiSelect||e.shiftKey,base:[...selected],moved:false,gizmoEnabled:gizmo.enabled};orbit.enabled=false;gizmo.enabled=false;canvas.setPointerCapture(e.pointerId);e.preventDefault();e.stopImmediatePropagation();return;}}
    if(activeMode==='select'&&e.button===0&&!multiSelect&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey){pointerRay(e);const hit=ray.intersectObjects([...meshes.values()],false)[0];const id=hit?.object.userData.id as string|undefined;if(id){if(!selected.includes(id))session.select([id]);const view=camera.getWorldDirection(new THREE.Vector3()),normal=Math.abs(view.z)<.25?(Math.abs(view.x)>Math.abs(view.y)?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0)):new THREE.Vector3(0,0,1);const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,hit.point);const start=ray.ray.intersectPlane(plane,new THREE.Vector3());if(start){directDrag={pointerId:e.pointerId,start:start.clone(),plane,transforms:new Map(selected.filter(id=>session.state.document.roots.includes(id)).map(id=>[id,structuredClone(session.state.document.nodes[id].transform)])),offset:[0,0,0],base:(()=>{const box=new THREE.Box3();for(const key of selected){const m=meshes.get(key);if(m)box.union(meshBounds.read(m));}const bottom=new THREE.Plane(new THREE.Vector3(0,0,1),-box.min.z),p=ray.ray.intersectPlane(bottom,new THREE.Vector3())??box.getCenter(new THREE.Vector3());return [p.x,p.y,box.min.z] as Vec3;})(),moved:false,precision:precisionTracker([0,0,0]),usedFine:gizmo.isFine()};orbit.enableRotate=false;canvas.setPointerCapture(e.pointerId);if(surfaceSnapEnabled)moveSurface.begin([...directDrag.transforms.keys()],true);}}}
  };
  const onMove = (e: PointerEvent) => {if(grab?.pointerId===e.pointerId){pointerRay(e);const point=ray.ray.intersectPlane(grab.plane,new THREE.Vector3());if(point){grab.target=point.toArray() as Vec3;if(grab.pending===undefined)grab.pending=requestAnimationFrame(()=>{if(grab){grab.pending=undefined;simulationDrag?.({bodyId:grab.bodyId,point:grab.point,target:grab.target});}});}e.preventDefault();e.stopImmediatePropagation();return;}if(boxSelect?.pointerId===e.pointerId){const rect=canvas.getBoundingClientRect(),x=Math.min(boxSelect.x,e.clientX)-rect.left,y=Math.min(boxSelect.y,e.clientY)-rect.top,w=Math.abs(e.clientX-boxSelect.x),h=Math.abs(e.clientY-boxSelect.y);boxSelect.moved||=Math.hypot(w,h)>TOUCH_SLOP_PX;marquee.hidden=!boxSelect.moved;Object.assign(marquee.style,{left:`${x}px`,top:`${y}px`,width:`${w}px`,height:`${h}px`});e.preventDefault();e.stopImmediatePropagation();return;}if(cameraDrag?.id===e.pointerId){navigate(cameraDrag.kind,e.clientX-cameraDrag.x,e.clientY-cameraDrag.y);cameraDrag.x=e.clientX;cameraDrag.y=e.clientY;e.preventDefault();e.stopImmediatePropagation();return;}shiftHeld=e.shiftKey;canvas.dataset.fine=String(gizmo.isFine());
    if(surfacePlacement.active){surfacePlacement.move(e);scheduleDraw();}
    if (e.pointerType === 'touch') touches.move({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
    if(directDrag?.pointerId===e.pointerId){e.preventDefault();e.stopImmediatePropagation();pendingMove=e;scheduleDraw();}
  };
  function processDirectMove(e:PointerEvent){
    if(!directDrag||directDrag.pointerId!==e.pointerId||!down)return;
    if(!directDrag.moved&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<=TOUCH_SLOP_PX)return;
    if(surfaceSnapEnabled&&!e.altKey){if(!moveSurface.active)moveSurface.begin([...directDrag.transforms.keys()],true);const pose=moveSurface.move(e);if(pose){const next=surfaceMove([...directDrag.transforms].map(([id,transform])=>({id,transform})),directDrag.base,pose.point,pose.normal);directDrag.updates=next.updates;directDrag.moved=true;for(const id of directDrag.transforms.keys()){const mesh=meshes.get(id);if(mesh){mesh.matrixAutoUpdate=false;mesh.matrix.copy(next.delta);mesh.matrixWorldNeedsUpdate=true;}}return;}}
    moveSurface.end();directDrag.updates=undefined;
    pointerRay(e);const point=ray.ray.intersectPlane(directDrag.plane,new THREE.Vector3());if(!point)return;
    const d=point.sub(directDrag.start);directDrag.usedFine||=gizmo.isFine();const filtered=directDrag.precision.sample([d.x,d.y,d.z],gizmo.isFine());directDrag.offset=snapDelta(filtered,(gridStep||.01)/(directDrag.usedFine?10:1));directDrag.moved=true;
    for(const id of directDrag.transforms.keys()){const mesh=meshes.get(id);if(mesh){mesh.matrixAutoUpdate=false;mesh.matrix.makeTranslation(...directDrag.offset);mesh.matrixWorldNeedsUpdate=true;}}
  }
  const onUp = (e: PointerEvent) => {
    if(grab?.pointerId===e.pointerId){endGrab();e.preventDefault();e.stopImmediatePropagation();return;}
    if(boxSelect?.pointerId===e.pointerId){
      const action=boxSelect,rect=canvas.getBoundingClientRect();
      const rectangle=selectionRectangle(action.x-rect.left,action.y-rect.top,e.clientX-rect.left,e.clientY-rect.top);
      const captured:string[]=[];
      camera.updateMatrixWorld();
      if(action.moved)for(const [id,mesh] of meshes){
        const box=meshBounds.read(mesh),points:THREE.Vector4[]=[];
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
          points.push(new THREE.Vector4(x,y,z,1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix));
        }
        if(projectedBoxIntersects(points,rectangle,rect))captured.push(id);
      }
      endBox();session.select(action.additive?[...new Set([...action.base,...captured])]:captured);
      e.preventDefault();e.stopImmediatePropagation();return;
    }
    if(cameraDrag?.id===e.pointerId){gizmo.enabled=cameraDrag.gizmoEnabled;cameraDrag=undefined;orbit.enabled=true;if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);e.preventDefault();e.stopImmediatePropagation();return;}
    if(directDrag?.pointerId===e.pointerId){flushDraw();const action=directDrag;directDrag=null;moveSurface.end();if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);orbit.enableRotate=true;if(action.moved){down=null;touches.reset();suppressTap=false;try{session.transform(action.updates??[...action.transforms].map(([id,transform])=>({id,transform:{...transform,position:transform.position.map((v,i)=>v+action.offset[i]) as Vec3}})));}catch(error){for(const id of action.transforms.keys()){const mesh=meshes.get(id);if(mesh){mesh.matrix.identity();mesh.matrixWorldNeedsUpdate=true;}}onError(error);draw();}return;}}
    const gesture = e.pointerType === 'touch' ? touches.up({ id: e.pointerId, t: e.timeStamp }) : null;
    if(surfacePlacement.active){const allowed=!suppressTap&&e.button===0;down=null;if(!touches.count)suppressTap=false;if(allowed)placementCommit?.(e);return;}
    const start = down; if (!start || start.pointerId !== e.pointerId) { if (!touches.count) { down = null; suppressTap = false; } return; }
    down = null;
    const allow = !suppressTap && !drag && Math.hypot(e.clientX - start.x, e.clientY - start.y) <= TOUCH_SLOP_PX;
    if (!touches.count) suppressTap = false;
    if (!allow) return;
    const rect = canvas.getBoundingClientRect(); pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1); ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects([...meshes.values()], false)[0]; const id = hit?.object.userData.id as string | undefined;
    const multi = multiSelect || e.shiftKey || e.ctrlKey || e.metaKey || (gesture?.type === 'end' && gesture.was === 'longPress');
    session.select(id ? (multi ? (selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]) : [id]) : []);
  };
  const onCancel = () => {if(surfacePlacement.active)endPlacement();resetCameraKeys(); down = null; suppressTap = false; touches.reset(); cancelTransform(); };
  const releaseShift=(e:KeyboardEvent)=>{if(e.code==='Space')spaceHeld=false;if(e.key==='Shift'){shiftHeld=false;canvas.dataset.fine=String(fineEnabled);}};window.addEventListener('keyup',releaseShift);
  canvas.addEventListener('pointerdown', onDown,true); canvas.addEventListener('pointermove', onMove,true); canvas.addEventListener('pointerup', onUp,true); canvas.addEventListener('pointercancel', onCancel);
  function setSelection(ids: readonly string[]) {
    selected = [...ids]; for (const [id, mesh] of meshes) { mesh.material.emissive.set(selected.includes(id) ? '#433317' : '#000000'); mesh.material.emissiveIntensity = selected.includes(id) ? 0.8 : 0; outlines.get(id)?.material && ((outlines.get(id)!.material as THREE.LineBasicMaterial).color.set(selected.includes(id) ? '#ffda82' : '#172a36')); }
    for(const helper of selectionBoxes.values()){scene.remove(helper);helper.geometry.dispose();(helper.material as THREE.Material).dispose();}selectionBoxes.clear();
    const selectedIds=new Set(selected);
    const containsSelected=(id:string,seen=new Set<string>()):boolean=>{if(selectedIds.has(id))return true;if(seen.has(id))return false;seen.add(id);const node=session.state.document.nodes[id];return node?.kind==='boolean'&&node.inputs.some(child=>containsSelected(child,seen));};
    for(const [id,mesh] of meshes)if(containsSelected(id)){const helper=new THREE.BoxHelper(mesh,0x5de2ff);(helper.material as THREE.LineBasicMaterial).depthTest=false;helper.renderOrder=100;scene.add(helper);selectionBoxes.set(id,helper);}
    canvas.dataset.selected=String(ids.length);placeGizmo(); draw();
  }
  const clear = () => { for (const mesh of meshes.values()) { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); } for (const outline of outlines.values()) { outline.geometry.dispose(); (outline.material as THREE.Material).dispose(); } meshes.clear(); outlines.clear(); };
  function update(result: GeometryResult) {
    cancelTransform(); clear();
    for (const body of result.bodies) {
      const appearance=body.hole?undefined:componentAppearance(session.state.document.nodes[body.id],session.state.document.nodes);
      const geometry=appearance??surfaceGeometry(body.positions,body.indices);
      const material = new THREE.MeshStandardMaterial({ color: body.hole?'#9eb8c8':appearance?'#ffffff':body.color,vertexColors:!!appearance,transparent:!!body.hole,opacity:body.hole?.3:1,depthWrite:!body.hole, metalness: 0.08, roughness: 0.65, flatShading: false });
      const mesh = new THREE.Mesh(geometry, material); mesh.userData.id = body.id;
      if(appearance){geometry.computeBoundingBox();meshBounds.register(mesh,geometry.getAttribute('position').array as Float32Array,{min:geometry.boundingBox!.min.toArray(),max:geometry.boundingBox!.max.toArray()});}else meshBounds.register(mesh,body.positions,body.bounds);
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), new THREE.LineBasicMaterial({ color: '#172a36', transparent: true, opacity: 0.8 })); mesh.add(outline);
      meshes.set(body.id, mesh); outlines.set(body.id, outline); scene.add(mesh);
    } setSelection(selected); draw();
  }
  function setView(direction: ViewDirection) {
    cancelTransform(); const distance = camera.position.distanceTo(orbit.target);
    camera.position.copy(orbit.target).addScaledVector(new THREE.Vector3(...directions[direction]).normalize(), distance); orbit.update(); draw();
  }
  function frame(direction?: ViewDirection,onlySelection=false) {
    const box = new THREE.Box3(); for (const [id,mesh] of meshes)if(!onlySelection||!selected.length||selected.includes(id))box.union(new THREE.Box3().setFromObject(mesh));
    if (box.isEmpty()) box.set(new THREE.Vector3(-20, -20, 0), new THREE.Vector3(20, 20, 30));
    const center = box.getCenter(new THREE.Vector3()); const radius = Math.max(15, box.getSize(new THREE.Vector3()).length() / 2);
    const aspect = Math.max(0.1, container.clientWidth / Math.max(1, container.clientHeight));
    const distance = radius / Math.sin(42 * RAD / 2) / Math.min(1, aspect) * 1.2;
    const dir = direction ? new THREE.Vector3(...directions[direction]) : camera.position.clone().sub(orbit.target);
    if (camera instanceof THREE.OrthographicCamera) { const half = radius * 1.2 / Math.min(1, aspect); camera.top = half; camera.bottom = -half; camera.left = -half * aspect; camera.right = half * aspect; camera.zoom = 1; camera.updateProjectionMatrix(); }
    camera.position.copy(center).addScaledVector(dir.normalize(), distance); orbit.target.copy(center); orbit.update(); draw();
  }
  resizeControls=mountResizeControls(container,{
    frame:()=>resizeStyle==='dimensions'&&!surfacePlacement.active&&!directDrag?.moved&&!boxSelect&&!cameraDrag&&(activeMode==='select'||activeMode==='scale')?resizeFrame:undefined,
    project:p=>{const v=p.clone().project(camera);return [(v.x+1)*container.clientWidth/2,(1-v.y)*container.clientHeight/2,v.z];},
    ray:(x,y)=>{const r=canvas.getBoundingClientRect(),caster=new THREE.Raycaster();caster.setFromCamera(new THREE.Vector2((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1),camera);return caster.ray;},camera:()=>camera,grid:()=>gridStep,fine:()=>fineEnabled,
    begin:()=>{cancelTransform();const transforms=new Map<string,Transform>();for(const id of resizeFrame?.ids??[])transforms.set(id,structuredClone(session.state.document.nodes[id].transform));drag={matrix:new THREE.Matrix4(),transforms};resizeDelta=new THREE.Matrix4();resizeFactors=[1,1,1];orbit.enabled=false;},
    preview:r=>{if(!drag)return;const updates=resizedTransforms([...drag.transforms].map(([id,transform])=>({id,transform})),r);for(const u of updates)assertDrivenEdit(session.state.document,{...session.state.document.nodes[u.id],transform:u.transform});resizeDelta=r.delta;resizeFactors=r.factors;previewTransform();},
    commit:r=>{resizeFrame=r.frame;orbit.enabled=true;endTransform();},cancel:()=>{orbit.enabled=true;cancelTransform();},error:onError,
  });
  refreshGrid();draw();
  return {setConnectorHandlesVisible:connectorHandles.setVisible,setSimulationDrag(handler:typeof simulationDrag){simulationDrag=handler;},setSimulationDragEnabled(enabled:boolean){grabEnabled=enabled;if(!enabled)endGrab();},cancelSimulationDrag:endGrab,pickPoint(done:(point:SimulationPoint|null)=>void){if(simulating)throw new Error(t('Reset simulation before placing connectors'));cancelPointPick();cancelTransform();pointPick={done,gizmo:gizmo.enabled,cursor:canvas.style.cursor};gizmo.enabled=false;canvas.style.cursor='crosshair';canvas.focus();return cancelPointPick;},setSimulationTraces:showTraces,setSimulationPoses(value:SimulationPose[]|null){presentedPoses=new Map((value??[]).map(pose=>[pose.id,pose]));const visiblePreviews=new Set((value??[]).filter(pose=>pose.previewRadiusMm).map(pose=>pose.id));for(const [id,mesh]of previewBalls)if(!visiblePreviews.has(id)){scene.remove(mesh);mesh.geometry.dispose();(mesh.material as THREE.Material).dispose();previewBalls.delete(id);}if(!value)endGrab();cancelPointPick();cancelTransform();simulating=value!==null;gizmo.enabled=!simulating;for(const mesh of meshes.values()){mesh.matrix.identity();mesh.matrixWorldNeedsUpdate=true;}if(!value)clearPreviewBalls();for(const pose of value??[]){if(pose.previewRadiusMm&&!previewBalls.has(pose.id)){const ball=new THREE.Mesh(pose.previewShape==='box'?new THREE.BoxGeometry(2*pose.previewRadiusMm,2*pose.previewRadiusMm,2*pose.previewRadiusMm):new THREE.SphereGeometry(pose.previewRadiusMm,24,12),new THREE.MeshStandardMaterial({color:'#ea9b4a',roughness:.55}));ball.userData.id=pose.id;scene.add(ball);previewBalls.set(pose.id,ball);}const mesh=meshes.get(pose.id)??previewBalls.get(pose.id);if(mesh){mesh.matrixAutoUpdate=false;mesh.matrix.compose(new THREE.Vector3(...pose.positionMm as [number,number,number]),new THREE.Quaternion(...pose.quaternion as [number,number,number,number]),new THREE.Vector3(1,1,1));mesh.matrixWorldNeedsUpdate=true;}}canvas.dataset.previewBalls=String(previewBalls.size);placeGizmo();scheduleDraw();}, canvas, update, setSelection, frame, setView, cancelTransform,get interacting(){return surfacePlacement.active||!!boxSelect||!!drag||!!directDrag?.moved;},
    beginPlacement(){if(surfacePlacement.active)endPlacement(false);cancelTransform();placementControls={rotate:orbit.enableRotate,gizmo:gizmo.enabled};surfacePlacement.begin();orbit.enableRotate=false;gizmo.enabled=false;gizmo.getHelper().visible=false;draw();},
    setPlacementRole(value:'solid'|'hole'){surfacePlacement.setRole(value);draw();},
    setPlacementGeometry(result:GeometryResult){surfacePlacement.setGeometry(result);draw();},
    movePlacement(point:PlacementPointer){const result=surfacePlacement.move(point);draw();return result;},
    cancelPlacement(){endPlacement();draw();},
    setPlacementHandlers(commit:(point:PlacementPointer)=>void,cancel:()=>void){placementCommit=commit;placementCanceled=cancel;},
    setSurfaceSnap(value:boolean){cancelTransform();surfaceSnapEnabled=value;canvas.dataset.surfaceSnap=String(value);surfacePlacement.refresh();draw();},get surfaceSnap(){return surfaceSnapEnabled;},
    get placementActive(){return surfacePlacement.active;},
    get appearance(){return {...colours};},setAppearance(value:{background:string;baseplate:string}){if(!validColour(value.background)||!validColour(value.baseplate))throw new Error(t('Choose a six-digit colour'));Object.assign(colours,value);(scene.background as THREE.Color).set(value.background);plate.material.color.set(value.baseplate);canvas.dataset.backgroundColour=value.background;canvas.dataset.baseplateColour=value.baseplate;draw();},
    get resizeControls(){return resizeStyle;},setResizeControls(value:'dimensions'|'gizmo'){if(surfacePlacement.active)endPlacement();cancelTransform();resizeStyle=value==='gizmo'?'gizmo':'dimensions';gizmo.setScaleSnap(resizeStyle==='gizmo'?.1:null);canvas.dataset.resizeControls=resizeStyle;placeGizmo();},
    setReadoutVisible(visible:boolean){annotationsVisible=visible;draw();},
    setTransformPreviewListener(listener:(preview:TransformPreview)=>void){previewListener=listener;draw();},
    setViewListener(listener: (view: ViewDirection) => void) { viewListener = listener; draw(); },
    setMultiSelect(enabled: boolean) { multiSelect = enabled; },
    zoom:zoomCamera,pan:(dx:number,dy:number)=>navigate('pan',dx,dy),orbit:(dx:number,dy:number)=>navigate('orbit',dx,dy),setNavigation:(preset:NavigationPreset)=>{navigationPreset=preset;draw();},
    setProjection(orthographic: boolean) {
      cancelTransform(); if (orthographic === (camera instanceof THREE.OrthographicCamera)) return;
      const aspect = container.clientWidth / Math.max(1, container.clientHeight), distance = camera.position.distanceTo(orbit.target);
      let next: typeof camera;
      if (orthographic) { const half = distance * Math.tan(42 * RAD / 2); next = new THREE.OrthographicCamera(-half * aspect, half * aspect, half, -half, 0.1, 200000); }
      else { next = new THREE.PerspectiveCamera(42, aspect, 0.1, 200000); }
      next.position.copy(camera.position); next.up.copy(camera.up); next.quaternion.copy(camera.quaternion);
      if (camera instanceof THREE.OrthographicCamera) { const half = (camera.top - camera.bottom) / (2 * camera.zoom); next.position.copy(orbit.target).add(camera.position.clone().sub(orbit.target).setLength(half / Math.tan(42 * RAD / 2))); }
      camera = next; orbit.object = camera; gizmo.camera = camera; orbit.update(); draw();
    },
    setWorkplaneVisible(visible: boolean) { workplane.visible = visible; axes.visible = visible; draw(); },
    dropSelection() {
      cancelTransform(); const updates: { id: string; transform: Transform }[] = [];
      for (const id of selected) { if (!session.state.document.roots.includes(id)) continue; const mesh = meshes.get(id); if (!mesh) continue; const bounds = new THREE.Box3().setFromObject(mesh); if (bounds.isEmpty()) continue; const transform = structuredClone(session.state.document.nodes[id].transform); transform.position[2] -= bounds.min.z; updates.push({ id, transform }); }
      if (updates.length) session.transform(updates);
    },
    setMode(mode: 'select' | 'translate' | 'rotate' | 'scale') {if(surfacePlacement.active)endPlacement(); cancelTransform();activeMode=mode;canvas.dataset.mode=mode;if(mode!=='select'){gizmo.setMode(mode); gizmo.setSpace(mode === 'scale' ? 'local' : 'world');}placeGizmo();draw(); },
    get gridDisplay(){return gridDisplay;},setGridDisplay(value:GridDisplay){displayGridSpacing(value,gridStep);gridDisplay=value;refreshGrid();draw();},
    setGrid(step: number) { gridStep = step;refreshGrid();surfacePlacement.refresh();draw();gizmo.gridStep=step; gizmo.setTranslationSnap(gridStep || null); },
    setFine(enabled:boolean){fineEnabled=enabled;canvas.dataset.fine=String(gizmo.isFine());surfacePlacement.refresh();draw();},get fine(){return fineEnabled;},
    nudge(dx: number, dy: number, dz: number,fine=false) {
      const offset = snapDelta([dx, dy, dz], (gridStep || .1)/(fine?10:1));
      session.transform(selected.filter(id => session.state.document.roots.includes(id)).map(id => { const transform = structuredClone(session.state.document.nodes[id].transform); transform.position = transform.position.map((v, i) => v + offset[i]) as Vec3; return { id, transform }; }));
    },
    dispose() {canvas.removeEventListener('brickwright-simulation-capture',draw);connectorHandles.dispose();endGrab();clearPreviewBalls();cancelPointPick();for(const objects of traceLines.values()){objects.line.geometry.dispose();(objects.line.material as THREE.Material).dispose();objects.marker.geometry.dispose();(objects.marker.material as THREE.Material).dispose();}traceLines.clear();resizeControls?.dispose();resizeControls=undefined;endPlacement(false);surfacePlacement.dispose();moveSurface.dispose(); endBox();marquee.remove();disposed = true;if(pendingDraw!==undefined)cancelAnimationFrame(pendingDraw);canvas.removeEventListener('wheel',wheel,true);canvas.removeEventListener('contextmenu',contextMenu,true);canvas.removeEventListener('keydown',cameraKey);for(const name of ['gesturestart','gesturechange','gestureend'])canvas.removeEventListener(name,gesture);window.removeEventListener('brickwright-camera-input',nativeGesture);window.removeEventListener('blur',resetCameraKeys);window.removeEventListener('keyup',releaseShift); resize.disconnect(); touches.reset(); canvas.removeEventListener('pointerdown', onDown,true); canvas.removeEventListener('pointermove', onMove,true); canvas.removeEventListener('pointerup', onUp,true); canvas.removeEventListener('pointercancel', onCancel); gizmo.removeEventListener('dragging-changed', onDrag); gizmo.removeEventListener('mouseDown', startTransform); gizmo.removeEventListener('objectChange', previewTransform); gizmo.removeEventListener('mouseUp', endTransform); gizmo.removeEventListener('change', scheduleDraw); orbit.removeEventListener('change', cameraChanged); gizmo.dispose(); orbit.dispose();for(const helper of selectionBoxes.values()){scene.remove(helper);helper.geometry.dispose();(helper.material as THREE.Material).dispose();}selectionBoxes.clear(); clear(); for (const object of [grid, majorGrid, border, plate, axes]) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => material.dispose()); } for (const sprite of textSprites) { sprite.material.map?.dispose(); sprite.material.dispose(); } renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); cube.remove(); },
  };
}
