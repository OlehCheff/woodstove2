// woodstove2 — централізований конфіг, міграція, валідація
export const STORAGE_KEY = 'woodstove2ConfigV1';
export const LEGACY_KEYS = ['woodstove1ConfigV2', 'woodstove1Config'];

export const OPERATION_PRESETS = {
  'start-up':  { primaryAirOpenPct: 95, secondaryAirPct: 85, airWashGapCm: 2.4, airWashIntakePct: 85, baffleAirflowPct: 75, flameIntensity: 1.0,  flameColor: 0xffb347, fillFactor: 0.5 },
  'low':       { primaryAirOpenPct: 28, secondaryAirPct: 35, airWashGapCm: 1.0, airWashIntakePct: 45, baffleAirflowPct: 35, flameIntensity: 0.35, flameColor: 0xff8844, fillFactor: 0.6 },
  'medium':    { primaryAirOpenPct: 52, secondaryAirPct: 55, airWashGapCm: 1.4, airWashIntakePct: 60, baffleAirflowPct: 55, flameIntensity: 0.62, flameColor: 0xffa04d, fillFactor: 0.7 },
  'high':      { primaryAirOpenPct: 82, secondaryAirPct: 78, airWashGapCm: 2.0, airWashIntakePct: 80, baffleAirflowPct: 70, flameIntensity: 0.88, flameColor: 0xffc261, fillFactor: 0.85 },
  'overnight': { primaryAirOpenPct: 15, secondaryAirPct: 24, airWashGapCm: 0.8, airWashIntakePct: 30, baffleAirflowPct: 25, flameIntensity: 0.22, flameColor: 0xff6a33, fillFactor: 0.7 },
};

export const MODEL_PRESETS = {
  compact: {
    labelKey: 'presetCompact',
    patch: {
      dimensions: { widthCm: 58, depthCm: 46, heightCm: 78, legHeightCm: 12 },
      materials: { steelThicknessMm: 4, firebrickThicknessCm: 3 },
      chimney: { diameterCm: 13, heightCm: 100 },
      door: { widthCm: 34, heightCm: 32 },
      baffle: { heightCm: 48, frontGapCm: 5 },
      operation: { mode: 'low' },
    },
  },
  standard: {
    labelKey: 'presetStandard',
    patch: {
      dimensions: { widthCm: 70, depthCm: 55, heightCm: 95, legHeightCm: 15 },
      materials: { steelThicknessMm: 5, firebrickThicknessCm: 4 },
      chimney: { diameterCm: 15, heightCm: 120 },
      door: { widthCm: 42, heightCm: 38 },
      baffle: { heightCm: 58, frontGapCm: 6 },
      operation: { mode: 'medium' },
    },
  },
  wide: {
    labelKey: 'presetWide',
    patch: {
      dimensions: { widthCm: 96, depthCm: 62, heightCm: 105, legHeightCm: 18 },
      materials: { steelThicknessMm: 6, firebrickThicknessCm: 5 },
      chimney: { diameterCm: 18, heightCm: 135 },
      door: { widthCm: 58, heightCm: 45 },
      baffle: { heightCm: 64, frontGapCm: 7 },
      operation: { mode: 'medium' },
    },
  },
  workshop: {
    labelKey: 'presetWorkshop',
    patch: {
      dimensions: { widthCm: 118, depthCm: 82, heightCm: 128, legHeightCm: 10 },
      materials: { steelThicknessMm: 8, firebrickThicknessCm: 6 },
      chimney: { diameterCm: 22, heightCm: 150 },
      door: { widthCm: 64, heightCm: 54 },
      baffle: { heightCm: 78, frontGapCm: 9 },
      operation: { mode: 'high' },
    },
  },
};

