// woodstove2 — централізований конфіг, міграція, валідація
export const STORAGE_KEY = 'woodstove2ConfigV1';
export const LEGACY_KEYS = ['woodstove1ConfigV2', 'woodstove1Config'];

export const OPERATION_PRESETS = {
  'start-up':  { primaryAirOpenPct: 95, secondaryAirPct: 85, airWashGapCm: 2.4, airWashIntakePct: 85, baffleAirflowPct: 75, flameIntensity: 1.0,  flameColor: 0xffb347, fillFactor: 0.5 },
  'low':       { primaryAirOpenPct: 28, secondaryAirPct: 35, airWashGapCm: 1.2, airWashIntakePct: 55, baffleAirflowPct: 35, flameIntensity: 0.35, flameColor: 0xff8844, fillFactor: 0.6 },
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
      chimney: { diameterCm: 13, heightCm: 120 },
      door: { widthCm: 34, heightCm: 32 },
      baffle: { heightCm: 48, frontGapCm: 5 },
      operation: { mode: 'medium' },
    },
  },
  standard: {
    labelKey: 'presetStandard',
    patch: {
      dimensions: { widthCm: 70, depthCm: 55, heightCm: 95, legHeightCm: 15 },
      materials: { steelThicknessMm: 5, firebrickThicknessCm: 4 },
  chimney: { diameterCm: 15, heightCm: 120, totalHeightM: 5, bends: 1 },
  combustion: {
    washAsSecondary: true,
    tertiary: { enabled: false, holeCount: 8, holeDiameterCm: 0.5 },
    catalyst: { enabled: false, lightoffC: 260, areaCm2: 120 },
  },
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
  // outlet/route/connectorLengthCm — див. rearOutletLayout нижче й
  // OUTLET_TURNS у physics-model.js. Значення за замовчуванням дорівнює
  // переможцю compareOutlets на цій самій печі (закріплено тестом 40):
  // маршрут «над піччю» → верхній вихід без зайвих поворотів.
  chimney: { diameterCm: 15, heightCm: 120, outlet: 'top', route: 'up', connectorLengthCm: 30 },
  baffle: { heightCm: 58, angleDeg: 6, frontGapCm: 6, airflowPct: 55 },
  primaryAir: { holeCount: 8, holeDiameterCm: 1.2, holeSpacingCm: 4, openPct: 52 },
  // holeCount/holeDiameterCm — підібрані під топку ЦІЄЇ Ж печі тим самим
  // правилом, що й autodesign (sizeSecondaryHoles): 46×Ø5 мм ≈ 9.0 см².
  // Було 10×Ø7 мм, а autodesign ставив 15×Ø3 мм ≈ 1.06 см² — 2.7 % площі всіх
  // входів повітря (див. SECONDARY_AREA_PER_LITER_CM2 нижче).
  // bottomIntake — нижній вхід secondary (канал під днищем + повзун спереду);
  // manifoldHeightCm — висота профілю цього каналу.
  secondaryAir: {
    holeCount: 46, holeDiameterCm: 0.5, holeSpacingCm: 2.4,
    channelWidthCm: 5, channelDepthCm: 4, preheatLengthCm: 55, manifoldHeightCm: 4,
    bottomIntake: true,
  },
  airWash: {
    gapCm: 1.4, intakePct: 60, slotWidthPct: 94,
    channelWidthCm: 4, channelDepthCm: 4, preheatLengthCm: 45,
  },
  flow: { visible: false, animated: true, aero: false },
  visibility: { firebrick: true, baffle: true, airChannels: true, chimney: true, section: false, grid: true, thermal: false, shields: false },
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
  // preferredWidthCm/preferredHeightCm — останній НАВМИСНО обраний розмір
  // дверцят (слайдер або пресет). Автопроєктування (autodesign.js) обрізає
  // widthCm/heightCm лише коли фасад замалий, і завжди рахує від preferred,
  // а не від уже обрізаного значення — інакше зменшена й потім знову
  // збільшена піч лишалась із крихітними дверцятами назавжди.
  door: { widthCm: 42, heightCm: 38, preferredWidthCm: 42, preferredHeightCm: 38, frameThicknessCm: 3, glassInsetCm: 2, openAngleDeg: 70, hingeSide: 'left', isOpen: false },
  camera: { fov: 50, distance: 270, targetY: 60 },
  calibration: { enabled: false, damping: 0.75, globalScale: 1, modeScale: {}, samples: 0, updated: null, excludeStartUp: true },
  room: { purpose: 'room', inputMode: 'volume', volumeM3: 60, areaM2: 30, ceilingM: 2.7 },
  colors: {
    steel: '#3a3d43', steelRoughness: 0.34, steelMetalness: 0.78,
    brick: '#cdbf9e', glass: '#8ca7be', floor: '#1c1e22',
    flameCore: '#ffa04d', handle: '#d6d6d6',
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
// `+x ?? d` і `x == null ? d : +x` обидва пропускають NaN: якщо x — рядок
// на кшталт "abc" (пошкоджений share-лінк, вручну відредагований JSON),
// `+"abc"` дає NaN, а `??`/`== null` перевіряють лише null/undefined, не
// NaN. safeNum ловить це явно й повертає безпечне значення за замовчуванням.
const safeNum = (v, def) => { const n = +v; return Number.isFinite(n) ? n : def; };
const PI_C = Math.PI;
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

export function normalizeConfig(cfg) {
  cfg.dimensions.widthCm = clamp(+cfg.dimensions.widthCm || 70, 30, 140);
  cfg.dimensions.depthCm = clamp(+cfg.dimensions.depthCm || 55, 30, 120);
  cfg.dimensions.heightCm = clamp(+cfg.dimensions.heightCm || 95, 40, 180);
  cfg.dimensions.legHeightCm = clamp(+cfg.dimensions.legHeightCm || 0, 0, 40);

  // міграція зі старого формату (см → мм)
  if (cfg.materials.steelThicknessMm == null && cfg.materials.steelThicknessCm != null) {
    cfg.materials.steelThicknessMm = cfg.materials.steelThicknessCm * 10;
  }
  cfg.materials.steelThicknessMm = clamp(Math.round(+cfg.materials.steelThicknessMm || 5), 3, 8);
  cfg.materials.firebrickThicknessCm = clamp(+cfg.materials.firebrickThicknessCm || 4, 2, 8);

  cfg.chimney.diameterCm = clamp(+cfg.chimney.diameterCm || 15, 10, 25);
  cfg.chimney.heightCm = clamp(+cfg.chimney.heightCm || 120, 100, 150);
  cfg.chimney.totalHeightM = clamp(+cfg.chimney.totalHeightM || 5, 2, 12);
  cfg.chimney.bends = clamp(Math.round(+cfg.chimney.bends || 0), 0, 4);
  // Вихід труби: 'top' (крізь кришку) або 'rear' (комір у задній панелі).
  // Маршрут: 'up' (вертикаль над піччю крізь стелю) або 'wall' (у стінний
  // димохід позаду). Будь-яке інше/пошкоджене значення — безпечний дефолт.
  cfg.chimney.outlet = cfg.chimney.outlet === 'rear' ? 'rear' : 'top';
  cfg.chimney.route = cfg.chimney.route === 'wall' ? 'wall' : 'up';
  // Горизонтальний одностінний патрубок від печі до вертикалі. 15–150 см —
  // фізичні межі UI; норма (СНиП 41-01/ДБН, NFPA 211) радить ≤40 см, тому
  // довший патрубок дає попередження CONNECTOR_LONG, а не мовчазний клемп.
  cfg.chimney.connectorLengthCm = clamp(Math.round(safeNum(cfg.chimney.connectorLengthCm, 30)), 15, 150);

  cfg.combustion ??= {};
  cfg.combustion.washAsSecondary = cfg.combustion.washAsSecondary !== false;
  cfg.combustion.tertiary ??= {};
  cfg.combustion.tertiary.enabled = Boolean(cfg.combustion.tertiary.enabled);
  cfg.combustion.tertiary.holeCount = clamp(Math.round(+cfg.combustion.tertiary.holeCount || 8), 2, 30);
  cfg.combustion.tertiary.holeDiameterCm = clamp(+cfg.combustion.tertiary.holeDiameterCm || 0.5, 0.2, 1.5);
  cfg.combustion.catalyst ??= {};
  cfg.combustion.catalyst.enabled = Boolean(cfg.combustion.catalyst.enabled);
  cfg.combustion.catalyst.lightoffC = clamp(+cfg.combustion.catalyst.lightoffC || 260, 150, 500);
  cfg.combustion.catalyst.areaCm2 = clamp(+cfg.combustion.catalyst.areaCm2 || 120, 40, 400);

  cfg.baffle.heightCm = clamp(+cfg.baffle.heightCm || 58, 20, 120);
  cfg.baffle.angleDeg = clamp(+cfg.baffle.angleDeg || 0, -20, 30);
  cfg.baffle.frontGapCm = clamp(+cfg.baffle.frontGapCm || 6, 2, 15);
  cfg.baffle.airflowPct = clamp(safeNum(cfg.baffle.airflowPct, 55), 0, 100);

  cfg.primaryAir.holeCount = clamp(Math.round(+cfg.primaryAir.holeCount || 8), 3, 14);
  cfg.primaryAir.holeDiameterCm = clamp(+cfg.primaryAir.holeDiameterCm || 1.2, 0.6, 2.5);
  cfg.primaryAir.holeSpacingCm = clamp(+cfg.primaryAir.holeSpacingCm || 4, 2, 8);
  cfg.primaryAir.openPct = clamp(safeNum(cfg.primaryAir.openPct, 52), 0, 100);

  // Стеля 60 отворів була штучною: під топку 370 л (workshop) чесно потрібно
  // ~30 см², тобто 154×Ø5 мм у два ряди. 240 — це межа від дурниці, а не
  // «робочий діапазон» (крок і кількість рядів рахує secondaryHolePattern).
  cfg.secondaryAir.holeCount = clamp(Math.round(+cfg.secondaryAir.holeCount || 10), 8, 240);
  cfg.secondaryAir.holeDiameterCm = clamp(+cfg.secondaryAir.holeDiameterCm || 0.7, 0.25, 5);
  cfg.secondaryAir.holeSpacingCm = clamp(+cfg.secondaryAir.holeSpacingCm || 2.4, 0.6, 6);
  cfg.secondaryAir.channelWidthCm = clamp(+cfg.secondaryAir.channelWidthCm || 5, 2, 12);
  cfg.secondaryAir.channelDepthCm = clamp(+cfg.secondaryAir.channelDepthCm || 4, 2, 10);
  cfg.secondaryAir.preheatLengthCm = clamp(+cfg.secondaryAir.preheatLengthCm || 55, 15, 140);
  cfg.secondaryAir.manifoldHeightCm = clamp(+cfg.secondaryAir.manifoldHeightCm || 4, 2, 10);
  // Нижній вхід secondary (канал під днищем): типово увімкнений, вимикається
  // лише явним false — пошкоджений конфіг не має мовчки лишати піч без нього.
  cfg.secondaryAir.bottomIntake = cfg.secondaryAir.bottomIntake !== false;

  cfg.airWash.gapCm = clamp(+cfg.airWash.gapCm || 1.4, 0.5, 3);
  cfg.airWash.intakePct = clamp(safeNum(cfg.airWash.intakePct, 60), 0, 100);
  cfg.airWash.slotWidthPct = clamp(+cfg.airWash.slotWidthPct || 94, 40, 100);
  cfg.airWash.channelWidthCm = clamp(+cfg.airWash.channelWidthCm || 4, 2, 10);
  cfg.airWash.channelDepthCm = clamp(+cfg.airWash.channelDepthCm || 4, 2, 10);
  cfg.airWash.preheatLengthCm = clamp(+cfg.airWash.preheatLengthCm || 45, 15, 120);

  cfg.flow.visible = Boolean(cfg.flow.visible);
  cfg.flow.animated = cfg.flow.animated !== false;
  cfg.flow.aero = Boolean(cfg.flow.aero);

  for (const k of ['firebrick', 'baffle', 'airChannels', 'chimney', 'section', 'grid', 'thermal', 'shields']) cfg.visibility[k] = Boolean(cfg.visibility[k]);
  cfg.explode.enabled = Boolean(cfg.explode.enabled);
  cfg.explode.distanceCm = clamp(+cfg.explode.distanceCm || 18, 5, 40);

  if (!OPERATION_PRESETS[cfg.operation.mode]) cfg.operation.mode = 'medium';
  if (!['3d', 'drawing-front', 'drawing-side', 'drawing-top'].includes(cfg.viewMode)) cfg.viewMode = '3d';
  cfg.operation.secondaryAirPct = clamp(safeNum(cfg.operation.secondaryAirPct, 55), 0, 100);
  cfg.operation.flameIntensity = clamp(safeNum(cfg.operation.flameIntensity, 0.62), 0, 1);

  cfg.thermal ??= {};
  cfg.thermal.insulationThicknessCm = clamp(safeNum(cfg.thermal.insulationThicknessCm, 3), 0, 8);
  cfg.thermal.baffleRefractoryThicknessCm = clamp(safeNum(cfg.thermal.baffleRefractoryThicknessCm, 3), 0, 8);
  cfg.thermal.targetCombustionTempC = clamp(+cfg.thermal.targetCombustionTempC || 850, 600, 1100);
  cfg.thermal.heatExchangePasses = clamp(Math.round(+cfg.thermal.heatExchangePasses || 2), 1, 4);

  // дверцята не більші за фасад
  cfg.door.widthCm = clamp(+cfg.door.widthCm || 42, 20, 70);
  cfg.door.heightCm = clamp(+cfg.door.heightCm || 38, 20, 70);
  cfg.door.preferredWidthCm = clamp(+cfg.door.preferredWidthCm || cfg.door.widthCm, 20, 70);
  cfg.door.preferredHeightCm = clamp(+cfg.door.preferredHeightCm || cfg.door.heightCm, 20, 70);
  cfg.door.frameThicknessCm = clamp(+cfg.door.frameThicknessCm || 3, 1, 6);
  cfg.door.glassInsetCm = clamp(+cfg.door.glassInsetCm || 2, 0.5, 6);
  cfg.door.openAngleDeg = clamp(+cfg.door.openAngleDeg || 70, 30, 120);
  cfg.door.hingeSide = cfg.door.hingeSide === 'right' ? 'right' : 'left';
  cfg.door.isOpen = Boolean(cfg.door.isOpen);

  cfg.camera.fov = clamp(+cfg.camera.fov || 50, 35, 85);  cfg.camera.distance = clamp(+cfg.camera.distance || 270, 140, 500);
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

  cfg.calibration ??= {};
  cfg.calibration.enabled = Boolean(cfg.calibration.enabled);
  cfg.calibration.damping = clamp(safeNum(cfg.calibration.damping, 0.75), 0, 1);
  cfg.calibration.globalScale = clamp(+cfg.calibration.globalScale || 1, 0.5, 2);
  cfg.calibration.modeScale = cfg.calibration.modeScale && typeof cfg.calibration.modeScale === 'object' ? cfg.calibration.modeScale : {};
  cfg.calibration.samples = Math.max(0, Math.round(+cfg.calibration.samples || 0));
  cfg.calibration.excludeStartUp = cfg.calibration.excludeStartUp !== false;
  cfg.room ??= {};
  cfg.room.purpose = ['sauna', 'room', 'workshop'].includes(cfg.room.purpose) ? cfg.room.purpose : 'room';
  cfg.room.inputMode = cfg.room.inputMode === 'area' ? 'area' : 'volume';
  cfg.room.volumeM3 = clamp(+cfg.room.volumeM3 || 60, 3, 1000);
  cfg.room.areaM2 = clamp(+cfg.room.areaM2 || 30, 2, 500);
  cfg.room.ceilingM = clamp(+cfg.room.ceilingM || 2.7, 2, 5);
  return cfg;
}

// Дверцята ПЕРЕКРИВАЮТЬ отвір на DOOR_OVERLAP_CM з кожного боку — інакше
// ущільнювальному шнуру нема до чого притискатись. Раніше було навпаки:
// openingW = doorW + 0.8, тобто отвір на 4 мм БІЛЬШИЙ за дверцята з кожного
// боку — стулка провалювалась усередину, а шнур по периметру отвору не
// затискався взагалі. Єдине джерело для 3D (stove-builder.js) і BOM (bom.js):
// обидва мають будувати той самий отвір.
export const DOOR_OVERLAP_CM = 1.5;

// steelCm передає викликач: у 3D товщина листа додатково обмежена габаритами.
export function doorOpening(cfg, steelCm) {
  const w = +cfg.dimensions.widthCm;
  const h = +cfg.dimensions.heightCm;
  const doorW = Math.max(20, Math.min(+cfg.door.widthCm, w - steelCm * 4));
  const doorH = Math.max(20, Math.min(+cfg.door.heightCm, h - steelCm * 4));
  const openingW = clamp(doorW - DOOR_OVERLAP_CM * 2, 10, Math.max(10, w - steelCm * 2));
  const openingH = clamp(doorH - DOOR_OVERLAP_CM * 2, 10, Math.max(10, h - steelCm * 2));
  const openingBottom = Math.max(steelCm, h * 0.48 - openingH / 2);
  const openingTop = Math.min(h - steelCm, openingBottom + openingH);
  const sideW = Math.max(steelCm, (w - openingW) / 2);
  return { doorW, doorH, openingW, openingH, openingBottom, openingTop, sideW };
}

// Геометрія ЗАДНЬОГО виходу — єдине джерело для 3D (stove-builder.js), BOM і
// креслення (bom.js), валідатора (validateConfig) та оптимізатора
// (physics-model.js:optimizeConfig). Комір мусить стояти ВИЩЕ поверненого
// бафля разом із refractory-плитою над ним і нижче кришки; якщо ці дві умови
// несумісні — fits === false, і задній вихід фізично неможливий (на корпусі
// 40 см — завжди, на 50 см — приблизно в половині випадків).
// Одиниці — сантиметри, початок координат — низ корпусу (без ніжок).
export function rearOutletLayout(cfg) {
  const w = +cfg?.dimensions?.widthCm || 70;
  const d = +cfg?.dimensions?.depthCm || 55;
  const h = +cfg?.dimensions?.heightCm || 95;
  const steelMm = +cfg?.materials?.steelThicknessMm || 5;
  // Та сама формула товщини листа, що й у stove-builder.js: на малій печі
  // лист «підрізається» габаритами, інакше 8 мм у корпусі 30 см — це стіна.
  const steelT = Math.min(steelMm / 10, w / 6, d / 6, h / 8);
  const refrT = clamp(safeNum(cfg?.thermal?.baffleRefractoryThicknessCm, 3), 0, 8);
  const chimR = (+cfg?.chimney?.diameterCm || 15) / 2;
  const collarR = chimR * 1.08;
  const innerD = Math.max(10, d - steelT * 2);
  const gap = Math.min(+cfg?.baffle?.frontGapCm || 6, innerD * 0.45);
  const baffleY = Math.max(steelT * 4, Math.min(h - steelT * 2, +cfg?.baffle?.heightCm || 58));
  // Повернутий бафль піднімає свій ЗАДНІЙ край — саме він і заважає коміру.
  const tilt = Math.max(0, Math.sin((+cfg?.baffle?.angleDeg || 0) * Math.PI / 180)) * Math.max(8, innerD - gap) / 2;
  const minY = baffleY + tilt + steelT / 2 + refrT + collarR + 1;
  const yCm = Math.max(minY, h - steelT - collarR - 2);
  const connectorCm = clamp(Math.round(safeNum(cfg?.chimney?.connectorLengthCm, 30)), 15, 150);
  const teeH = chimR * 2.6;
  return {
    yCm, chimR, collarR, steelT, connectorCm, teeH,
    zBack: -d / 2,
    teeZ: -d / 2 - connectorCm,
    fits: yCm + collarR <= h - steelT,
  };
}

// ---------------------------------------------------------------------------
// SECONDARY: отвори поперечної труби під бафлем
// ---------------------------------------------------------------------------
// Площа вторинних отворів масштабується від ОБСЯГУ ТОПКИ: від нього ж залежить
// швидкість горіння, а отже й витрата повітря. 0.082 см²/л дає на Standard
// (топка ≈98 л) 8.0 см² — середина оцінки 6–10 см², яку дає баланс повітря:
// ≈2 кг/год дров × 6 кг повітря/кг × λ 2.2 ≈ 26 кг/год ≈ 22 м³/год, з них
// ~20 % крізь трубу secondary при ~1.6 м/с у отворі (решта — primary і
// air-wash, який у моделі теж рахується як вторинне повітря).
// Старе правило (1 % обсягу, стеля 4 см²) давало 15×Ø3 мм = 1.06 см², тобто
// 2.7 % площі ВСІХ входів повітря. Через це повзун secondary у Φ-тюнері рухав
// у моделі λ 2.01→2.46 — залізо з такими отворами цього дати не могло.
export const SECONDARY_AREA_PER_LITER_CM2 = 0.082;
// Свердла, якими це реально свердлять. Беремо НАЙМЕНШЕ, яким потрібна
// кількість отворів ще влазить в один ряд: багато дрібних струменів
// перемішують газ краще за кілька великих.
export const SECONDARY_DRILLS_CM = [0.3, 0.4, 0.5];
// Перемичка між отворами ≥ 1.2×Ø (крок ≥ 2.2×Ø): інакше труба Ø32×1.5 рветься
// по ряду отворів. Понад два ряди не робимо — це вже не труба, а решето.
const HOLE_PITCH_FACTOR = 2.2;
const MAX_HOLE_ROWS = 2;

// Довжина поперечної труби — та сама формула, що в 3D (stove-builder.js),
// щоб BOM, 3D і підбір отворів рахували один і той самий ряд.
export function secondaryTubeLengthCm(cfg) {
  const w = +cfg?.dimensions?.widthCm || 70;
  const d = +cfg?.dimensions?.depthCm || 55;
  const h = +cfg?.dimensions?.heightCm || 95;
  const steelT = Math.min((+cfg?.materials?.steelThicknessMm || 5) / 10, w / 6, d / 6, h / 8);
  return clamp(Math.max(10, w - steelT * 2) * 0.9, 16, 120);
}

// Підбір отворів під топку: найменше свердло, яким потрібна площа ще влазить
// в один ряд; якщо не влазить і найбільшим — два ряди.
export function sizeSecondaryHoles(fireboxLiters, tubeLenCm) {
  const target = clamp(safeNum(fireboxLiters, 40) * SECONDARY_AREA_PER_LITER_CM2, 0.8, 60);
  const len = clamp(safeNum(tubeLenCm, 60), 16, 120);
  const last = SECONDARY_DRILLS_CM[SECONDARY_DRILLS_CM.length - 1];
  let pick = { holeCount: 8, holeDiameterCm: last };
  for (const dia of SECONDARY_DRILLS_CM) {
    const perRow = Math.max(4, Math.floor(len / (dia * HOLE_PITCH_FACTOR)));
    const count = Math.max(8, Math.round(target / (PI_C * (dia / 2) ** 2)));
    pick = { holeCount: Math.min(count, perRow * MAX_HOLE_ROWS), holeDiameterCm: dia };
    if (count <= perRow || dia === last) break;
  }
  return pick;
}

// Розкладка отворів для 3D і BOM (скільки рядів, який крок).
export function secondaryHolePattern(cfg) {
  const diaCm = clamp(safeNum(cfg?.secondaryAir?.holeDiameterCm, 0.4), 0.25, 5);
  const count = clamp(Math.round(safeNum(cfg?.secondaryAir?.holeCount, 10)), 8, 240);
  const tubeLenCm = secondaryTubeLengthCm(cfg);
  const perRowMax = Math.max(4, Math.floor(tubeLenCm / (diaCm * HOLE_PITCH_FACTOR)));
  const rows = Math.min(MAX_HOLE_ROWS, Math.max(1, Math.ceil(count / perRowMax)));
  const perRow = Math.ceil(count / rows);
  return {
    count, diaCm, rows, perRow, tubeLenCm,
    pitchCm: tubeLenCm / Math.max(1, perRow),
    areaCm2: PI_C * (diaCm / 2) ** 2 * count,
  };
}

// ---------------------------------------------------------------------------
// НИЖНІЙ ВХІД SECONDARY — канал під днищем (варіант «канал», не лоток)
// ---------------------------------------------------------------------------
// Ніжки лишаються привареними до 5-мм ДНИЩА: канал проходить МІЖ ними, а не
// під ними. Суцільний лоток на весь слід печі відкинуто свідомо — ніжка,
// приварена до 2-мм листа лотка, дає під ~780 Н (маса печі /4) згинні
// ~170–290 МПа в листі, тобто межу текучості S235 ще до нагріву й динаміки.
// Канал: поздовжній профіль по осі печі від передньої щілини назад +
// поперечний колектор уздовж задньої кромки, з якого повітря йде крізь два
// отвори в днищі в наявні стояки і далі в наявну поперечну трубу під бафлем.
// ПІДІГРІВ у каналі (оцінка +20…90 °C) НЕ моделюється: нових коефіцієнтів
// для нього немає, а на стелі combustionEff = 92 він лише підняв би втрати
// в трубі. Див. REPORT §7.
export const LEG_SIZE_CM = 5;   // профільна труба 50×50 (stove-builder + BOM)
export const LEG_INSET_CM = 6;  // центр ніжки від краю корпусу
// Механічний упор повзуна: нижче 20 % вторинне горіння задихається.
export const INTAKE_MIN_STOP_PCT = 20;
// Щілина = сталий множник від площі отворів. Мінімальної ширини НЕМАЄ
// навмисно: у попередній специфікації поріг 1.5 см давав співвідношення
// щілина/отвори 3.0 на compact і 1.5 на workshop, тобто однакові відсотки
// повзуна означали різне на різних печах. При 1.5× щілина коштує ~17 % витрати
// на повністю відкритому повзуні (послідовні опори ∝ 1/A²).
export const INTAKE_SLOT_RATIO = 1.5;

const rectOf = (cx, cz, sx, sz) => ({ x0: cx - sx / 2, x1: cx + sx / 2, z0: cz - sz / 2, z1: cz + sz / 2 });
const rectsOverlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.z0 < b.z1 && b.z0 < a.z1;
const rectInside = (outer, inner, tol = 0.01) =>
  inner.x0 >= outer.x0 - tol && inner.x1 <= outer.x1 + tol && inner.z0 >= outer.z0 - tol && inner.z1 <= outer.z1 + tol;

// Слід ніжок у плані (початок координат — центр печі, як у stove-builder).
export function legFootprints(cfg) {
  const w = +cfg?.dimensions?.widthCm || 70;
  const d = +cfg?.dimensions?.depthCm || 55;
  if (!(+cfg?.dimensions?.legHeightCm > 0)) return [];
  return [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz]) =>
    rectOf(sx * (w / 2 - LEG_INSET_CM), sz * (d / 2 - LEG_INSET_CM), LEG_SIZE_CM, LEG_SIZE_CM));
}

// Єдине джерело геометрії нижнього входу для 3D, BOM, фізики й валідатора.
export function bottomIntakeGeometry(cfg) {
  const w = +cfg?.dimensions?.widthCm || 70;
  const d = +cfg?.dimensions?.depthCm || 55;
  const h = +cfg?.dimensions?.heightCm || 95;
  const legH = Math.max(0, safeNum(cfg?.dimensions?.legHeightCm, 0));
  const steelT = Math.min((+cfg?.materials?.steelThicknessMm || 5) / 10, w / 6, d / 6, h / 8);
  const chW = clamp(safeNum(cfg?.secondaryAir?.channelWidthCm, 5), 2, 12);
  const chD = clamp(safeNum(cfg?.secondaryAir?.channelDepthCm, 4), 2, 10);
  const manifoldH = clamp(safeNum(cfg?.secondaryAir?.manifoldHeightCm, 4), 2, 10);
  const enabled = cfg?.secondaryAir?.bottomIntake !== false;
  const holesCm2 = secondaryHolePattern(cfg).areaCm2;
  const targetSlotCm2 = holesCm2 * INTAKE_SLOT_RATIO;

  // Глибину поперечного колектора задає НІЖКА: він мусить пройти позаду неї.
  // 6 − 2.5 − 0.5 = 3.0 см вільної смуги вздовж задньої кромки.
  const ductD = Math.max(1, LEG_INSET_CM - LEG_SIZE_CM / 2 - 0.5);
  // Під днищем лишаємо ≥2 см просвіту до підлоги (тепловий зазор, чистка).
  const maxDuctH = Math.min(8, legH - 2);
  const buildable = enabled && maxDuctH >= 2.5 && ductD > steelT + 0.5 && w > 24;
  // Два плеча колектора мають разом пропустити щілину, тож висота профілю
  // рахується від потрібної площі, а не береться «на око».
  const ductH = buildable ? clamp(Math.max(manifoldH, targetSlotCm2 / (2 * ductD)), 2.5, maxDuctH) : 0;
  const slotH = buildable ? clamp(ductH - 1, 0.8, 2.5) : 0;
  const maxDuctW = Math.max(3, w - (LEG_INSET_CM + LEG_SIZE_CM / 2) * 2 - 1);
  const wantW = buildable ? Math.max(targetSlotCm2 / slotH + 2, targetSlotCm2 * 1.2 / ductH) : 0;
  const ductW = buildable ? clamp(wantW, 4, maxDuctW) : 0;
  // Щілина не ширша за передній торець каналу (по 1 см на борт).
  const slotW = buildable ? Math.max(0.5, Math.min(targetSlotCm2 / slotH, ductW - 2)) : 0;
  const slotAreaCm2 = buildable ? slotW * slotH : 0;
  const armAreaCm2 = buildable ? 2 * ductD * ductH : 0;
  const ductAreaCm2 = buildable ? ductW * ductH : 0;

  const innerW = Math.max(10, w - steelT * 2);
  const innerD = Math.max(10, d - steelT * 2);
  const riserX = Math.max(2, innerW / 2 - chW / 2 - 1);
  const riserZ = -innerD / 2 + chD / 2;
  // Отвір у днищі під стояком — перетин сліду стояка й сліду колектора.
  // Саме тому колектор тиснеться до задньої кромки: слід ніжки починається
  // на 3.5 см від неї, а отвір закінчується на 3.0 см.
  const holeDepth = Math.max(0, ductD - steelT);
  const holeZ = -d / 2 + (steelT + ductD) / 2;
  const holeW = Math.max(1, chW - 1);
  const armHalfW = riserX + chW / 2;
  // Вузьке місце шляху. Враховуємо ВСІ перерізи: щілину, канал, колектор,
  // два вікна в днищі під стояками і самі стояки. Якщо найвужчий менший за
  // отвори труби — потік задає канал, а не отвори, і «повзун керує вторинним
  // повітрям» перестає бути правдою.
  const windowsCm2 = buildable ? 2 * holeW * holeDepth : 0;
  const risersCm2 = buildable ? 2 * chW * chD : 0;
  const fixedPathCm2 = buildable ? Math.min(armAreaCm2, ductAreaCm2, windowsCm2, risersCm2) : 0;
  const minPathCm2 = buildable ? Math.min(slotAreaCm2, fixedPathCm2) : 0;

  return {
    enabled, buildable,
    ductW: round1(ductW), ductH: round1(ductH), ductD: round1(ductD),
    ductLenCm: round1(buildable ? d - ductD : 0),
    armSpanCm: round1(buildable ? armHalfW * 2 : 0),
    slotW: round1(slotW), slotH: round1(slotH),
    slotAreaCm2: round2(slotAreaCm2), targetSlotCm2: round2(targetSlotCm2),
    holesCm2: round2(holesCm2),
    armAreaCm2: round2(armAreaCm2), ductAreaCm2: round2(ductAreaCm2), windowsCm2: round2(windowsCm2), risersCm2: round2(risersCm2),
    fixedPathCm2: round2(fixedPathCm2), minPathCm2: round2(minPathCm2),
    choked: buildable && minPathCm2 + 0.01 < holesCm2,
    groundClearCm: round1(Math.max(0, legH - ductH)),
    riserX, riserZ, holeW, holeDepth, holeZ, armHalfW, steelT,
  };
}

// Перевірка колізій у плані: канал проти ніжок, отвори в днищі проти ніжок,
// отвори всередині слідів стояка й колектора. Порожній масив — усе чисто.
// Ніжки НЕ рухаємо (вони тримають піч) — рухається канал.
export function bottomIntakeCollisions(cfg) {
  const g = bottomIntakeGeometry(cfg);
  if (!g.buildable) return [];
  const d = +cfg?.dimensions?.depthCm || 55;
  const issues = [];
  const duct = { x0: -g.ductW / 2, x1: g.ductW / 2, z0: -d / 2 + g.ductD, z1: d / 2 };
  const arm = { x0: -g.armHalfW, x1: g.armHalfW, z0: -d / 2, z1: -d / 2 + g.ductD };
  const holes = [-g.riserX, g.riserX].map((x) => rectOf(x, g.holeZ, g.holeW, g.holeDepth));
  const risers = [-g.riserX, g.riserX].map((x) => rectOf(x, g.riserZ,
    clamp(safeNum(cfg?.secondaryAir?.channelWidthCm, 5), 2, 12),
    clamp(safeNum(cfg?.secondaryAir?.channelDepthCm, 4), 2, 10)));
  for (const [i, leg] of legFootprints(cfg).entries()) {
    if (rectsOverlap(duct, leg)) issues.push(`duct×leg${i}`);
    if (rectsOverlap(arm, leg)) issues.push(`arm×leg${i}`);
    for (const [j, hole] of holes.entries()) if (rectsOverlap(hole, leg)) issues.push(`hole${j}×leg${i}`);
  }
  for (const [j, hole] of holes.entries()) {
    if (!rectInside(arm, hole)) issues.push(`hole${j}⊄arm`);
    if (!rectInside(risers[j], hole)) issues.push(`hole${j}⊄riser`);
    if (hole.z1 - hole.z0 < 0.8 || hole.x1 - hole.x0 < 0.8) issues.push(`hole${j}_tiny`);
  }
  return issues;
}

// Чи є збережена конфігурація в localStorage. app.js розрізняє «перший запуск»
// (треба повне автопроєктування) і «збережена/поділена геометрія» (бафль
// користувача авторитетний, оптимізатор його не рухає).
export function hasStoredConfig() {
  for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
    try { if (localStorage.getItem(key)) return true; } catch { /* ignore */ }
  }
  return false;
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
  const merged = deepMerge(cfg, preset.patch);
  // Готова модель обирає дверцята так само навмисно, як і ручний слайдер —
  // цей розмір стає новим "бажаним" (див. door.preferredWidthCm/HeightCm).
  if (preset.patch.door) {
    merged.door.preferredWidthCm = merged.door.widthCm;
    merged.door.preferredHeightCm = merged.door.heightCm;
  }
  return normalizeConfig(merged);
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
  // Двостороння перевірка димоходу: замала труба (ризик CO/димлення) і завелика (креозот).
  const thermalFlue = cfg.thermal || {};
  const insFlue = thermalFlue.insulationThicknessCm == null ? 3 : +thermalFlue.insulationThicknessCm;
  const linerFlue = cfg.materials.firebrickThicknessCm + insFlue;
  const fbW = Math.max(10, cfg.dimensions.widthCm - steelCm * 2 - linerFlue * 2);
  const fbD = Math.max(10, cfg.dimensions.depthCm - steelCm * 2 - linerFlue * 2);
  const fbH = Math.max(10, Math.min(cfg.baffle.heightCm, cfg.dimensions.heightCm) - steelCm - linerFlue);
  const flueLiters = (fbW * fbD * fbH) / 1000;
  const flueDiaCm = cfg.chimney.diameterCm + steelCm; // внутрішній Ø (труба + стінка)
  const flueMinCm = Math.max(10, Math.min(18, 11 + flueLiters * 0.03));
  const flueMaxCm = Math.max(14, Math.min(25, 17 + flueLiters * 0.05));
  if (flueDiaCm < flueMinCm) {
    warnings.push({ code: 'CHIMNEY_NARROW', values: { diameter: cfg.chimney.diameterCm, min: +flueMinCm.toFixed(1) } });
  }
  if (flueDiaCm > flueMaxCm) {
    warnings.push({ code: 'CHIMNEY_LARGE', values: { diameter: cfg.chimney.diameterCm, max: +flueMaxCm.toFixed(1) } });
  }
  if (cfg.materials.firebrickThicknessCm > Math.min(cfg.dimensions.widthCm, cfg.dimensions.depthCm) / 8) {
    warnings.push({ code: 'LINING_THICK', values: { thickness: cfg.materials.firebrickThicknessCm } });
  }

  // Колізій-перевірки шарів на крайніх значеннях.
  const thermal = cfg.thermal || {};
  const insT = thermal.insulationThicknessCm == null ? 3 : +thermal.insulationThicknessCm;
  const refrT = thermal.baffleRefractoryThicknessCm == null ? 3 : +thermal.baffleRefractoryThicknessCm;
  const linerCm = cfg.materials.firebrickThicknessCm + insT;
  const innerW = cfg.dimensions.widthCm - steelCm * 2 - linerCm * 2;
  const innerD = cfg.dimensions.depthCm - steelCm * 2 - linerCm * 2;
  if (innerW < 8 || innerD < 8) {
    errors.push({ code: 'LINER_OVERFILL', values: { innerW: +innerW.toFixed(1), innerD: +innerD.toFixed(1) } });
  }
  if (cfg.baffle.heightCm + refrT >= cfg.dimensions.heightCm - steelCm * 2) {
    errors.push({ code: 'BAFFLE_REFRACTORY_HIGH', values: { height: cfg.baffle.heightCm, refractory: refrT } });
  }
  if (cfg.secondaryAir.channelWidthCm * 2 + 6 > innerW) {
    warnings.push({ code: 'SECONDARY_CHANNEL_WIDE', values: { width: cfg.secondaryAir.channelWidthCm, innerW: +innerW.toFixed(1) } });
  }
  if (cfg.airWash.channelWidthCm * 2 + cfg.door.widthCm > Math.max(innerW, 10) + 4) {
    warnings.push({ code: 'AIRWASH_CHANNEL_WIDE', values: { width: cfg.airWash.channelWidthCm, door: cfg.door.widthCm } });
  }
  const hoodDepth = (cfg.dimensions.depthCm / 2 - steelCm) - (cfg.chimney.diameterCm / 2 * 1.08) - 1.5 - (-cfg.dimensions.depthCm * 0.2);
  if (hoodDepth < 5) warnings.push({ code: 'GAS_HOOD_TIGHT', values: { depth: +hoodDepth.toFixed(1) } });

  // Нижній вхід secondary. Це ПОПЕРЕДЖЕННЯ, а не помилка: піч без каналу
  // лишається валідною (secondary живиться, як і раніше, з-під днища), просто
  // повзуна на фасаді не буде.
  const intake = bottomIntakeGeometry(cfg);
  if (intake.enabled && !intake.buildable) {
    warnings.push({ code: 'BOTTOM_INTAKE_NO_ROOM', values: { legs: cfg.dimensions.legHeightCm, need: 4.5 } });
  }
  // Канал вужчий за самі отвори: витрату задає канал, а не повзун.
  if (intake.buildable && intake.choked) {
    warnings.push({ code: 'BOTTOM_INTAKE_CHOKED', values: { area: intake.minPathCm2, need: intake.holesCm2 } });
  }

  // Задній вихід: комір мусить фізично влізти між бафлем і кришкою.
  // Помилка (а не мовчазна підміна на 'top'), щоб користувач бачив причину.
  const rear = rearOutletLayout(cfg);
  if (cfg.chimney.outlet === 'rear' && !rear.fits) {
    errors.push({ code: 'REAR_OUTLET_NO_ROOM', values: { height: cfg.dimensions.heightCm, need: +(rear.yCm + rear.collarR + steelCm).toFixed(1) } });
  }
  // Норму патрубка (~0.4 м) перевіряє PhysicsModel (попередження CONNECTOR_LONG);
  // тут його НЕ дублюємо — інакше панель показувала те саме двічі.
  // Задній тепловий екран доводиться обрізати під комір — у цьому місці
  // одностінна труба лишається без екрана, тож потрібен відступ від стіни.
  if (cfg.chimney.outlet === 'rear' && cfg.visibility && cfg.visibility.shields) {
    warnings.push({ code: 'REAR_SHIELD_CUT', values: { y: +rear.yCm.toFixed(1) } });
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
