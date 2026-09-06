// woodstove2 app: сцена + UI + креслення SVG + тур + експорт
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { defaultConfig, loadConfig, saveConfig, normalizeConfig, applyModePreset, applyModelPreset, validateConfig, encodeConfig, decodeConfig, deepMerge, getByPath, setByPath, OPERATION_PRESETS, MODEL_PRESETS } from './config.js';
import { PhysicsModel, optimizeConfig } from './physics-model.js';
import { buildStove, disposeGroup } from './stove-builder.js';
import { exportGLTF, exportSTL } from './exporters.js';
import { STR, WARN_TXT, VALIDATION_TXT, TOUR, getLang, setLang } from './i18n.js';

let lang = getLang();
const t = (k) => (STR[lang] && STR[lang][k]) || STR.uk[k] || k;

let config = loadConfig();
const sharedValue = location.hash.startsWith('#config=') ? decodeConfig(location.hash.slice(8)) : null;
if (sharedValue) config = normalizeConfig(deepMerge(structuredClone(defaultConfig), sharedValue));
const cache = new Map(); // кеш матеріалів
const COMPARE_KEY = 'woodstove2CompareV1';

// ---------- сцена ----------
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f1115);
const camera = new THREE.PerspectiveCamera(config.camera.fov, innerWidth / innerHeight, 0.5, 4000);
camera.position.set(190, 170, 220);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.localClippingEnabled = true;
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
const axes = new THREE.AxesHelper(80); scene.add(axes);

// ---------- стан анімацій ----------
let stove = null, refs = {};
let doorCur = 0, doorTarget = 0;
let explodeCur = config.explode.enabled ? 1 : 0, explodeTarget = explodeCur;
const doorOpenAngle = () => (config.door.hingeSide === 'right' ? 1 : -1) * THREE.MathUtils.degToRad(config.door.openAngleDeg);

function rebuildStove() {
  if (stove) { scene.remove(stove); disposeGroup(stove); }
  const built = buildStove(config, cache);
  stove = built.group; refs = built.refs;
  scene.add(stove);
  doorTarget = config.door.isOpen ? doorOpenAngle() : 0;
  doorCur = doorTarget; refs.doorPivot.rotation.y = doorCur;
  floor.material.color.set(config.colors.floor);
  applyVisibility(); applySection(); applyGrid(); applyExplode(1); syncCamera(false);
}
let rebuildTimer = 0;
const scheduleRebuild = () => { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(rebuildStove, 120); };

