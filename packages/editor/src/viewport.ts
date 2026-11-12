// SPDX-License-Identifier: BSD-3-Clause
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { CadSession, Transform, Vec3 } from '@brickwright/cad-core';
import type { GeometryResult } from '@brickwright/cad-geometry';
import { TOUCH_SLOP_PX, createTouchTracker } from './vendor/touch-gestures.js';
import { snapDelta } from './vendor/transform-math.js';
const RAD = Math.PI / 180;
export type ViewDirection = 'top' | 'bottom' | 'front' | 'back' | 'right' | 'left' | 'iso';
const directions: Record<ViewDirection, [number, number, number]> = { top: [0, -0.00001, 1], bottom: [0, -0.00001, -1], front: [0, -1, 0], back: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0], iso: [1, -1.4, 1] };
export function mountViewport(container: HTMLElement, session: CadSession, onError: (e: unknown) => void) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#111e29');
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = new THREE.PerspectiveCamera(42, 1, 0.1, 200000); camera.up.set(0, 0, 1); camera.position.set(180, -250, 220);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; const canvas = renderer.domElement;
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', '3D workplane'); canvas.dataset.testid = 'cad-canvas'; container.append(canvas);
  const orbit = new OrbitControls(camera, canvas); orbit.target.set(0, 0, 10); orbit.enableDamping = false;
  orbit.maxPolarAngle = Math.PI * 0.98; orbit.minDistance = 2; orbit.maxDistance = 100000;
  orbit.touches.ONE = THREE.TOUCH.ROTATE; orbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  const lights = new THREE.HemisphereLight(0xb9d6ef, 0x304555, 2.4); lights.up.set(0, 0, 1); scene.add(lights);
  const key = new THREE.DirectionalLight(0xffe9ca, 3.2); key.position.set(-70, -90, 150); scene.add(key);
  const fill = new THREE.DirectionalLight(0x91c9ff, 1.5); fill.position.set(80, 50, 50); scene.add(fill);
  const workplane = new THREE.Group(); scene.add(workplane);
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: '#233644', side: THREE.DoubleSide })); plate.position.z = -0.14; workplane.add(plate);
  const grid = new THREE.GridHelper(400, 400, '#52677a', '#2f4655'); grid.rotation.x = Math.PI / 2; grid.position.z = -0.1; workplane.add(grid);
  const majorGrid = new THREE.GridHelper(400, 40, '#8c9c99', '#536861'); majorGrid.rotation.x = Math.PI / 2; majorGrid.position.z = -0.08; workplane.add(majorGrid);
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
  let disposed = false; let selected: string[] = []; let drag: { matrix: THREE.Matrix4; transforms: Map<string, THREE.Matrix4> } | null = null; let gridStep = 1; let multiSelect = false; let viewListener: ((view: ViewDirection) => void) | undefined;
  // Project an original SVG cube from the camera basis. The controls rotate with
  // the actual camera, including free orbit, without a second WebGL context.
  const ns = 'http://www.w3.org/2000/svg';
  const cube = document.createElement('div'); cube.className = 'view-cube'; cube.setAttribute('role', 'group'); cube.setAttribute('aria-label', 'View cube');
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 132 132');
  const cubeCaption = document.createElement('span'); cubeCaption.className = 'cube-caption'; cubeCaption.textContent = 'VIEW'; cube.append(svg, cubeCaption); container.append(cube);
  const faceSpecs: { name: Exclude<ViewDirection, 'iso'>; normal: number[]; corners: number[][] }[] = [
    { name:'top',normal:[0,0,1],corners:[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]] },
    { name:'bottom',normal:[0,0,-1],corners:[[-1,1,-1],[1,1,-1],[1,-1,-1],[-1,-1,-1]] },
    { name:'front',normal:[0,-1,0],corners:[[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]] },
    { name:'back',normal:[0,1,0],corners:[[1,1,-1],[-1,1,-1],[-1,1,1],[1,1,1]] },
    { name:'right',normal:[1,0,0],corners:[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]] },
    { name:'left',normal:[-1,0,0],corners:[[-1,1,-1],[-1,-1,-1],[-1,-1,1],[-1,1,1]] },
  ];
  const faces = faceSpecs.map(spec => {
    const group = document.createElementNS(ns, 'g'); group.setAttribute('role', 'button'); group.setAttribute('aria-label', spec.name[0].toUpperCase() + spec.name.slice(1)); group.setAttribute('tabindex', '0');
    const polygon = document.createElementNS(ns, 'polygon'); const text = document.createElementNS(ns, 'text'); text.textContent = spec.name.toUpperCase(); text.setAttribute('text-anchor', 'middle'); text.setAttribute('dy', '.35em'); group.append(polygon, text); svg.append(group);
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
  const draw = () => { if (!disposed) { updateCube(); renderer.render(scene, camera); } };
  const matrixFor = (t: Transform) => new THREE.Matrix4().compose(new THREE.Vector3(...t.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rotation[0] * RAD, t.rotation[1] * RAD, t.rotation[2] * RAD, 'ZYX')), new THREE.Vector3(...t.scale));
  const placeGizmo = () => {
    if (drag) return;
    const roots = selected.filter(id => session.state.document.roots.includes(id) && meshes.has(id));
    if (!roots.length) { gizmo.detach(); draw(); return; }
    const box = new THREE.Box3(); for (const id of roots) box.union(new THREE.Box3().setFromObject(meshes.get(id)!));
    pivot.position.copy(box.getCenter(new THREE.Vector3())); pivot.quaternion.identity(); pivot.scale.set(1, 1, 1); pivot.updateMatrixWorld(); gizmo.attach(pivot); draw();
  };
  const onDrag = (event: { value: unknown }) => { orbit.enabled = !event.value; };
  const startTransform = () => {
    const transforms = new Map<string, THREE.Matrix4>();
    for (const id of selected) if (session.state.document.roots.includes(id)) transforms.set(id, matrixFor(session.state.document.nodes[id].transform));
    pivot.updateMatrixWorld(); drag = { matrix: pivot.matrixWorld.clone(), transforms };
  };
  const delta = () => { pivot.updateMatrixWorld(); return new THREE.Matrix4().multiplyMatrices(pivot.matrixWorld, drag!.matrix.clone().invert()); };
  const previewTransform = () => {
    if (!drag) return; const d = delta();
    for (const id of drag.transforms.keys()) { const mesh = meshes.get(id); if (mesh) { mesh.matrixAutoUpdate = false; mesh.matrix.copy(d); mesh.matrixWorldNeedsUpdate = true; } }
    draw();
  };
  const cancelTransform = () => {
    if (!drag) return;
    for (const id of drag.transforms.keys()) { const mesh = meshes.get(id); if (mesh) { mesh.matrix.identity(); mesh.matrixWorldNeedsUpdate = true; } }
    drag = null; gizmo.reset(); orbit.enabled = true; placeGizmo();
  };
  const endTransform = () => {
    if (!drag) return; const d = delta(); const updates: { id: string; transform: Transform }[] = [];
    for (const [id, matrix] of drag.transforms) {
      const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); d.clone().multiply(matrix).decompose(p, q, s);
      const rebuilt = new THREE.Matrix4().compose(p, q, s);
      const desired = d.clone().multiply(matrix);
      if (rebuilt.elements.some((v, i) => Math.abs(v - desired.elements[i]) > 1e-5)) {
        cancelTransform(); onError(new Error('This transform would shear the object. Scale rotated bodies individually.')); return;
      }
      const e = new THREE.Euler().setFromQuaternion(q, 'ZYX');
      updates.push({ id, transform: { position: p.toArray() as Vec3, rotation: [e.x / RAD, e.y / RAD, e.z / RAD], scale: s.toArray() as Vec3 } });
    }
    drag = null;
    try { session.transform(updates); } catch (e) { for (const mesh of meshes.values()) { mesh.matrix.identity(); mesh.matrixWorldNeedsUpdate = true; } onError(e); placeGizmo(); }
  };
  gizmo.addEventListener('dragging-changed', onDrag); gizmo.addEventListener('mouseDown', startTransform); gizmo.addEventListener('objectChange', previewTransform); gizmo.addEventListener('mouseUp', endTransform);
  const resize = new ResizeObserver(() => { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); if (camera instanceof THREE.PerspectiveCamera) camera.aspect = w / h; else { const half = (camera.top - camera.bottom) / 2; camera.left = -half * w / h; camera.right = half * w / h; } camera.updateProjectionMatrix(); draw(); }); resize.observe(container);
  orbit.addEventListener('change', draw); gizmo.addEventListener('change', draw);
  let down: { x: number; y: number; t: number; pointerId: number } | null = null; const touches = createTouchTracker(); let suppressTap = false;
  const onDown = (e: PointerEvent) => {
    canvas.focus({ preventScroll: true });
    if (e.pointerType === 'touch') { touches.down({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }); if (touches.count > 1) suppressTap = true; }
    if (!down) { down = { x: e.clientX, y: e.clientY, t: e.timeStamp, pointerId: e.pointerId }; if (e.pointerType !== 'touch') suppressTap = false; }
    if (gizmo.axis) suppressTap = true;
  };
  const onMove = (e: PointerEvent) => { if (e.pointerType === 'touch') touches.move({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }); };
  const onUp = (e: PointerEvent) => {
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
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onCancel);
  function setSelection(ids: readonly string[]) {
    selected = [...ids]; for (const [id, mesh] of meshes) { mesh.material.emissive.set(selected.includes(id) ? '#433317' : '#000000'); mesh.material.emissiveIntensity = selected.includes(id) ? 0.8 : 0; outlines.get(id)?.material && ((outlines.get(id)!.material as THREE.LineBasicMaterial).color.set(selected.includes(id) ? '#ffda82' : '#172a36')); }
    placeGizmo(); draw();
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
    setMode(mode: 'translate' | 'rotate' | 'scale') { cancelTransform(); gizmo.setMode(mode); gizmo.setSpace(mode === 'scale' ? 'local' : 'world'); draw(); },
    setGrid(step: number) { gridStep = step; gizmo.setTranslationSnap(gridStep || null); },
    nudge(dx: number, dy: number, dz: number) {
      const offset = snapDelta([dx, dy, dz], gridStep || 0.01);
      session.transform(selected.filter(id => session.state.document.roots.includes(id)).map(id => { const transform = structuredClone(session.state.document.nodes[id].transform); transform.position = transform.position.map((v, i) => v + offset[i]) as Vec3; return { id, transform }; }));
    },
    dispose() { disposed = true; resize.disconnect(); touches.reset(); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onCancel); gizmo.removeEventListener('dragging-changed', onDrag); gizmo.removeEventListener('mouseDown', startTransform); gizmo.removeEventListener('objectChange', previewTransform); gizmo.removeEventListener('mouseUp', endTransform); gizmo.removeEventListener('change', draw); orbit.removeEventListener('change', draw); gizmo.dispose(); orbit.dispose(); clear(); for (const object of [grid, majorGrid, border, plate, axes]) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(material => material.dispose()); } for (const sprite of textSprites) { sprite.material.map?.dispose(); sprite.material.dispose(); } renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); cube.remove(); },
  };
}