export const defaultConfig = {
  dimensions: { widthCm: 70, depthCm: 55, heightCm: 95, legHeightCm: 15 },
  materials: { steelThicknessMm: 5, firebrickThicknessCm: 4 },
  chimney: { diameterCm: 15, heightCm: 120 },
  baffle: { heightCm: 58, angleDeg: 6, frontGapCm: 6, airflowPct: 55 },
  primaryAir: { holeCount: 8, holeDiameterCm: 1.2, holeSpacingCm: 4, openPct: 52 },
  secondaryAir: {
    holeCount: 10, holeDiameterCm: 0.7, holeSpacingCm: 2.4,
    channelWidthCm: 5, channelDepthCm: 4, preheatLengthCm: 55, manifoldHeightCm: 4,
  },
  airWash: {
    gapCm: 1.4, intakePct: 60, slotWidthPct: 94,
    channelWidthCm: 4, channelDepthCm: 4, preheatLengthCm: 45,
  },
  flow: { visible: false, animated: true },
  visibility: { firebrick: true, baffle: true, airChannels: true, chimney: true, section: false, grid: true },
  explode: { enabled: false, distanceCm: 18 },
  operation: { mode: 'medium', secondaryAirPct: 55, flameIntensity: 0.62 },
  thermal: {
    insulationThicknessCm: 3,
    baffleRefractoryThicknessCm: 3,
    targetCombustionTempC: 850,
    heatExchangePasses: 2,
  },
  testBurn: {
    loadMode: 'auto', woodSpecies: 'birch', woodMoisturePct: 15, loadKg: 8, measuredBurnHours: 7.5,
    measuredUsefulHeatKwh: 0, flueTempC: 260, stoveTopTempC: 420, glassTempC: 180, smokeOpacityPct: 5,
  },
  viewMode: '3d',
  door: { widthCm: 42, heightCm: 38, frameThicknessCm: 3, glassInsetCm: 2, openAngleDeg: 70, hingeSide: 'left', isOpen: false },
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
  cfg.secondaryAir.channelWidthCm = clamp(+cfg.secondaryAir.channelWidthCm || 5, 2, 12);
  cfg.secondaryAir.channelDepthCm = clamp(+cfg.secondaryAir.channelDepthCm || 4, 2, 10);
  cfg.secondaryAir.preheatLengthCm = clamp(+cfg.secondaryAir.preheatLengthCm || 55, 15, 140);
  cfg.secondaryAir.manifoldHeightCm = clamp(+cfg.secondaryAir.manifoldHeightCm || 4, 2, 10);

  cfg.airWash.gapCm = clamp(+cfg.airWash.gapCm || 1.4, 0.5, 3);
  cfg.airWash.intakePct = clamp(+cfg.airWash.intakePct ?? 60, 0, 100);
  cfg.airWash.slotWidthPct = clamp(+cfg.airWash.slotWidthPct || 94, 40, 100);
  cfg.airWash.channelWidthCm = clamp(+cfg.airWash.channelWidthCm || 4, 2, 10);
  cfg.airWash.channelDepthCm = clamp(+cfg.airWash.channelDepthCm || 4, 2, 10);
  cfg.airWash.preheatLengthCm = clamp(+cfg.airWash.preheatLengthCm || 45, 15, 120);

  cfg.flow.visible = Boolean(cfg.flow.visible);
  cfg.flow.animated = cfg.flow.animated !== false;

  for (const k of ['firebrick', 'baffle', 'airChannels', 'chimney', 'section', 'grid']) cfg.visibility[k] = Boolean(cfg.visibility[k]);
  cfg.explode.enabled = Boolean(cfg.explode.enabled);
  cfg.explode.distanceCm = clamp(+cfg.explode.distanceCm || 18, 5, 40);

  if (!OPERATION_PRESETS[cfg.operation.mode]) cfg.operation.mode = 'medium';
  if (!['3d', 'drawing-front', 'drawing-side', 'drawing-top'].includes(cfg.viewMode)) cfg.viewMode = '3d';
  cfg.operation.secondaryAirPct = clamp(+cfg.operation.secondaryAirPct ?? 55, 0, 100);
  cfg.operation.flameIntensity = clamp(+cfg.operation.flameIntensity ?? 0.62, 0, 1);

  cfg.thermal ??= {};
  cfg.thermal.insulationThicknessCm = clamp(cfg.thermal.insulationThicknessCm == null ? 3 : +cfg.thermal.insulationThicknessCm, 0, 8);
  cfg.thermal.baffleRefractoryThicknessCm = clamp(cfg.thermal.baffleRefractoryThicknessCm == null ? 3 : +cfg.thermal.baffleRefractoryThicknessCm, 0, 8);
  cfg.thermal.targetCombustionTempC = clamp(+cfg.thermal.targetCombustionTempC || 850, 600, 1100);
  cfg.thermal.heatExchangePasses = clamp(Math.round(+cfg.thermal.heatExchangePasses || 2), 1, 4);

  // дверцята не більші за фасад
  cfg.door.widthCm = clamp(+cfg.door.widthCm || 42, 20, 70);
  cfg.door.heightCm = clamp(+cfg.door.heightCm || 38, 20, 70);
  cfg.door.frameThicknessCm = clamp(+cfg.door.frameThicknessCm || 3, 1, 6);
  cfg.door.glassInsetCm = clamp(+cfg.door.glassInsetCm || 2, 0.5, 6);
  cfg.door.openAngleDeg = clamp(+cfg.door.openAngleDeg || 70, 30, 120);
  cfg.door.hingeSide = cfg.door.hingeSide === 'right' ? 'right' : 'left';
  cfg.door.isOpen = Boolean(cfg.door.isOpen);

  cfg.camera.fov = clamp(+cfg.camera.fov || 50, 35, 85);
  cfg.camera.distance = clamp(+cfg.camera.distance || 270, 140, 500);
  cfg.camera.targetY = clamp(+cfg.camera.targetY || 60, 20, 180);
  cfg.testBurn.loadMode = cfg.testBurn.loadMode === 'manual' ? 'manual' : 'auto';
  cfg.testBurn.woodSpecies = ['birch', 'oak', 'pine', 'spruce', 'alder'].includes(cfg.testBurn.woodSpecies) ? cfg.testBurn.woodSpecies : 'birch';
  cfg.testBurn.woodMoisturePct = clamp(+cfg.testBurn.woodMoisturePct || 15, 8, 35);
  cfg.testBurn.loadKg = clamp(+cfg.testBurn.loadKg || 8, 1, 30);
  cfg.testBurn.measuredBurnHours = clamp(+cfg.testBurn.measuredBurnHours || 7.5, 0.1, 30);
  cfg.testBurn.measuredUsefulHeatKwh = clamp(+cfg.testBurn.measuredUsefulHeatKwh || 0, 0, 100);
  cfg.testBurn.flueTempC = clamp(+cfg.testBurn.flueTempC || 260, 20, 800);
  cfg.testBurn.stoveTopTempC = clamp(+cfg.testBurn.stoveTopTempC || 420, 20, 1000);
  cfg.testBurn.glassTempC = clamp(+cfg.testBurn.glassTempC || 180, 20, 600);
  cfg.testBurn.smokeOpacityPct = clamp(+cfg.testBurn.smokeOpacityPct || 5, 0, 100);
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

export function applyModelPreset(cfg, presetName) {
  const preset = MODEL_PRESETS[presetName];
  if (!preset) return cfg;
  return normalizeConfig(deepMerge(cfg, preset.patch));
}

export function validateConfig(cfg) {
  const errors = [];
  const warnings = [];
  const steelCm = cfg.materials.steelThicknessMm / 10;
  const usableW = cfg.dimensions.widthCm - steelCm * 4;
  const usableH = cfg.dimensions.heightCm - steelCm * 4;
  const doorW = cfg.door.widthCm;
  const doorH = cfg.door.heightCm;
  const primarySpan = (cfg.primaryAir.holeCount - 1) * cfg.primaryAir.holeSpacingCm;

  if (doorW > usableW) errors.push({ code: 'DOOR_TOO_WIDE', values: { doorW, usableW } });
  if (doorH > usableH) errors.push({ code: 'DOOR_TOO_HIGH', values: { doorH, usableH } });
  if (cfg.baffle.heightCm >= cfg.dimensions.heightCm - steelCm * 3) {
    errors.push({ code: 'BAFFLE_TOO_HIGH', values: { height: cfg.baffle.heightCm } });
  }
  if (primarySpan + cfg.primaryAir.holeDiameterCm > usableW) {
    errors.push({ code: 'PRIMARY_OUTSIDE', values: { span: primarySpan } });
  }
  if (cfg.baffle.frontGapCm >= cfg.dimensions.depthCm * 0.45) {
    warnings.push({ code: 'BAFFLE_GAP_LARGE', values: { gap: cfg.baffle.frontGapCm } });
  }
  if (cfg.chimney.diameterCm < Math.sqrt(cfg.dimensions.widthCm * cfg.dimensions.depthCm) / 8) {
    warnings.push({ code: 'CHIMNEY_SMALL', values: { diameter: cfg.chimney.diameterCm } });
  }
  if (cfg.materials.firebrickThicknessCm > Math.min(cfg.dimensions.widthCm, cfg.dimensions.depthCm) / 8) {
    warnings.push({ code: 'LINING_THICK', values: { thickness: cfg.materials.firebrickThicknessCm } });
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function encodeConfig(cfg) {
  const bytes = new TextEncoder().encode(JSON.stringify(cfg));
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeConfig(value) {
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
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
