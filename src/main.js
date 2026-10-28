import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---- CONFIG: rename these to match your files/Blender names ----
const CFG = {
  showroom: '/models/showroom.glb',
  lowModel:  (sku) => `/models/products/${sku}_low.glb`,
  highModel: (sku) => `/models/products/${sku}_high.glb`,
  products: '/data/products.json',
  slotPrefix: 'Slot_',
  spawnName: 'Spawn_Entrance',
  eyeHeight: 1.6,
  walkSpeed: 2.2,
  // Phase 4: feet view
  feetRig: '/models/feet_rig.glb', walkClip: 'Walk', footL: 'Foot_L', footR: 'Foot_R',
  shoeOffset: [0, 0, 0], shoeRot: [0, 0, 0],   // tweak until the shoe sits right on your foot bones
  // Phase 5: size filter rooms
  shelfUnit: '/models/shelf_unit.glb', filterOrigin: new THREE.Vector3(60, 0, 0),
};

// ---- renderer / scenes ----
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#dce8f2');
scene.add(new THREE.HemisphereLight('#ffffff', '#b8c4d4', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.2); sun.position.set(3, 6, 4); scene.add(sun);
const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);

const inspectScene = new THREE.Scene();
inspectScene.background = new THREE.Color('#e9eef6');
inspectScene.add(new THREE.HemisphereLight('#ffffff', '#c9d2e0', 2));
const key = new THREE.DirectionalLight('#ffffff', 2); key.position.set(2, 3, 2); inspectScene.add(key);
const inspectCam = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
const orbit = new OrbitControls(inspectCam, canvas);
orbit.enableDamping = true; orbit.enablePan = false; orbit.enabled = false;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  for (const c of [camera, inspectCam]) { c.aspect = w / h; c.updateProjectionMatrix(); }
}
addEventListener('resize', resize); resize();

// ---- loaders ----
const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
const load = (url) => loader.loadAsync(url);

// ---- showroom (falls back to a procedural room so it runs without any .glb) ----
function fallbackRoom() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: .9 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), mat('#f4efe8')); floor.rotation.x = -Math.PI / 2; g.add(floor);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 3.5, .2), mat('#cfe0ee')); wall.position.set(0, 1.75, -4); g.add(wall);
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(4, .9, .6), mat('#ffffff')); shelf.position.set(0, .45, -3.4); g.add(shelf);
  for (let i = 1; i <= 5; i++) {
    const s = new THREE.Object3D(); s.name = `${CFG.slotPrefix}${String(i).padStart(2, '0')}`;
    s.position.set(-1.6 + (i - 1) * 0.8, .9, -3.4); s.userData.displayScale = 1.8; g.add(s);
  }
  const sp = new THREE.Object3D(); sp.name = CFG.spawnName; sp.position.set(0, 0, 1.5); g.add(sp);
  return g;
}
function fallbackShoe(color) {   // origin = bottom centre of sole, toe toward +Z
  const g = new THREE.Group(), m = new THREE.MeshStandardMaterial({ color, roughness: .6 });
  const sole = new THREE.Mesh(new THREE.BoxGeometry(.055, .015, .12), new THREE.MeshStandardMaterial({ color: '#ffffff' })); sole.position.y = .0075;
  const upper = new THREE.Mesh(new THREE.BoxGeometry(.05, .04, .09), m); upper.position.set(0, .035, -.01);
  g.add(sole, upper); return g;
}

let room;
try { room = (await load(CFG.showroom)).scene; } catch { console.warn('showroom.glb not found, using fallback room'); room = fallbackRoom(); }
scene.add(room);

const slots = new Map();
room.traverse((o) => { if (o.name.startsWith(CFG.slotPrefix)) slots.set(o.name, o); });

const spawn = room.getObjectByName(CFG.spawnName);
if (spawn) { camera.position.copy(spawn.getWorldPosition(new THREE.Vector3())); camera.position.y = CFG.eyeHeight; }
else camera.position.set(0, CFG.eyeHeight, 2);
let yaw = 0, pitch = 0;

// ---- products -> slots ----
const products = await (await fetch(CFG.products)).json();
const visibleProducts = products.filter((p) => p.visible !== false);   // hidden products never spawn
const shelfGroup = new THREE.Group(); scene.add(shelfGroup);
const pickables = new Set();
const lowCache = new Map();
const getLow = (p) => {
  if (!lowCache.has(p.sku)) lowCache.set(p.sku, load(CFG.lowModel(p.sku)).then((g) => g.scene, () => fallbackShoe(p.color || '#f2b632')));
  return lowCache.get(p.sku);
};
async function makeProxy(p, slot, parent) {       // parent must sit at the world origin
  const proxy = (await getLow(p)).clone(true);
  slot.updateWorldMatrix(true, false);
  slot.matrixWorld.decompose(proxy.position, proxy.quaternion, new THREE.Vector3());
  proxy.scale.setScalar(slot.userData.displayScale ?? 1);
  proxy.userData.product = p;
  proxy.traverse((o) => { if (o.isMesh) pickables.add(o); });
  parent.add(proxy);
}
await Promise.all(visibleProducts.filter((p) => slots.has(p.slot)).map((p) => makeProxy(p, slots.get(p.slot), shelfGroup)));
const home = camera.position.clone();

