// SPDX-License-Identifier: BSD-3-Clause
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import type { CadSession, Transform, Vec3 } from '@brickwright/cad-core';
import type { GeometryResult } from '@brickwright/cad-geometry';
import { TOUCH_SLOP_PX, createTouchTracker } from './vendor/touch-gestures.js';
import { snapDelta } from './vendor/transform-math.js';
const RAD = Math.PI / 180;
export function mountViewport(container: HTMLElement, session: CadSession, onError: (e: unknown) => void) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#111e29');
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200000); camera.up.set(0, 0, 1); camera.position.set(115, -150, 120);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace; const canvas = renderer.domElement;
  canvas.tabIndex = 0; canvas.setAttribute('aria-label', '3D workplane'); canvas.dataset.testid = 'cad-canvas'; container.append(canvas);
  const orbit = new OrbitControls(camera, canvas); orbit.target.set(0, 0, 10); orbit.enableDamping = false;
  orbit.maxPolarAngle = Math.PI * 0.98; orbit.minDistance = 2; orbit.maxDistance = 100000;
  orbit.touches.ONE = THREE.TOUCH.ROTATE; orbit.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  const lights = new THREE.HemisphereLight(0xb9d6ef, 0x304555, 2.4); lights.up.set(0, 0, 1); scene.add(lights);
  const key = new THREE.DirectionalLight(0xffe9ca, 3.2); key.position.set(-70, -90, 150); scene.add(key);
  const fill = new THREE.DirectionalLight(0x91c9ff, 1.5); fill.position.set(80, 50, 50); scene.add(fill);
  const grid = new THREE.GridHelper(400, 40, '#4a677c', '#253d4e'); grid.rotation.x = Math.PI / 2; grid.position.z = -0.06; scene.add(grid);
  const axes = new THREE.AxesHelper(25); scene.add(axes);
  const pivot = new THREE.Object3D(); scene.add(pivot);
  const gizmo = new TransformControls(camera, canvas); gizmo.setSize(0.85); gizmo.setSpace('world'); scene.add(gizmo.getHelper());
  gizmo.setTranslationSnap(1); gizmo.setRotationSnap(15 * RAD); gizmo.setScaleSnap(0.1);
  const meshes = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>();
  const outlines = new Map<string, THREE.LineSegments>(); const ray = new THREE.Raycaster(); const pointer = new THREE.Vector2();
  let disposed = false; let selected: string[] = []; let drag: { matrix: THREE.Matrix4; transforms: Map<string, THREE.Matrix4> } | null = null; let gridStep = 1;
  const draw = () => { if (!disposed) renderer.render(scene, camera); };
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
  const resize = new ResizeObserver(() => { const w = container.clientWidth, h = container.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); draw(); }); resize.observe(container);
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
    const multi = e.shiftKey || e.ctrlKey || e.metaKey || (gesture?.type === 'end' && gesture.was === 'longPress');
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
  function frame(direction?: 'top' | 'front' | 'iso') {
    const box = new THREE.Box3(); for (const mesh of meshes.values()) box.union(new THREE.Box3().setFromObject(mesh));
    if (box.isEmpty()) box.set(new THREE.Vector3(-20, -20, 0), new THREE.Vector3(20, 20, 30));
    const center = box.getCenter(new THREE.Vector3()); const radius = Math.max(15, box.getSize(new THREE.Vector3()).length() / 2);
    const distance = radius / Math.sin(camera.fov * RAD / 2) / Math.min(1, camera.aspect) * 1.2;
    const dir = direction === 'top' ? new THREE.Vector3(0, -0.001, 1) : direction === 'front' ? new THREE.Vector3(0, -1, 0.1) : new THREE.Vector3(1, -1.4, 1);
    camera.position.copy(center).addScaledVector(dir.normalize(), distance); orbit.target.copy(center); orbit.update(); draw();
  }
  draw();
  return { canvas, update, setSelection, frame, cancelTransform,
    setMode(mode: 'translate' | 'rotate' | 'scale') { cancelTransform(); gizmo.setMode(mode); gizmo.setSpace(mode === 'scale' ? 'local' : 'world'); draw(); },
    setGrid(step: number) { gridStep = step; gizmo.setTranslationSnap(gridStep || null); },
    nudge(dx: number, dy: number, dz: number) {
      const offset = snapDelta([dx, dy, dz], gridStep || 0.01);
      session.transform(selected.filter(id => session.state.document.roots.includes(id)).map(id => { const transform = structuredClone(session.state.document.nodes[id].transform); transform.position = transform.position.map((v, i) => v + offset[i]) as Vec3; return { id, transform }; }));
    },
    dispose() { disposed = true; resize.disconnect(); touches.reset(); canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onCancel); gizmo.removeEventListener('dragging-changed', onDrag); gizmo.removeEventListener('mouseDown', startTransform); gizmo.removeEventListener('objectChange', previewTransform); gizmo.removeEventListener('mouseUp', endTransform); gizmo.removeEventListener('change', draw); orbit.removeEventListener('change', draw); gizmo.dispose(); orbit.dispose(); clear(); grid.geometry.dispose(); (grid.material as THREE.Material).dispose(); axes.geometry.dispose(); (axes.material as THREE.Material).dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove(); },
  };
}
