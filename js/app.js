// woodstove2 app: сцена + UI + креслення SVG + тур + експорт
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { defaultConfig, loadConfig, saveConfig, normalizeConfig, applyModePreset, getByPath, setByPath, OPERATION_PRESETS } from './config.js';
import { PhysicsModel } from './physics-model.js';
import { buildStove, disposeGroup } from './stove-builder.js';
import { exportGLTF, exportSTL } from './exporters.js';

let config = loadConfig();
const cache = new Map(); // кеш матеріалів

// ---------- сцена ----------
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1115);
const camera = new THREE.PerspectiveCamera(config.camera.fov, innerWidth / innerHeight, 0.5, 4000);
camera.position.set(190, 170, 220);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.minDistance = 80; controls.maxDistance = 800;

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(150, 230, 130); key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -250; key.shadow.camera.right = 250;
key.shadow.camera.top = 300; key.shadow.camera.bottom = -100;
scene.add(key);
const rim = new THREE.DirectionalLight(0x88aaff, 0.5); rim.position.set(-140, 120, -160); scene.add(rim);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400),
  new THREE.MeshStandardMaterial({ color: config.colors.floor, roughness: 0.92 }));
floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
const grid = new THREE.GridHelper(1200, 120, 0x3a4150, 0x232833); grid.position.y = 0.05; scene.add(grid);
scene.add(new THREE.AxesHelper(80));

// ---------- стан анімацій ----------
let stove = null, refs = {};
let doorCur = 0, doorTarget = 0;
let explodeCur = config.explode.enabled ? 1 : 0, explodeTarget = explodeCur;

function rebuildStove() {
  if (stove) { scene.remove(stove); disposeGroup(stove); }
  const built = buildStove(config, cache);
  stove = built.group; refs = built.refs;
  scene.add(stove);
  doorTarget = config.door.isOpen ? -THREE.MathUtils.degToRad(config.door.openAngleDeg) : 0;
  doorCur = doorTarget; refs.doorPivot.rotation.y = doorCur;
  floor.material.color.set(config.colors.floor);
  applyVisibility(); applyExplode(1); syncCamera(false);
}
let rebuildTimer = 0;
const scheduleRebuild = () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildStove, 120); };

function applyVisibility() {
  if (!refs.firebrick) return;
  refs.firebrick.visible = config.visibility.firebrick;
  refs.baffle.visible = config.visibility.baffle;
  refs.airSystems.visible = config.visibility.airChannels;
  refs.chimney.visible = refs.collar.visible = config.visibility.chimney;
}
function applyExplode(snap = 0) {
  if (snap) explodeCur = explodeTarget;
  const dist = config.explode.distanceCm;
  const map = {
    chimney: [0, dist * 1.2, 0], collar: [0, dist * 1.2, 0],
    doorPivot: [0, 0, dist * 0.9], firebrick: [-dist * 0.4, 0, 0],
    baffle: [dist * 0.35, dist * 0.2, 0], airSystems: [0, 0, dist * 0.65], chamber: [0, 0, -dist * 0.35],
  };
  for (const [k, v] of Object.entries(map)) {
    const n = refs[k]; if (!n?.userData.basePosition) continue;
    n.position.set(n.userData.basePosition.x + v[0] * explodeCur, n.userData.basePosition.y + v[1] * explodeCur, n.userData.basePosition.z + v[2] * explodeCur);
  }
}