// ---- walking: drag to look, WASD to move ----
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));
let drag = null, mode = 'walk';
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || mode !== 'walk') return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  yaw -= dx * 0.004; pitch = THREE.MathUtils.clamp(pitch - dy * 0.004, -1.2, 1.2);
});
canvas.addEventListener('pointerup', (e) => { if (mode === 'walk' && drag && drag.moved < 5) pick(e); drag = null; });

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pick(e) {
  ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([...pickables], false)[0];
  if (!hit) return;
  let o = hit.object; while (o && !o.userData.product) o = o.parent;
  if (o) openInspect(o.userData.product, o);
}

// ---- inspect + Phase 4: feet view ----
const $ = (id) => document.getElementById(id);
let current = null, shown = null, view = 'shoe', feet = null;

function show(obj) {
  if (shown) inspectScene.remove(shown);
  inspectScene.add(obj); shown = obj;
  const b = new THREE.Box3().setFromObject(obj), c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length() || 1;
  inspectCam.position.set(c.x + s * .9, c.y + s * .5, c.z + s * 1.1);
  orbit.target.copy(c); orbit.minDistance = s * .6; orbit.maxDistance = s * 3; orbit.update();
}
async function loadFeet() {
  if (feet) return feet;
  try {
    const g = await load(CFG.feetRig), mixer = new THREE.AnimationMixer(g.scene);
    const clip = THREE.AnimationClip.findByName(g.animations, CFG.walkClip) ?? g.animations[0];
    if (clip) mixer.clipAction(clip).play();
    feet = { root: g.scene, mixer, L: g.scene.getObjectByName(CFG.footL), R: g.scene.getObjectByName(CFG.footR) };
  } catch {                                           // placeholder legs that swing, so the flow works without feet_rig.glb
    console.warn('feet_rig.glb not found, using placeholder legs');
    const root = new THREE.Group(), legs = [], foot = [];
    for (const [name, x] of [[CFG.footL, -.06], [CFG.footR, .06]]) {
      const leg = new THREE.Group(); leg.position.set(x, .35, 0);
      leg.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(.03, .3, 4, 8), new THREE.MeshStandardMaterial({ color: '#e8c4a8' })), { position: new THREE.Vector3(0, -.17, 0) }));
      const f = new THREE.Object3D(); f.name = name; f.position.y = -.34; leg.add(f);
      root.add(leg); legs.push(leg); foot.push(f);
    }
    feet = { root, legs, L: foot[0], R: foot[1] };
  }
  return feet;
}
function attachShoes(raw) {
  for (const foot of [feet.L, feet.R]) {
    if (!foot) continue;
    foot.children.filter((c) => c.userData.shoe).forEach((c) => foot.remove(c));
    const s = raw.clone(true); s.userData.shoe = true;
    s.position.set(...CFG.shoeOffset); s.rotation.set(...CFG.shoeRot);
    if (foot === feet.R) s.scale.x = -1;              // one modelled shoe, mirrored for the other foot
    foot.add(s);
  }
}
async function setView(v) {
  view = v; $('feet').textContent = v === 'feet' ? 'Shoe view' : 'Feet view';
  if (v === 'feet') { await loadFeet(); attachShoes(current.raw); show(feet.root); } else show(current.raw);
}
async function openInspect(p, proxy) {
  mode = 'inspect'; document.body.classList.add('inspecting'); $('hint').style.display = 'none';
  fillPanel(p);
  let raw;                                            // LOD swap: proxy -> high-poly
  try { raw = (await load(CFG.highModel(p.sku))).scene; }
  catch { raw = proxy.clone(true); raw.position.set(0, 0, 0); raw.quaternion.identity(); raw.scale.setScalar(1); }
  if (mode !== 'inspect') return;                     // user backed out while loading
  current = { p, raw };
  await setView('shoe');
  orbit.enabled = true; $('panel').classList.add('open');
}
function closeInspect() {
  if (mode !== 'inspect') return;
  mode = 'walk'; orbit.enabled = false; view = 'shoe'; $('feet').textContent = 'Feet view';
  $('panel').classList.remove('open'); document.body.classList.remove('inspecting'); $('hint').style.display = '';
  if (shown) inspectScene.remove(shown);
  shown = current = null;                             // frees the heavy model
}
function fillPanel(p) {
  $('name').textContent = p.name; $('price').textContent = p.price;
  $('sizes').replaceChildren(...p.sizes.map((s) => Object.assign(document.createElement('span'), { textContent: s })));
  $('order').onclick = () => window.open(p.orderUrl.replace('{sku}', encodeURIComponent(p.sku)), '_blank', 'noopener');
}
$('back').onclick = closeInspect;
$('feet').onclick = () => current && setView(view === 'feet' ? 'shoe' : 'feet');
addEventListener('keydown', (e) => { if (e.code === 'Escape') closeInspect(); });

