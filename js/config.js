// woodstove2 — централізований конфіг, міграція, валідація
export const STORAGE_KEY = 'woodstove2ConfigV1';
export const LEGACY_KEYS = ['woodstove1ConfigV2', 'woodstove1Config'];

export const OPERATION_PRESETS = {
  'start-up':  { primaryAirOpenPct: 95, secondaryAirPct: 85, airWashGapCm: 2.4, airWashIntakePct: 85, baffleAirflowPct: 75, flameIntensity: 1.0,  flameColor: 0xffb347, fillFactor: 0.5 },
  'low':       { primaryAirOpenPct: 28, secondaryAirPct: 35, airWashGapCm: 1.0, airWashIntakePct: 45, baffleAirflowPct: 35, flameIntensity: 0.35, flameColor: 0xff8844, fillFactor: 0.6 },
  'medium':    { primaryAirOpenPct: 52, secondaryAirPct: 55, airWashGapCm: 1.4, airWashIntakePct: 60, baffleAirflowPct: 55, flameIntensity: 0.62, flameColor: 0xffa04d, fillFactor: 0.7 },
  'high':      { primaryAirOpenPct: 82, secondaryAirPct: 78, airWashGapCm: 2.0, airWashIntakePct: 80, baffleAirflowPct: 70, flameIntensity: 0.88, flameColor: 0xffc261, fillFactor: 0.85 },
  'overnight': { primaryAirOpenPct: 15, secondaryAirPct: 24, airWashGapCm: 0.8, airWashIntakePct: 30, baffleAirflowPct: 25, flameIntensity: 0.22, flameColor: 0xff6a33, fillFactor: 1.0 },
};

export const defaultConfig = {
  dimensions: { widthCm: 70, depthCm: 55, heightCm: 95, legHeightCm: 15 },
  materials: { steelThicknessMm: 5, firebrickThicknessCm: 4 },
  chimney: { diameterCm: 15, heightCm: 120 },
  baffle: { heightCm: 58, angleDeg: 6, frontGapCm: 6, airflowPct: 55 },
  primaryAir: { holeCount: 8, holeDiameterCm: 1.2, holeSpacingCm: 4, openPct: 52 },
  secondaryAir: { holeCount: 10, holeDiameterCm: 0.7, holeSpacingCm: 2.4 },
  airWash: { gapCm: 1.4, intakePct: 60 },
  visibility: { firebrick: true, baffle: true, airChannels: true, chimney: true },
  explode: { enabled: false, distanceCm: 18 },
  operation: { mode: 'medium', secondaryAirPct: 55, flameIntensity: 0.62 },
  viewMode: '3d',
  door: { widthCm: 42, heightCm: 38, frameThicknessCm: 3, glassInsetCm: 2, openAngleDeg: 70, isOpen: false },
  camera: { fov: 50, distance: 270, targetY: 60 },
  colors: {
    steel: '#3a3d43', steelRoughness: 0.34, steelMetalness: 0.78,
    brick: '#b37a4c', glass: '#8ca7be', floor: '#1c1e22',
    flameCore: '#ffa04d',
  },
};

export function deepMerge(base, patch) {
  const out = Array.isArray(base) ? [...base] : { ...(base || {}) };
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = deepMerge(base?.[k] || {}, v);
    else out[k] = v;
  }
  return out;
}