// ---------- камера / види ----------
function syncCamera(reposition = true) {
  camera.fov = config.camera.fov; camera.updateProjectionMatrix();
  const ty = THREE.MathUtils.clamp(config.camera.targetY, config.dimensions.legHeightCm + 10, config.dimensions.legHeightCm + config.dimensions.heightCm);
  controls.target.set(0, ty, 0);
  if (reposition) {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1) dir.set(1, 0.7, 1);
    dir.normalize().multiplyScalar(config.camera.distance);
    camera.position.copy(controls.target.clone().add(dir));
  }
  controls.update();
}
const DRAW_DEFS = {
  'drawing-front': { pos: [0, 75, 380], up: [0, 1, 0], dims: ['W', 'H'] },
  'drawing-side': { pos: [380, 75, 0], up: [0, 1, 0], dims: ['D', 'H'] },
  'drawing-top': { pos: [0, 460, 0.01], up: [0, 0, -1], dims: ['W', 'D'] },
};
function applyViewMode() {
  const overlay = document.getElementById('drawing-overlay');
  const m = config.viewMode;
  document.getElementById('viewMode').value = m;
  if (m === '3d') { overlay.style.display = 'none'; controls.enabled = true; syncCamera(false); return; }
  const def = DRAW_DEFS[m]; if (!def) return;
  controls.enabled = false;
  camera.position.set(...def.pos); camera.up.set(...def.up);
  controls.target.set(0, config.dimensions.legHeightCm + config.dimensions.heightCm * 0.5, 0);
  camera.lookAt(controls.target); camera.updateProjectionMatrix();
  overlay.style.display = 'block'; renderOverlaySVG();
}
function project(v3) {
  const v = v3.clone().project(camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
}
function renderOverlaySVG() {
  const { widthCm: W, depthCm: D, heightCm: H, legHeightCm: L } = config.dimensions;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const dims = [];
  if (config.viewMode === 'drawing-front') {
    dims.push({ t: `W: ${W} см`, a: new THREE.Vector3(-W / 2, L + 4, D / 2 + 3), b: new THREE.Vector3(W / 2, L + 4, D / 2 + 3) });
    dims.push({ t: `H: ${H + L} см`, a: new THREE.Vector3(W / 2 + 7, L, D / 2 + 3), b: new THREE.Vector3(W / 2 + 7, L + H, D / 2 + 3) });
  } else if (config.viewMode === 'drawing-side') {
    dims.push({ t: `D: ${D} см`, a: new THREE.Vector3(W / 2 + 3, L + 4, -D / 2), b: new THREE.Vector3(W / 2 + 3, L + 4, D / 2) });
    dims.push({ t: `H: ${H + L} см`, a: new THREE.Vector3(W / 2 + 3, L, D / 2 + 8), b: new THREE.Vector3(W / 2 + 3, L + H, D / 2 + 8) });
  } else {
    const y = L + H + 4;
    dims.push({ t: `W: ${W} см`, a: new THREE.Vector3(-W / 2, y, D / 2 + 5), b: new THREE.Vector3(W / 2, y, D / 2 + 5) });
    dims.push({ t: `D: ${D} см`, a: new THREE.Vector3(W / 2 + 5, y, -D / 2), b: new THREE.Vector3(W / 2 + 5, y, D / 2) });
  }
  for (const dm of dims) {
    const a = project(dm.a), b = project(dm.b);
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    line.setAttribute('stroke', '#e8ebf1'); line.setAttribute('stroke-width', '2');
    svg.appendChild(line);
    for (const p of [a, b]) {
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', p.x); c.setAttribute('cy', p.y); c.setAttribute('r', '4'); c.setAttribute('fill', '#4f8cff');
      svg.appendChild(c);
    }
    const tx = (a.x + b.x) / 2, ty = (a.y + b.y) / 2 - 14;
    const label = document.createElementNS(svgNS, 'g');
    label.innerHTML = `<rect x="${tx - 52}" y="${ty - 12}" width="104" height="24" rx="6" fill="rgba(10,13,18,.9)" stroke="#4f8cff"/><text x="${tx}" y="${ty + 5}" text-anchor="middle" font-size="12" fill="#fff">${dm.t}</text>`;
    svg.appendChild(label);
  }
  const ov = document.getElementById('drawing-overlay');
  ov.innerHTML = ''; ov.appendChild(svg);
}

// ---------- фізика ----------
function renderPhysics() {
  const r = PhysicsModel.evaluate(config);
  document.getElementById('m-eff').textContent = `${r.metrics.efficiencyPct}%`;
  document.getElementById('m-kw').textContent = `${r.metrics.heatOutputKw} кВт`;
  document.getElementById('m-burn').textContent = `${r.metrics.burnTimeHours} год`;
  document.getElementById('m-draft').textContent = `${r.metrics.draftPa} Па · ${r.metrics.fireboxLiters} л`;
  const ul = document.getElementById('warnings'); ul.innerHTML = '';
  if (!r.warnings.length) ul.innerHTML = '<li>Проблем не виявлено.</li>';
  for (const wmsg of r.warnings) {
    const li = document.createElement('li'); li.className = wmsg.level; li.textContent = `[${wmsg.code}] ${wmsg.message}`;
    ul.appendChild(li);
  }
}

// ---------- UI прив'язка ----------
const controlMap = {
  widthCm: 'dimensions.widthCm', depthCm: 'dimensions.depthCm', heightCm: 'dimensions.heightCm', legHeightCm: 'dimensions.legHeightCm',
  steelThicknessMm: 'materials.steelThicknessMm', firebrickThicknessCm: 'materials.firebrickThicknessCm',
  baffleHeightCm: 'baffle.heightCm', baffleAngleDeg: 'baffle.angleDeg', baffleFrontGapCm: 'baffle.frontGapCm', baffleAirflowPct: 'baffle.airflowPct',
  primaryHoleCount: 'primaryAir.holeCount', primaryHoleDiameterCm: 'primaryAir.holeDiameterCm', primaryHoleSpacingCm: 'primaryAir.holeSpacingCm', primaryAirOpenPct: 'primaryAir.openPct',
  secondaryHoleCount: 'secondaryAir.holeCount', secondaryHoleDiameterCm: 'secondaryAir.holeDiameterCm', secondaryHoleSpacingCm: 'secondaryAir.holeSpacingCm',
  airWashGapCm: 'airWash.gapCm', airWashIntakePct: 'airWash.intakePct',
  chimneyDiameterCm: 'chimney.diameterCm', chimneyHeightCm: 'chimney.heightCm',
  doorWidthCm: 'door.widthCm', doorHeightCm: 'door.heightCm', glassInsetCm: 'door.glassInsetCm', doorFrameThicknessCm: 'door.frameThicknessCm', doorOpenAngleDeg: 'door.openAngleDeg',
  explodeDistanceCm: 'explode.distanceCm',
  cameraFov: 'camera.fov', cameraDistance: 'camera.distance', cameraTargetYCm: 'camera.targetY',
  steelColor: 'colors.steel', brickColor: 'colors.brick', glassColor: 'colors.glass', floorColor: 'colors.floor',
  steelRoughness: 'colors.steelRoughness', steelMetalness: 'colors.steelMetalness',
};
function fmt(id, v) {
  if (String(id).includes('Pct') || id === 'baffleAirflowPct' || id === 'airWashIntakePct') return `${v}%`;
  if (id === 'steelThicknessMm') return `${v} мм`;
  if (/Deg|Fov/i.test(id)) return `${v}°`;
  if (id === 'steelRoughness' || id === 'steelMetalness') return `${(+v).toFixed(2)}`;
  if (/Color/i.test(id)) return `${v}`;
  return `${v} см`;
}
function syncUI() {
  for (const [id, path] of Object.entries(controlMap)) {
    const el = document.getElementById(id); if (!el) continue;
    const v = getByPath(config, path); el.value = v;
    const o = document.getElementById(`${id}-v`); if (o) o.textContent = fmt(id, v);
  }
  document.getElementById('operationMode').value = config.operation.mode;
  document.getElementById('viewMode').value = config.viewMode;
  for (const [id, k] of Object.entries({ showFirebrick: 'firebrick', showBaffle: 'baffle', showAirChannels: 'airChannels', showChimney: 'chimney' })) {
    const el = document.getElementById(id); if (el) el.checked = config.visibility[k];
  }
  document.getElementById('modeHint').textContent =
    `${config.operation.mode} · primary ${Math.round(config.primaryAir.openPct)}% · secondary ${Math.round(config.operation.secondaryAirPct)}%`;
}
function bindUI() {
  for (const [id, path] of Object.entries(controlMap)) {
    const el = document.getElementById(id); if (!el) continue;
    el.addEventListener('input', () => {
      let v = el.type === 'color' ? el.value : parseFloat(el.value);
      if (el.type === 'range' && (id === 'steelRoughness' || id === 'steelMetalness')) v = parseFloat(el.value);
      setByPath(config, path, v);
      normalizeConfig(config); saveConfig(config);
      const o = document.getElementById(`${id}-v`); if (o) o.textContent = fmt(id, getByPath(config, path));
      if (['showFirebrick', 'showBaffle'].includes(id)) { applyVisibility(); return; }
      if (id.startsWith('steel') || id.endsWith('Color') || id === 'brickColor' || id === 'glassColor' || id === 'floorColor' || id === 'steelRoughness' || id === 'steelMetalness') {
        cache.clear(); // кольори/матеріали — скинути кеш
      }
      if (id === 'doorOpenAngleDeg' && config.door.isOpen) doorTarget = -THREE.MathUtils.degToRad(config.door.openAngleDeg);
      if (id === 'explodeDistanceCm') { applyExplode(1); renderPhysics(); return; }
      if (id.startsWith('camera')) { syncCamera(id !== 'cameraTargetYCm'); renderPhysics(); return; }
      scheduleRebuild(); renderPhysics();
      if (config.viewMode !== '3d') renderOverlaySVG();
    });
  }
  document.getElementById('operationMode').addEventListener('change', (e) => {
    applyModePreset(config, e.target.value); saveConfig(config);
    cache.clear(); syncUI(); rebuildStove(); renderPhysics();
  });
  document.getElementById('viewMode').addEventListener('change', (e) => {
    config.viewMode = e.target.value; normalizeConfig(config); saveConfig(config); applyViewMode();
  });
  for (const [id, k] of Object.entries({ showFirebrick: 'firebrick', showBaffle: 'baffle', showAirChannels: 'airChannels', showChimney: 'chimney' })) {
    document.getElementById(id).addEventListener('change', (e) => {
      config.visibility[k] = e.target.checked; saveConfig(config); applyVisibility();
    });
  }
  document.getElementById('toggleDoor').addEventListener('click', () => {
    config.door.isOpen = !config.door.isOpen; saveConfig(config);
    doorTarget = config.door.isOpen ? -THREE.MathUtils.degToRad(config.door.openAngleDeg) : 0;
    document.getElementById('toggleDoor').textContent = config.door.isOpen ? 'Закрити дверця' : 'Відкрити дверця';
  });
  document.getElementById('toggleExplode').addEventListener('click', (e) => {
    config.explode.enabled = !config.explode.enabled; saveConfig(config);
    explodeTarget = config.explode.enabled ? 1 : 0;
    e.target.textContent = config.explode.enabled ? 'Зібрати' : 'Explode';
  });
  document.getElementById('resetConfig').addEventListener('click', () => {
    localStorage.removeItem('woodstove2ConfigV1');
    config = normalizeConfig(structuredClone(defaultConfig));
    cache.clear(); syncUI(); rebuildStove(); renderPhysics(); applyViewMode();
    document.getElementById('toggleDoor').textContent = 'Відкрити дверця';
  });
  document.getElementById('saveJson').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `woodstove-${Date.now()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  });
  document.getElementById('loadJson').addEventListener('click', () => document.getElementById('fileJson').click());
  document.getElementById('fileJson').addEventListener('change', async (e) => {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      config = normalizeConfig({ ...structuredClone(defaultConfig), ...parsed, dimensions: { ...defaultConfig.dimensions, ...parsed.dimensions } });
      // глибока міграція кольорів
      config.colors = { ...defaultConfig.colors, ...(parsed.colors || {}) };
      saveConfig(config); cache.clear(); syncUI(); rebuildStove(); renderPhysics(); applyViewMode();
    } catch { alert('Невалідний JSON'); }
    e.target.value = '';
  });
  document.getElementById('exportGltf').addEventListener('click', () => exportGLTF(stove));
  document.getElementById('exportStl').addEventListener('click', () => exportSTL(stove));
  document.getElementById('showTour').addEventListener('click', () => { document.getElementById('tour').style.display = 'flex'; });
  document.getElementById('closeTour').addEventListener('click', () => { document.getElementById('tour').style.display = 'none'; });
  document.getElementById('tour').addEventListener('click', (e) => { if (e.target.id === 'tour') e.target.style.display = 'none'; });
}

// ---------- цикл ----------
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  doorCur += (doorTarget - doorCur) * 0.12;
  if (refs.doorPivot) refs.doorPivot.rotation.y = doorCur;
  explodeCur += (explodeTarget - explodeCur) * 0.1;
  applyExplode();
  // полум'я
  if (refs.flame) {
    const base = config.operation.flameIntensity;
    const pulse = (Math.sin(t * (4 + base * 5)) + 1) * 0.5;
    const inten = Math.max(0.05, base * (0.75 + pulse * 0.5));
    const preset = OPERATION_PRESETS[config.operation.mode];
    refs.flame.visible = inten > 0.04;
    refs.flame.scale.y = 0.65 + inten * 1.1;
    refs.core.material.color.setHex(preset.flameColor);
    refs.core.material.opacity = 0.25 + inten * 0.45;
    refs.outer.material.opacity = 0.12 + inten * 0.28;
    refs.sparks.forEach((s, i) => { s.position.y = 1 + ((t * (2 + i * 0.4) + i) % 7); });
  }
  controls.update();
  renderer.render(scene, camera);
  if (config.viewMode !== '3d' && (t * 10 | 0) % 10 === 0) renderOverlaySVG();
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (config.viewMode !== '3d') renderOverlaySVG();
});

// ---------- старт ----------
bindUI(); syncUI(); rebuildStove(); renderPhysics(); applyViewMode();
document.getElementById('toggleDoor').textContent = config.door.isOpen ? 'Закрити дверця' : 'Відкрити дверця';
document.getElementById('toggleExplode').textContent = config.explode.enabled ? 'Зібрати' : 'Explode';
animate();