// ---- Phase 5: size filter -> teleport to a generated room ----
const filterGroup = new THREE.Group(); scene.add(filterGroup);
let unitPromise;
const slotsOf = (o) => { const a = []; o.traverse((n) => { if (n.name.startsWith(CFG.slotPrefix)) a.push(n); }); return a.sort((x, y) => x.name.localeCompare(y.name)); };
const getUnit = () => unitPromise ??= load(CFG.shelfUnit).then((g) => g.scene, () => {
  const u = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, .9, .5), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .9 })); box.position.y = .45; u.add(box);
  [-.5, 0, .5].forEach((x, i) => { const s = new THREE.Object3D(); s.name = `${CFG.slotPrefix}0${i + 1}`; s.position.set(x, .9, 0); s.userData.displayScale = 1.8; u.add(s); });
  return u;
});
async function buildFilterRoom(size) {
  filterGroup.traverse((o) => pickables.delete(o)); filterGroup.clear();
  const list = visibleProducts.filter((p) => p.sizes.includes(size)), tpl = await getUnit();
  const per = slotsOf(tpl).length, n = Math.ceil(list.length / per), w = Math.max(8, n * 2 + 2);
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: .9 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, 10), mat('#f4efe8')); floor.rotation.x = -Math.PI / 2; floor.position.copy(CFG.filterOrigin);
  const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3.5, .2), mat('#f7e3c3')); wall.position.set(CFG.filterOrigin.x, 1.75, CFG.filterOrigin.z - 4);
  filterGroup.add(floor, wall);
  const jobs = [];
  for (let i = 0; i < n; i++) {
    const unit = tpl.clone(true);
    unit.position.set(CFG.filterOrigin.x + (i - (n - 1) / 2) * 2, 0, CFG.filterOrigin.z - 3.4);
    filterGroup.add(unit); unit.updateMatrixWorld(true);
    slotsOf(unit).forEach((s, j) => { const p = list[i * per + j]; if (p) jobs.push(makeProxy(p, s, filterGroup)); });
  }
  await Promise.all(jobs);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let busy = false;
async function selectSize(size) {
  if (busy || mode !== 'walk') return;
  busy = true;
  [...$('filters').children].forEach((b) => b.classList.toggle('on', b.dataset.size === String(size ?? '')));
  $('fade').classList.add('on'); await sleep(220);
  if (size == null) camera.position.copy(home);
  else { await buildFilterRoom(size); camera.position.set(CFG.filterOrigin.x, CFG.eyeHeight, CFG.filterOrigin.z + 2.5); }
  yaw = pitch = 0;
  $('fade').classList.remove('on'); busy = false;
}
const sizes = [...new Set(visibleProducts.flatMap((p) => p.sizes))].sort((a, b) => a - b);
const chip = (label, size) => Object.assign(document.createElement('button'), { textContent: label, onclick: () => selectSize(size), dataset: { size: size ?? '' } });
$('filters').replaceChildren(chip('All sizes', null), ...sizes.map((s) => chip(`Size ${s}`, s)));
$('filters').firstChild.classList.add('on');

// ---- loop ----
const clock = new THREE.Clock(), fwd = new THREE.Vector3(), right = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), .1);
  if (mode === 'walk') {
    camera.rotation.set(pitch, yaw, 0, 'YXZ');
    camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize(); right.crossVectors(fwd, camera.up);
    const v = CFG.walkSpeed * dt;
    if (keys.has('KeyW')) camera.position.addScaledVector(fwd, v);
    if (keys.has('KeyS')) camera.position.addScaledVector(fwd, -v);
    if (keys.has('KeyD')) camera.position.addScaledVector(right, v);
    if (keys.has('KeyA')) camera.position.addScaledVector(right, -v);
    renderer.render(scene, camera);
  } else {
    if (view === 'feet' && feet) {
      feet.mixer?.update(dt);
      feet.legs?.forEach((l, i) => { l.rotation.x = Math.sin(clock.elapsedTime * 4 + i * Math.PI) * .5; });
    }
    orbit.update(); renderer.render(inspectScene, inspectCam);
  }
});