export function getByPath(obj, path) { return path.split('.').reduce((a, p) => a?.[p], obj); }
export function setByPath(obj, path, value) {
  const keys = path.split('.'); const last = keys.pop();
  const t = keys.reduce((a, p) => (a[p] ??= {}), obj); t[last] = value;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function normalizeConfig(cfg) {
  cfg.dimensions.widthCm = clamp(+cfg.dimensions.widthCm || 70, 40, 140);
  cfg.dimensions.depthCm = clamp(+cfg.dimensions.depthCm || 55, 35, 120);
  cfg.dimensions.heightCm = clamp(+cfg.dimensions.heightCm || 95, 50, 180);
  cfg.dimensions.legHeightCm = clamp(+cfg.dimensions.legHeightCm || 0, 0, 40);

  // міграція зі старого формату (см → мм)
  if (cfg.materials.steelThicknessMm == null && cfg.materials.steelThicknessCm != null) {
    cfg.materials.steelThicknessMm = cfg.materials.steelThicknessCm * 10;
  }
  cfg.materials.steelThicknessMm = clamp(Math.round(+cfg.materials.steelThicknessMm || 5), 3, 8);
  cfg.materials.firebrickThicknessCm = clamp(+cfg.materials.firebrickThicknessCm || 4, 2, 8);

  cfg.chimney.diameterCm = clamp(+cfg.chimney.diameterCm || 15, 10, 25);
  cfg.chimney.heightCm = clamp(+cfg.chimney.heightCm || 120, 100, 150);

  cfg.baffle.heightCm = clamp(+cfg.baffle.heightCm || 58, 20, 120);
  cfg.baffle.angleDeg = clamp(+cfg.baffle.angleDeg || 0, -20, 30);
  cfg.baffle.frontGapCm = clamp(+cfg.baffle.frontGapCm || 6, 2, 15);
  cfg.baffle.airflowPct = clamp(+cfg.baffle.airflowPct ?? 55, 0, 100);

  cfg.primaryAir.holeCount = clamp(Math.round(+cfg.primaryAir.holeCount || 8), 3, 14);
  cfg.primaryAir.holeDiameterCm = clamp(+cfg.primaryAir.holeDiameterCm || 1.2, 0.6, 2.5);
  cfg.primaryAir.holeSpacingCm = clamp(+cfg.primaryAir.holeSpacingCm || 4, 2, 8);
  cfg.primaryAir.openPct = clamp(+cfg.primaryAir.openPct ?? 52, 0, 100);

  cfg.secondaryAir.holeCount = clamp(Math.round(+cfg.secondaryAir.holeCount || 10), 4, 24);
  cfg.secondaryAir.holeDiameterCm = clamp(+cfg.secondaryAir.holeDiameterCm || 0.7, 0.4, 1.2);
  cfg.secondaryAir.holeSpacingCm = clamp(+cfg.secondaryAir.holeSpacingCm || 2.4, 1.5, 4);

  cfg.airWash.gapCm = clamp(+cfg.airWash.gapCm || 1.4, 0.5, 3);
  cfg.airWash.intakePct = clamp(+cfg.airWash.intakePct ?? 60, 0, 100);

  for (const k of ['firebrick', 'baffle', 'airChannels', 'chimney']) cfg.visibility[k] = Boolean(cfg.visibility[k]);
  cfg.explode.enabled = Boolean(cfg.explode.enabled);
  cfg.explode.distanceCm = clamp(+cfg.explode.distanceCm || 18, 5, 40);

  if (!OPERATION_PRESETS[cfg.operation.mode]) cfg.operation.mode = 'medium';
  if (!['3d', 'drawing-front', 'drawing-side', 'drawing-top'].includes(cfg.viewMode)) cfg.viewMode = '3d';
  cfg.operation.secondaryAirPct = clamp(+cfg.operation.secondaryAirPct ?? 55, 0, 100);
  cfg.operation.flameIntensity = clamp(+cfg.operation.flameIntensity ?? 0.62, 0, 1);

  // дверцята не більші за фасад
  cfg.door.widthCm = clamp(+cfg.door.widthCm || 42, 20, 70);
  cfg.door.heightCm = clamp(+cfg.door.heightCm || 38, 20, 70);
  cfg.door.frameThicknessCm = clamp(+cfg.door.frameThicknessCm || 3, 1, 6);
  cfg.door.glassInsetCm = clamp(+cfg.door.glassInsetCm || 2, 0.5, 6);
  cfg.door.openAngleDeg = clamp(+cfg.door.openAngleDeg || 70, 30, 120);
  cfg.door.isOpen = Boolean(cfg.door.isOpen);

  cfg.camera.fov = clamp(+cfg.camera.fov || 50, 35, 85);
  cfg.camera.distance = clamp(+cfg.camera.distance || 270, 140, 500);
  cfg.camera.targetY = clamp(+cfg.camera.targetY || 60, 20, 180);
  return cfg;
}

export function loadConfig() {
  for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return normalizeConfig(deepMerge(structuredClone(defaultConfig), JSON.parse(raw)));
    } catch { /* ignore */ }
  }
  return normalizeConfig(structuredClone(defaultConfig));
}

export function saveConfig(cfg) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

export function applyModePreset(cfg, modeName) {
  const p = OPERATION_PRESETS[modeName] || OPERATION_PRESETS.medium;
  cfg.operation.mode = OPERATION_PRESETS[modeName] ? modeName : 'medium';
  cfg.primaryAir.openPct = p.primaryAirOpenPct;
  cfg.operation.secondaryAirPct = p.secondaryAirPct;
  cfg.airWash.gapCm = p.airWashGapCm;
  cfg.airWash.intakePct = p.airWashIntakePct;
  cfg.baffle.airflowPct = p.baffleAirflowPct;
  cfg.operation.flameIntensity = p.flameIntensity;
  return normalizeConfig(cfg);
}
