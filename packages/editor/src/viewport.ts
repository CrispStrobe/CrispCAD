// SPDX-License-Identifier: BSD-3-Clause
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import {assertDrivenEdit,t} from '@brickwright/cad-core';
import type { CadSession, Transform, Vec3 } from '@brickwright/cad-core';
import type { GeometryResult } from '@brickwright/cad-geometry';
import { TOUCH_SLOP_PX, createTouchTracker } from './vendor/touch-gestures.js';
import {scalePivotRotation,applyGizmoDelta} from './transform-selection.js';
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
  const grid = new THREE.GridHelper(400, 400, '#52677a', '#2f4655'); grid.rotation.x = Math.PI / 2; grid.position.z = -0.1; workplane.add(grid);
  const majorGrid = new THREE.GridHelper(400, 40, '#8c9c99', '#536861'); majorGrid.rotation.x = Math.PI / 2; majorGrid.position.z = -0.08; workplane.add(majorGrid);
  plate.material.depthWrite=false;plate.renderOrder=-10;
  for(const lines of [grid,majorGrid]){lines.material.depthWrite=false;lines.material.transparent=true;lines.renderOrder=lines===grid?-9:-8;}majorGrid.material.opacity=.55;
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
  const gizmo = new TransformControls(camera, canvas); gizmo.setSize(0.85); gizmo.setSpace('world'); scene.add(gizmo.getHelper());
  gizmo.setTranslationSnap(1); gizmo.setRotationSnap(15 * RAD); gizmo.setScaleSnap(0.1);
  const meshes = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>();
  const outlines = new Map<string, THREE.LineSegments>(); const ray = new THREE.Raycaster(); const pointer = new THREE.Vector2();
  const selectionBoxes=new Map<string,THREE.BoxHelper>();let activeMode:'select'|'translate'|'rotate'|'scale'='select';
  let directDrag:{pointerId:number;start:THREE.Vector3;plane:THREE.Plane;transforms:Map<string,Transform>;offset:Vec3;moved:boolean}|null=null;
  let disposed = false; let selected: string[] = []; let drag: { matrix: THREE.Matrix4; transforms: Map<string, Transform> } | null = null; let gridStep = 1; let multiSelect = false; let viewListener: ((view: ViewDirection) => void) | undefined;
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
  const draw = () => { if (!disposed) { canvas.dataset.transformAxis=gizmo.axis??'';updateCube();publishPreview();const distance=camera instanceof THREE.OrthographicCamera?(camera.top-camera.bottom)/camera.zoom:camera.position.distanceTo(orbit.target);grid.material.opacity=THREE.MathUtils.clamp((240-distance)/200,0,.4);for(const helper of selectionBoxes.values())helper.update(); renderer.render(scene, camera); } };
  function publishPreview(){
    if(!previewListener)return;let poses=selected.filter(id=>session.state.document.roots.includes(id)).map(id=>({id,transform:structuredClone(session.state.document.nodes[id].transform)})),valid=true,warning:string|undefined;
    if(drag){try{const d=delta();poses=[...drag.transforms].map(([id,original])=>({id,transform:applyGizmoDelta(original,d,activeMode==='select'?'translate':activeMode,pivot.scale.toArray() as Vec3)}));}catch(error){valid=false;warning=error instanceof Error?error.message:String(error);}}
    else if(directDrag)poses=[...directDrag.transforms].map(([id,t])=>({id,transform:{...t,position:t.position.map((v,i)=>v+directDrag!.offset[i]) as Vec3}}));
    if(drag||directDrag?.moved)try{for(const {id,transform} of poses)assertDrivenEdit(session.state.document,{...session.state.document.nodes[id],transform});}catch(error){valid=false;warning=error instanceof Error?error.message:String(error);}
    const box=new THREE.Box3();for(const {id} of poses){const mesh=meshes.get(id);if(mesh)box.union(new THREE.Box3().setFromObject(mesh,true));}
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
    previewListener({mode:activeMode,poses,dragging:!!drag||!!directDrag?.moved,valid,warning,axes:anchors,...(!box.isEmpty()?{bounds:{min:box.min.toArray() as Vec3,max:box.max.toArray() as Vec3}}:{})});
  }
  const placeGizmo = () => {
    if (drag) return;
    const roots = selected.filter(id => session.state.document.roots.includes(id) && meshes.has(id));
    if (!roots.length || activeMode==='select') { gizmo.detach(); draw(); return; }
    const box = new THREE.Box3(); for (const id of roots) box.union(new THREE.Box3().setFromObject(meshes.get(id)!));
    pivot.position.copy(box.getCenter(new THREE.Vector3())); pivot.quaternion.copy(activeMode==='scale'?scalePivotRotation(roots.map(id=>session.state.document.nodes[id].transform)):new THREE.Quaternion()); pivot.scale.set(1, 1, 1); pivot.updateMatrixWorld(); gizmo.attach(pivot); draw();
  };
  const onDrag = (event: { value: unknown }) => { orbit.enabled = !event.value; };
  const startTransform = () => {
    const transforms = new Map<string, Transform>();
    for (const id of selected) if (session.state.document.roots.includes(id)) transforms.set(id, structuredClone(session.state.document.nodes[id].transform));
    pivot.updateMatrixWorld(); drag = { matrix: pivot.matrixWorld.clone(), transforms };
  };
  const delta = () => { pivot.updateMatrixWorld(); return new THREE.Matrix4().multiplyMatrices(pivot.matrixWorld, drag!.matrix.clone().invert()); };
  const previewTransform = () => {
    if (!drag) return; const d = delta();
    for (const id of drag.transforms.keys()) { const mesh = meshes.get(id); if (mesh) { mesh.matrixAutoUpdate = false; mesh.matrix.copy(d); mesh.matrixWorldNeedsUpdate = true; } }
    draw();
  };
  const cancelTransform = () => {
    if(directDrag){for(const id of directDrag.transforms.keys()){const mesh=meshes.get(id);if(mesh){mesh.matrix.identity();mesh.matrixWorldNeedsUpdate=true;}}directDrag=null;orbit.enableRotate=true;draw();}
    if (!drag) return;
    for (const id of drag.transforms.keys()) { const mesh = meshes.get(id); if (mesh) { mesh.matrix.identity(); mesh.matrixWorldNeedsUpdate = true; } }
    drag = null; gizmo.reset(); orbit.enabled = true; placeGizmo();
  };
  const endTransform = () => {
    if (!drag) return; const d = delta(); const updates: { id: string; transform: Transform }[] = [];
    try {
      for (const [id, original] of drag.transforms) updates.push({id,transform:applyGizmoDelta(original,d,activeMode==='select'?'translate':activeMode,pivot.scale.toArray() as Vec3)});
    } catch(error){cancelTransform();onError(error);return;}
    drag = null;
    try { session.transform(updates); draw(); } catch (e) { for (const mesh of meshes.values()) { mesh.matrix.identity(); mesh.matrixWorldNeedsUpdate = true; } onError(e); placeGizmo(); }
  };
  gizmo.addEventListener('dragging-changed', onDrag); gizmo.addEventListener('mouseDown', startTransform); gizmo.addEventListener('objectChange', previewTransform); gizmo.addEventListener('mouseUp', endTransform);
  const resize = new ResizeObserver(() => { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); if (camera instanceof THREE.PerspectiveCamera) camera.aspect = w / h; else { const half = (camera.top - camera.bottom) / 2; camera.left = -half * w / h; camera.right = half * w / h; } camera.updateProjectionMatrix(); draw(); }); resize.observe(container);
  orbit.addEventListener('change', draw); gizmo.addEventListener('change', draw);
  let down: { x: number; y: number; t: number; pointerId: number } | null = null; const touches = createTouchTracker(); let suppressTap = false;
  function pointerRay(e:PointerEvent){const rect=canvas.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);}
  const onDown = (e: PointerEvent) => {
    canvas.focus({ preventScroll: true });
    if (e.pointerType === 'touch') { touches.down({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }); if (touches.count > 1) suppressTap = true; }
    if (!down) { down = { x: e.clientX, y: e.clientY, t: e.timeStamp, pointerId: e.pointerId }; if (e.pointerType !== 'touch') suppressTap = false; }
    if (gizmo.axis) suppressTap = true;
    if(touches.count>1){if(directDrag)cancelTransform();return;}
    if(activeMode==='select'&&e.button===0&&!multiSelect&&!e.shiftKey&&!e.ctrlKey&&!e.metaKey){pointerRay(e);const hit=ray.intersectObjects([...meshes.values()],false)[0];const id=hit?.object.userData.id as string|undefined;if(id){if(!selected.includes(id))session.select([id]);const view=camera.getWorldDirection(new THREE.Vector3()),normal=Math.abs(view.z)<.25?(Math.abs(view.x)>Math.abs(view.y)?new THREE.Vector3(1,0,0):new THREE.Vector3(0,1,0)):new THREE.Vector3(0,0,1);const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(normal,hit.point);const start=ray.ray.intersectPlane(plane,new THREE.Vector3());if(start){directDrag={pointerId:e.pointerId,start:start.clone(),plane,transforms:new Map(selected.filter(id=>session.state.document.roots.includes(id)).map(id=>[id,structuredClone(session.state.document.nodes[id].transform)])),offset:[0,0,0],moved:false};orbit.enableRotate=false;}}}
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') touches.move({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
    if(!directDrag||directDrag.pointerId!==e.pointerId||!down)return;
    if(!directDrag.moved&&Math.hypot(e.clientX-down.x,e.clientY-down.y)<=TOUCH_SLOP_PX)return;
    pointerRay(e);const point=ray.ray.intersectPlane(directDrag.plane,new THREE.Vector3());if(!point)return;
    const d=point.sub(directDrag.start);directDrag.offset=snapDelta([d.x,d.y,d.z],gridStep||.01);directDrag.moved=true;
    for(const id of directDrag.transforms.keys()){const mesh=meshes.get(id);if(mesh){mesh.matrixAutoUpdate=false;mesh.matrix.makeTranslation(...directDrag.offset);mesh.matrixWorldNeedsUpdate=true;}}draw();
  };
  const onUp = (e: PointerEvent) => {
    if(directDrag?.pointerId===e.pointerId){const action=directDrag;directDrag=null;orbit.enableRotate=true;if(action.moved){down=null;touches.reset();suppressTap=false;try{session.transform([...action.transforms].map(([id,transform])=>({id,transform:{...transform,position:transform.position.map((v,i)=>v+action.offset[i]) as Vec3}})));}catch(error){for(const id of action.transforms.keys()){const mesh=meshes.get(id);if(mesh){mesh.matrix.identity();mesh.matrixWorldNeedsUpdate=true;}}onError(error);draw();}return;}}
    const gesture = e.pointerType === 'touch' ? touches.up({ id: e.pointerId, t: e.timeStamp }) : null;
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
  const onCancel = () => { down = null; suppressTap = false; touches.reset(); cancelTransform(); };
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
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(body.positions, 3)); geometry.setIndex(new THREE.BufferAttribute(body.indices, 1)); geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ color: body.color, metalness: 0.08, roughness: 0.65, flatShading: true });
      const mesh = new THREE.Mesh(geometry, material); mesh.userData.id = body.id;
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), new THREE.LineBasicMaterial({ color: '#172a36', transparent: true, opacity: 0.8 })); mesh.add(outline);
      meshes.set(body.id, mesh); outlines.set(body.id, outline); scene.add(mesh);
    } setSelection(selected); draw();
  }
  function setView(direction: ViewDirection) {
    cancelTransform(); const distance = camera.position.distanceTo(orbit.target);
    camera.position.copy(orbit.target).addScaledVector(new THREE.Vector3(...directions[direction]).normalize(), distance); orbit.update(); draw();
  }
  function frame(direction?: ViewDirection) {
    const box = new THREE.Box3(); for (const mesh of meshes.values()) box.union(new THREE.Box3().setFromObject(mesh));
    if (box.isEmpty()) box.set(new THREE.Vector3(-20, -20, 0), new THREE.Vector3(20, 20, 30));
    const center = box.getCenter(new THREE.Vector3()); const radius = Math.max(15, box.getSize(new THREE.Vector3()).length() / 2);
    const aspect = Math.max(0.1, container.clientWidth / Math.max(1, container.clientHeight));
    const distance = radius / Math.sin(42 * RAD / 2) / Math.min(1, aspect) * 1.2;
    const dir = direction ? new THREE.Vector3(...directions[direction]) : camera.position.clone().sub(orbit.target);
    if (camera instanceof THREE.OrthographicCamera) { const half = radius * 1.2 / Math.min(1, aspect); camera.top = half; camera.bottom = -half; camera.left = -half * aspect; camera.right = half * aspect; camera.zoom = 1; camera.updateProjectionMatrix(); }
    camera.position.copy(center).addScaledVector(dir.normalize(), distance); orbit.target.copy(center); orbit.update(); draw();
  }
  draw();
  return { canvas, update, setSelection, frame, setView, cancelTransform,
    get appearance(){return {...colours};},setAppearance(value:{background:string;baseplate:string}){if(!validColour(value.background)||!validColour(value.baseplate))throw new Error(t('Choose a six-digit colour'));Object.assign(colours,value);(scene.background as THREE.Color).set(value.background);plate.material.color.set(value.baseplate);canvas.dataset.backgroundColour=value.background;canvas.dataset.baseplateColour=value.baseplate;draw();},
    setReadoutVisible(visible:boolean){annotationsVisible=visible;draw();},
    setTransformPreviewListener(listener:(preview:TransformPreview)=>void){previewListener=listener;draw();},
    setViewListener(listener: (view: ViewDirection) => void) { viewListener = listener; draw(); },
    setMultiSelect(enabled: boolean) { multiSelect = enabled; },
    zoom(factor: number) {
      if (camera instanceof THREE.OrthographicCamera) { camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, 0.01, 1000); camera.updateProjectionMatrix(); }
      else { const offset = camera.position.clone().sub(orbit.target); camera.position.copy(orbit.target).add(offset.setLength(THREE.MathUtils.clamp(offset.length() / factor, orbit.minDistance, orbit.maxDistance))); }
      orbit.update(); draw();
    },
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
    setMode(mode: 'select' | 'translate' | 'rotate' | 'scale') { cancelTransform();activeMode=mode;canvas.dataset.mode=mode;if(mode!=='select'){gizmo.setMode(mode); gizmo.setSpace(mode === 'scale' ? 'local' : 'world');}placeGizmo();draw(); },
    setGrid(step: number) { gridStep = step; gizmo.setTranslationSnap(gridStep || null); },
    nudge(dx: number, dy: number, dz: number) {
      const offset = snapDelta([dx, dy, dz], gridStep || 0.01);
      session.transform(selected.filter(id => session.state.document.roots.includes(id)).map(id => { const transform = structuredClone(session.state.document.nodes[id].transform); transform.position = transform.position.map((v, i) => v + offset[i]) as Vec3; return { id, transform }; }));
    },
    dispose() { disposed = true; resize.disconnect(); touches.reset(); canvas.removeEventListener('pointerdown', onDown,true); canvas.removeEventListener('pointermove', onMove,true); canvas.removeEventListener('pointerup', onUp,true); canvas.removeEventListener('pointercancel', onCancel); gizmo.removeEventListener('dragging-changed', onDrag); gizmo.removeEventListener('mouseDown', startTransform); gizmo.removeEventListener('objectChange', previewTransform); gizmo.removeEventListener('mouseUp', endTransform); gizmo.removeEventListener('change', draw); orbit.removeEventListener('change', draw); gizmo.dispose(); orbit.dispose(); clear(); for (const object of [grid, majorGrid, border, plate, axes]) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => material.dispose()); } for (const sprite of textSprites) { sprite.material.map?.dispose(); sprite.material.dispose(); } renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); cube.remove(); },
  };
}