function applyVisibility() {
  if (!refs.firebrick) return;
  refs.firebrick.visible = config.visibility.firebrick;
  refs.baffle.visible = config.visibility.baffle;
  if (refs.refractoryRoof) refs.refractoryRoof.visible = config.visibility.baffle;
  refs.airSystems.visible = config.visibility.airChannels;
  if (refs.gasChannels) refs.gasChannels.visible = config.visibility.airChannels;
  refs.chimney.visible = refs.collar.visible = config.visibility.chimney;
  if (refs.flow) refs.flow.visible = config.flow.visible;
}
const sectionPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
function applySection() {
  renderer.clippingPlanes = config.visibility.section ? [sectionPlane] : [];
}
function applyGrid() {
  const show = config.visibility.grid !== false;
  grid.visible = show; axes.visible = show;
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
  const u = t('unitCm');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const dims = [];
  if (config.viewMode === 'drawing-front') {
    dims.push({ t: `W: ${W} ${u}`, a: new THREE.Vector3(-W / 2, L + 4, D / 2 + 3), b: new THREE.Vector3(W / 2, L + 4, D / 2 + 3) });
    dims.push({ t: `H: ${H + L} ${u}`, a: new THREE.Vector3(W / 2 + 7, L, D / 2 + 3), b: new THREE.Vector3(W / 2 + 7, L + H, D / 2 + 3) });
  } else if (config.viewMode === 'drawing-side') {
    dims.push({ t: `D: ${D} ${u}`, a: new THREE.Vector3(W / 2 + 3, L + 4, -D / 2), b: new THREE.Vector3(W / 2 + 3, L + 4, D / 2) });
    dims.push({ t: `H: ${H + L} ${u}`, a: new THREE.Vector3(W / 2 + 3, L, D / 2 + 8), b: new THREE.Vector3(W / 2 + 3, L + H, D / 2 + 8) });
  } else {
    const y = L + H + 4;
    dims.push({ t: `W: ${W} ${u}`, a: new THREE.Vector3(-W / 2, y, D / 2 + 5), b: new THREE.Vector3(W / 2, y, D / 2 + 5) });
    dims.push({ t: `D: ${D} ${u}`, a: new THREE.Vector3(W / 2 + 5, y, -D / 2), b: new THREE.Vector3(W / 2 + 5, y, D / 2) });
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
  const kwU = lang === 'en' ? 'kW' : 'кВт';
  document.getElementById('m-eff').textContent = `${r.metrics.efficiencyPct}%`;
  document.getElementById('m-kw').textContent = `${r.metrics.heatOutputKw} ${kwU}`;
  document.getElementById('m-burn').textContent = `${r.metrics.burnTimeHours} ${t('unitH')}`;
  document.getElementById('m-draft').textContent = `${r.metrics.draftPa} ${t('unitPa')} · ${r.metrics.fireboxLiters} ${t('unitL')}`;
  document.getElementById('m-secondary-area').textContent = `${r.metrics.secondaryOpeningAreaCm2} cm²`;
  document.getElementById('m-secondary-velocity').textContent = `${r.metrics.secondaryVelocityMs} m/s`;
  document.getElementById('m-secondary-preheat').textContent = `${r.metrics.secondaryPreheatC} °C`;
  document.getElementById('m-airwash-area').textContent = `${r.metrics.airWashOpeningAreaCm2} cm²`;
  document.getElementById('m-airwash-velocity').textContent = `${r.metrics.airWashVelocityMs} m/s`;
  document.getElementById('m-airwash-preheat').textContent = `${r.metrics.airWashPreheatC} °C`;
  document.getElementById('m-combustion-temp').textContent = `${r.metrics.combustionTempC} °C`;
  document.getElementById('m-flue-temp').textContent = `${r.metrics.modeledFlueTempC} °C`;
  document.getElementById('m-residence').textContent = `${r.metrics.gasResidenceSeconds} s`;
  document.getElementById('m-flue-loss').textContent = `${r.metrics.flueLossPct}%`;
  document.getElementById('m-thermal-eff').textContent = `${r.metrics.combustionEfficiencyPct}% → ${r.metrics.efficiencyPct}%`;
  const ul = document.getElementById('warnings'); ul.innerHTML = '';
  if (!r.warnings.length) ul.innerHTML = `<li>${t('noIssues')}</li>`;
  for (const wmsg of r.warnings) {
    const li = document.createElement('li'); li.className = wmsg.level;
    li.textContent = `[${wmsg.code}] ${warnText(wmsg.code, wmsg.message, r.metrics.draftPa)}`;
    ul.appendChild(li);
  }
  renderValidation();
  renderTestBurn();
  renderTestLog();
}

function validationText(item) {
  const entry = VALIDATION_TXT[lang]?.[item.code] || VALIDATION_TXT.uk[item.code];
  return typeof entry === 'function' ? entry(item.values || {}) : item.code;
}

function renderValidation() {
  const list = document.getElementById('validationList');
  if (!list) return;
  const result = validateConfig(config);
  list.innerHTML = '';
  if (result.valid && !result.warnings.length) {
    list.innerHTML = `<li class="ok">✓ ${t('validConfig')}</li>`;
    return;
  }
  result.errors.forEach((item) => {
    const li = document.createElement('li'); li.className = 'error';
    li.textContent = `✕ ${validationText(item)}`; list.appendChild(li);
  });
  result.warnings.forEach((item) => {
    const li = document.createElement('li'); li.className = 'warning';
    li.textContent = `! ${validationText(item)}`; list.appendChild(li);
  });
}

function computeTestBurn() {
  const predicted = PhysicsModel.evaluate(config);
  const test = config.testBurn;
  const loadKg = test.loadMode === 'auto' ? predicted.metrics.recommendedLoadKg : test.loadKg;
  const fuelEnergyKwh = loadKg * predicted.metrics.woodEnergyKwhKg;
  const fuelInputPowerKw = fuelEnergyKwh / Math.max(test.measuredBurnHours, 0.1);
  const measuredHeatKwh = +test.measuredUsefulHeatKwh || 0;
  const hasMeasurement = measuredHeatKwh > 0;
  const measuredPower = hasMeasurement ? measuredHeatKwh / Math.max(test.measuredBurnHours, 0.1) : 0;
  const measuredEfficiency = hasMeasurement ? Math.max(0, Math.min(100, measuredHeatKwh / Math.max(fuelEnergyKwh, 0.1) * 100)) : 0;
  const errorPct = hasMeasurement
    ? ((measuredPower - predicted.metrics.heatOutputKw) / Math.max(predicted.metrics.heatOutputKw, 0.1)) * 100
    : 0;
  return { predicted, test, loadKg, fuelEnergyKwh, fuelInputPowerKw, measuredHeatKwh, hasMeasurement, measuredPower, measuredEfficiency, errorPct };
}

function renderTestBurn() {
  const target = document.getElementById('testBurnResult');
  if (!target || !config.testBurn) return;
  const r = computeTestBurn();
  const { predicted, test, loadKg } = r;
  const loadInput = document.getElementById('loadKg');
  const loadOutput = document.getElementById('loadKg-v');
  if (loadInput) { loadInput.value = loadKg; loadInput.disabled = test.loadMode === 'auto'; }
  if (loadOutput) loadOutput.textContent = `${loadKg} kg`;
  const recommendation = document.getElementById('loadRecommendation');
  if (recommendation) recommendation.textContent = `${t('recommendedLoad')}: ${predicted.metrics.recommendedLoadKg} kg · ${t('maxLoad')}: ${predicted.metrics.maxLoadKg} kg`;
  const tempSummary = `${test.flueTempC}°C / ${test.stoveTopTempC}°C / ${test.glassTempC}°C · smoke ${test.smokeOpacityPct}%`;
  if (!r.hasMeasurement) {
    target.innerHTML = `<div><b>${t('predicted')}:</b> ${predicted.metrics.heatOutputKw} kW · ${predicted.metrics.efficiencyPct}%</div>
      <div><b>${t('fuelInput')}:</b> ${r.fuelInputPowerKw.toFixed(2)} kW · ${r.fuelEnergyKwh.toFixed(1)} kWh</div>
      <div class="sub">${t('needUsefulHeat')} · ${tempSummary}</div>`;
    return;
  }
  const statusClass = Math.abs(r.errorPct) <= 15 ? '' : 'bad';
  target.innerHTML = `<div><b>${t('predicted')}:</b> ${predicted.metrics.heatOutputKw} kW · ${predicted.metrics.efficiencyPct}%</div>
    <div><b>${t('measured')}:</b> ${r.measuredPower.toFixed(2)} kW · ${r.measuredEfficiency.toFixed(1)}%</div>
    <div>${tempSummary}</div>
    <div class="${statusClass}"><b>${t('error')}:</b> ${r.errorPct >= 0 ? '+' : ''}${r.errorPct.toFixed(1)}%</div>`;
}

const TEST_LOG_KEY = 'woodstove2TestLogV1';
function getTestLog() {
  try { return JSON.parse(localStorage.getItem(TEST_LOG_KEY)) || []; } catch { return []; }
}
function renderTestLog() {
  const ul = document.getElementById('testLog');
  if (!ul) return;
  const log = getTestLog();
  ul.innerHTML = log.slice(-8).reverse().map((e) => {
    const dev = e.deviationPct >= 0 ? '+' : '';
    return `<li><b>${new Date(e.ts).toLocaleDateString()}</b> · ${e.mode} · ${e.species} · ${e.moisturePct}%<br>
      ${t('predicted')}: ${e.predictedKw} kW → ${t('measured')}: ${e.measuredKw} kW <span class="${Math.abs(e.deviationPct) <= 15 ? '' : 'bad'}">(${dev}${e.deviationPct}%)</span></li>`;
  }).join('') || `<li class="sub">${t('noTestsYet')}</li>`;
}
function saveTestToLog() {
  const r = computeTestBurn();
  if (!r.hasMeasurement) { renderTestBurn(); return; }
  const log = getTestLog();
  log.push({
    ts: Date.now(), mode: r.predicted.mode, species: config.testBurn.woodSpecies,
    moisturePct: config.testBurn.woodMoisturePct, loadKg: r.loadKg, burnHours: config.testBurn.measuredBurnHours,
    usefulHeatKwh: r.measuredHeatKwh, predictedKw: r.predicted.metrics.heatOutputKw,
    predictedEffPct: r.predicted.metrics.efficiencyPct, measuredKw: +r.measuredPower.toFixed(2),
    measuredEffPct: +r.measuredEfficiency.toFixed(1), deviationPct: +r.errorPct.toFixed(1),
  });
  try { localStorage.setItem(TEST_LOG_KEY, JSON.stringify(log.slice(-30))); } catch { /* ignore */ }
  renderTestLog();
}
function exportTestLogCsv() {
  const log = getTestLog();
  if (!log.length) return;
  const header = 'date,mode,species,moisturePct,loadKg,burnHours,usefulHeatKwh,predictedKw,predictedEffPct,measuredKw,measuredEffPct,deviationPct';
  const rows = log.map((e) => [new Date(e.ts).toISOString(), e.mode, e.species, e.moisturePct, e.loadKg, e.burnHours, e.usefulHeatKwh, e.predictedKw, e.predictedEffPct, e.measuredKw, e.measuredEffPct, e.deviationPct].join(','));
  const blob = new Blob([header + '\n' + rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `woodstove-test-log-${Date.now()}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

function renderOptimization(result) {
  const target = document.getElementById('optimizationResult');
  if (!target || !result) return;
  const b = result.config.baffle;
  target.innerHTML = `<strong>${t('optimizationDone')}</strong><br>${t('optimizeHint')}<br>H ${b.heightCm} cm · ${b.angleDeg}° · gap ${b.frontGapCm} cm · ${result.result.metrics.efficiencyPct}%`;
}

function syncModelOptions() {
  const select = document.getElementById('modelPreset');
  if (!select) return;
  const selected = select.value || 'standard';
  select.innerHTML = Object.entries(MODEL_PRESETS)
    .map(([id, preset]) => `<option value="${id}">${t(preset.labelKey)}</option>`).join('');
  select.value = MODEL_PRESETS[selected] ? selected : 'standard';
}

function getSavedCompare() {
  try {
    const raw = localStorage.getItem(COMPARE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function getCompareMetrics(cfg) {
  const physics = PhysicsModel.evaluate(cfg).metrics;
  return {
    [t('metricPower')]: `${physics.heatOutputKw} ${lang === 'en' ? 'kW' : 'кВт'}`,
    [t('metricEfficiency')]: `${physics.efficiencyPct}%`,
    [t('metricBurn')]: `${physics.burnTimeHours} ${t('unitH')}`,
    [t('metricDraft')]: `${physics.draftPa} ${t('unitPa')}`,
    [t('metricWidth')]: `${cfg.dimensions.widthCm} ${t('unitCm')}`,
    [t('metricDepth')]: `${cfg.dimensions.depthCm} ${t('unitCm')}`,
    [t('metricHeight')]: `${cfg.dimensions.heightCm} ${t('unitCm')}`,
  };
}

function renderCompare() {
  const target = document.getElementById('compareContent');
  const saved = getSavedCompare();
  if (!saved) { target.innerHTML = `<p class="sub">${t('compareNone')}</p>`; return; }
  const before = getCompareMetrics(saved);
  const current = getCompareMetrics(config);
  const rows = Object.keys(current).map((key) => `<tr><td>${key}</td><td>${before[key]}</td><td>${current[key]}</td></tr>`).join('');
  target.innerHTML = `<table class="compare-table"><thead><tr><th></th><th>${t('compareSaved')}</th><th>${t('compareCurrent')}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function shareConfig() {
  const url = new URL(location.href);
  url.hash = `config=${encodeConfig(config)}`;
  const copied = navigator.clipboard?.writeText(url.href);
  if (copied) copied.then(() => {
    const button = document.getElementById('shareConfig');
    button.textContent = t('copied'); setTimeout(() => { button.textContent = t('share'); }, 1600);
  }).catch(() => window.prompt(t('share'), url.href));
  else window.prompt(t('share'), url.href);
  history.replaceState(null, '', url);
}

function downloadScreenshot() {
  try {
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `woodstove-${Date.now()}.png`;
    link.href = dataUrl; link.click();
  } catch(e) { console.error('Screenshot failed:', e); }
}

function printReport() {
  try {
    const dataUrl = renderer.domElement.toDataURL('image/png');
    const report = window.open('about:blank', '_blank', 'noopener,noreferrer');
    if (!report) return;
    const metrics = getCompareMetrics(config);
    const rows = Object.entries(metrics).map(([key, value]) => `<tr><td>${key}</td><td>${value}</td></tr>`).join('');
    report.document.write(`<!doctype html><html lang="${lang}"><head><title>${t('title')}</title><style>body{font:14px Arial;color:#172033;padding:24px}h1{font-size:22px}img{max-width:100%;background:#101318;border-radius:10px}table{border-collapse:collapse;margin-top:14px}td{border-bottom:1px solid #ddd;padding:7px 14px 7px 0}</style></head><body><h1>🔥 Woodstove 2</h1><p>${new Date().toLocaleString()}</p><img id="repImg" src="${dataUrl}"><table>${rows}</table><script>document.getElementById('repImg').onload=function(){window.print()}<\/script></body></html>`);
    report.document.close();
  } catch(e) { console.error('Print report failed:', e); alert(lang === 'en' ? 'Print failed' : 'Друк не вдався'); }
}

function buildExportModel() {
  const model = stove.clone(true);
  const strip = (root) => {
    for (const child of root.children.slice()) {
      if (['flowVisualization', 'innerChamber', 'doorSeal'].includes(child.name)) root.remove(child);
      else strip(child);
    }
  };
  strip(model);
  return model;
}

// ---------- UI прив'язка ----------
const controlMap = {
  widthCm: 'dimensions.widthCm', depthCm: 'dimensions.depthCm', heightCm: 'dimensions.heightCm', legHeightCm: 'dimensions.legHeightCm',
  steelThicknessMm: 'materials.steelThicknessMm', firebrickThicknessCm: 'materials.firebrickThicknessCm',
  baffleHeightCm: 'baffle.heightCm', baffleAngleDeg: 'baffle.angleDeg', baffleFrontGapCm: 'baffle.frontGapCm', baffleAirflowPct: 'baffle.airflowPct',
  insulationThicknessCm: 'thermal.insulationThicknessCm', baffleRefractoryThicknessCm: 'thermal.baffleRefractoryThicknessCm',
  targetCombustionTempC: 'thermal.targetCombustionTempC', heatExchangePasses: 'thermal.heatExchangePasses',
  primaryHoleCount: 'primaryAir.holeCount', primaryHoleDiameterCm: 'primaryAir.holeDiameterCm', primaryHoleSpacingCm: 'primaryAir.holeSpacingCm', primaryAirOpenPct: 'primaryAir.openPct',
  secondaryHoleCount: 'secondaryAir.holeCount', secondaryHoleDiameterCm: 'secondaryAir.holeDiameterCm', secondaryHoleSpacingCm: 'secondaryAir.holeSpacingCm',
  airWashGapCm: 'airWash.gapCm', airWashIntakePct: 'airWash.intakePct',
  secondaryChannelWidthCm: 'secondaryAir.channelWidthCm', secondaryChannelDepthCm: 'secondaryAir.channelDepthCm',
  secondaryPreheatLengthCm: 'secondaryAir.preheatLengthCm', secondaryManifoldHeightCm: 'secondaryAir.manifoldHeightCm',
  airWashSlotWidthPct: 'airWash.slotWidthPct', airWashChannelWidthCm: 'airWash.channelWidthCm', airWashPreheatLengthCm: 'airWash.preheatLengthCm',
  chimneyDiameterCm: 'chimney.diameterCm', chimneyHeightCm: 'chimney.heightCm',
  doorWidthCm: 'door.widthCm', doorHeightCm: 'door.heightCm', glassInsetCm: 'door.glassInsetCm', doorFrameThicknessCm: 'door.frameThicknessCm', doorOpenAngleDeg: 'door.openAngleDeg',
  explodeDistanceCm: 'explode.distanceCm',
  cameraFov: 'camera.fov', cameraDistance: 'camera.distance', cameraTargetYCm: 'camera.targetY',
  steelColor: 'colors.steel', brickColor: 'colors.brick', glassColor: 'colors.glass', floorColor: 'colors.floor',
  steelRoughness: 'colors.steelRoughness', steelMetalness: 'colors.steelMetalness',
  woodMoisturePct: 'testBurn.woodMoisturePct', loadKg: 'testBurn.loadKg', measuredBurnHours: 'testBurn.measuredBurnHours', measuredUsefulHeatKwh: 'testBurn.measuredUsefulHeatKwh',
  flueTempC: 'testBurn.flueTempC', stoveTopTempC: 'testBurn.stoveTopTempC', glassTempC: 'testBurn.glassTempC', smokeOpacityPct: 'testBurn.smokeOpacityPct',
};
function fmt(id, v) {
  if (String(id).includes('Pct') || id === 'baffleAirflowPct' || id === 'airWashIntakePct') return `${v}%`;
  if (id === 'loadKg') return `${v} kg`;
  if (id === 'measuredBurnHours') return `${v} ${t('unitH')}`;
  if (id === 'measuredUsefulHeatKwh') return `${v} kWh`;
  if (id === 'heatExchangePasses') return `${v}`;
  if (/TempC$/.test(id)) return `${v} °C`;
  if (id === 'steelThicknessMm') return `${v} ${t('unitMm')}`;
  if (/Deg|Fov/i.test(id)) return `${v}°`;
  if (id === 'steelRoughness' || id === 'steelMetalness') return `${(+v).toFixed(2)}`;
  if (/Color/i.test(id)) return `${v}`;
  return `${v} ${t('unitCm')}`;
}
function warnText(code, fallback, draftPa) {
  const dict = WARN_TXT[lang] || WARN_TXT.uk;
  const entry = dict[code];
  if (typeof entry === 'function') return entry(draftPa);
  return entry || fallback;
}
function applyI18n() {
  document.documentElement.lang = lang === 'en' ? 'en' : 'uk';
  document.title = t('title');
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (STR[lang][k] && el.id !== 'toggleDoor') el.textContent = STR[lang][k];
  });
  document.getElementById('langToggle').textContent = lang === 'en' ? 'UA' : 'EN';
  document.getElementById('exportGltf').title = lang === 'en' ? 'Export scene as glTF' : 'Експорт сцени в glTF';
  document.getElementById('exportStl').title = lang === 'en' ? 'Export scene as STL' : 'Експорт сцени в STL';
  const ol = document.getElementById('tourList');
  if (ol) ol.innerHTML = TOUR[lang].map((li) => `<li>${li}</li>`).join('');
  syncModelOptions(); syncDoorBtn(); syncExplodeBtn(); syncUI(); renderPhysics();
}
function syncDoorBtn() {
  document.getElementById('toggleDoor').textContent = config.door.isOpen ? t('closeDoor') : t('openDoor');
}
function syncExplodeBtn() {
  document.getElementById('toggleExplode').textContent = config.explode.enabled ? t('assemble') : t('explode');
}
function syncUI() {
  for (const [id, path] of Object.entries(controlMap)) {
    const el = document.getElementById(id); if (!el) continue;
    const v = getByPath(config, path); el.value = v;
    const o = document.getElementById(`${id}-v`); if (o) o.textContent = fmt(id, v);
  }
  document.getElementById('operationMode').value = config.operation.mode;
  document.getElementById('viewMode').value = config.viewMode;
  document.getElementById('doorHingeSide').value = config.door.hingeSide;
  document.getElementById('loadMode').value = config.testBurn.loadMode;
  document.getElementById('woodSpecies').value = config.testBurn.woodSpecies;
  for (const [id, k] of Object.entries({ showFirebrick: 'firebrick', showBaffle: 'baffle', showAirChannels: 'airChannels', showChimney: 'chimney', showSection: 'section', showGrid: 'grid' })) {
    const el = document.getElementById(id); if (el) el.checked = config.visibility[k] !== false;
  }
  document.getElementById('showFlow').checked = config.flow.visible;
  document.getElementById('animateFlow').checked = config.flow.animated;
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
      if (id === 'doorOpenAngleDeg' && config.door.isOpen) doorTarget = doorOpenAngle();
      if (id === 'explodeDistanceCm') { applyExplode(1); renderPhysics(); return; }
      if (id.startsWith('camera')) { syncCamera(id !== 'cameraTargetYCm'); renderPhysics(); return; }
      if (id in { woodMoisturePct: 1, loadKg: 1, measuredBurnHours: 1, measuredUsefulHeatKwh: 1, flueTempC: 1, stoveTopTempC: 1, glassTempC: 1, smokeOpacityPct: 1 }) {
        renderTestBurn(); return;
      }
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
  document.getElementById('doorHingeSide').addEventListener('change', (e) => {
    config.door.hingeSide = e.target.value === 'right' ? 'right' : 'left';
    normalizeConfig(config); saveConfig(config); rebuildStove();
  });
  document.getElementById('applyPreset').addEventListener('click', () => {
    const presetName = document.getElementById('modelPreset').value;
    config = applyModelPreset(config, presetName);
    applyModePreset(config, config.operation.mode);
    saveConfig(config); cache.clear(); syncUI(); rebuildStove(); renderPhysics(); applyViewMode();
  });
  document.getElementById('autoOptimize').addEventListener('click', () => {
    const result = optimizeConfig(config);
    config = normalizeConfig(result.config);
    saveConfig(config); cache.clear(); syncUI(); rebuildStove(); renderPhysics(); applyViewMode(); renderOptimization(result);
  });
  document.getElementById('loadMode').addEventListener('change', (e) => {
    config.testBurn.loadMode = e.target.value === 'manual' ? 'manual' : 'auto';
    saveConfig(config); syncUI(); renderTestBurn();
  });
  document.getElementById('woodSpecies').addEventListener('change', (e) => {
    config.testBurn.woodSpecies = e.target.value;
    saveConfig(config); renderPhysics();
  });
  for (const [id, k] of Object.entries({ showFirebrick: 'firebrick', showBaffle: 'baffle', showAirChannels: 'airChannels', showChimney: 'chimney', showSection: 'section', showGrid: 'grid' })) {
    document.getElementById(id).addEventListener('change', (e) => {
      config.visibility[k] = e.target.checked; saveConfig(config);
      if (k === 'section') applySection();
      else if (k === 'grid') applyGrid();
      else applyVisibility();
    });
  }
  document.getElementById('showFlow').addEventListener('change', (e) => {
    config.flow.visible = e.target.checked; saveConfig(config); applyVisibility();
  });
  document.getElementById('animateFlow').addEventListener('change', (e) => {
    config.flow.animated = e.target.checked; saveConfig(config);
  });
  document.getElementById('toggleDoor').addEventListener('click', () => {
    config.door.isOpen = !config.door.isOpen; saveConfig(config);
    doorTarget = config.door.isOpen ? doorOpenAngle() : 0;
    syncDoorBtn();
  });
  document.getElementById('toggleExplode').addEventListener('click', () => {
    config.explode.enabled = !config.explode.enabled; saveConfig(config);
    explodeTarget = config.explode.enabled ? 1 : 0;
    syncExplodeBtn();
  });
  document.getElementById('resetConfig').addEventListener('click', () => {
    localStorage.removeItem('woodstove2ConfigV1');
    config = normalizeConfig(structuredClone(defaultConfig));
    cache.clear(); syncUI(); rebuildStove(); renderPhysics(); applyViewMode();
    syncDoorBtn();
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
      config = normalizeConfig(deepMerge(structuredClone(defaultConfig), parsed));
      saveConfig(config); cache.clear(); syncUI(); rebuildStove(); renderPhysics(); applyViewMode();
    } catch { alert(lang === 'en' ? 'Invalid JSON' : 'Невалідний JSON'); }
    e.target.value = '';
  });
  document.getElementById('shareConfig').addEventListener('click', shareConfig);
  document.getElementById('screenshot').addEventListener('click', downloadScreenshot);
  document.getElementById('printPdf').addEventListener('click', printReport);
  document.getElementById('saveCompare').addEventListener('click', () => {
    try { localStorage.setItem(COMPARE_KEY, JSON.stringify(config)); } catch { /* ignore */ }
    renderCompare();
  });
  document.getElementById('openCompare').addEventListener('click', () => {
    renderCompare(); document.getElementById('compareModal').style.display = 'flex';
  });
  document.getElementById('closeCompare').addEventListener('click', () => { document.getElementById('compareModal').style.display = 'none'; });
  document.getElementById('compareModal').addEventListener('click', (e) => {
    if (e.target.id === 'compareModal') e.target.style.display = 'none';
  });
  document.getElementById('clearCompare').addEventListener('click', () => {
    localStorage.removeItem(COMPARE_KEY); renderCompare();
  });
  document.getElementById('saveTestBurn').addEventListener('click', () => {
    saveConfig(config); saveTestToLog(); renderTestBurn();
  });
  document.getElementById('exportTestCsv').addEventListener('click', exportTestLogCsv);
  document.getElementById('clearTestLog').addEventListener('click', () => {
    localStorage.removeItem(TEST_LOG_KEY); renderTestLog();
  });
  document.getElementById('langToggle').addEventListener('click', () => {
    lang = lang === 'en' ? 'uk' : 'en'; setLang(lang); applyI18n();
    if (config.viewMode !== '3d') renderOverlaySVG();
  });
  document.getElementById('exportGltf').addEventListener('click', () => exportGLTF(buildExportModel()));
  document.getElementById('exportStl').addEventListener('click', () => exportSTL(buildExportModel()));
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
  if (refs.flow?.visible && config.flow.animated) {
    const pulse = 0.58 + (Math.sin(t * 5) + 1) * 0.12;
    refs.flowArrows.forEach((arrow, i) => {
      arrow.line.material.opacity = pulse + (i % 2) * 0.08;
      arrow.cone.material.opacity = Math.min(1, pulse + 0.2);
    });
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
bindUI(); applyI18n(); rebuildStove(); applyViewMode();
animate();
