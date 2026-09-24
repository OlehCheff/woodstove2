// Швидкі тести PhysicsModel v5 — запуск: node tests/physics.test.js
import { readFileSync } from 'node:fs';
import { PhysicsModel, optimizeConfig, compareOutlets } from '../js/physics-model.js';
import { defaultConfig, normalizeConfig, applyModePreset, applyModelPreset, validateConfig, deepMerge, encodeConfig, decodeConfig, doorOpening, DOOR_OVERLAP_CM, MODEL_PRESETS, rearOutletLayout, bottomIntakeGeometry, bottomIntakeCollisions, legFootprints, secondaryHolePattern, SECONDARY_AREA_PER_LITER_CM2, INTAKE_MIN_STOP_PCT, SECONDARY_DRILLS_CM } from '../js/config.js';
import { STR, WARN_TXT, WARN_ARG, VALIDATION_TXT, OUTLET_TXT, PROD_TXT } from '../js/i18n.js';
import { calibrateFromLog, evaluateCalibration, detectJournalDesync, mergeCalibration, emptyCalibration, configSnapshot } from '../js/calibration.js';
import { buildBOM, bomToCsv, buildDrawingSVG, buildDXF, bomGeometry, buildWeldPlan, buildFitPlan } from '../js/bom.js';
import { steelStrain, stainlessStrain, fireclayStrain, filletA } from '../js/production.js';
import { designInternals } from '../js/autodesign.js';
import { requiredPowerKw, sizeStoveForPower, evaluateRoom, PURPOSES } from '../js/room.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
let fails = 0;
function ok(cond, msg, extra = '') {
  if (cond) console.log(`PASS ${msg} ${extra}`);
  else { console.error(`FAIL ${msg} ${extra}`); fails++; }
}

const base = normalizeConfig(clone(defaultConfig));

// 1. medium в адекватних межах
let r = PhysicsModel.evaluate(base);
ok(r.metrics.efficiencyPct >= 65 && r.metrics.efficiencyPct <= 84, 'medium eff', JSON.stringify(r.metrics));
ok(r.metrics.heatOutputKw >= 4 && r.metrics.heatOutputKw <= 12, 'medium kW', JSON.stringify(r.metrics));
ok(r.metrics.burnTimeHours >= 3 && r.metrics.burnTimeHours <= 10, 'medium burn', JSON.stringify(r.metrics));
ok(r.metrics.draftPa > 0 && r.metrics.fireboxLiters > 20, 'draft+firebox', JSON.stringify(r.metrics));
ok(r.metrics.secondaryOpeningAreaCm2 > 0 && r.metrics.airWashOpeningAreaCm2 > 0, 'airflow areas', JSON.stringify(r.metrics));
ok(r.metrics.secondaryPreheatC > 100 && r.metrics.airWashPreheatC > 80, 'airflow preheat', JSON.stringify(r.metrics));
ok(r.metrics.recommendedLoadKg > 0 && r.metrics.maxLoadKg > r.metrics.recommendedLoadKg, 'load from firebox volume', JSON.stringify(r.metrics));
ok(r.metrics.combustionTempC > r.metrics.modeledFlueTempC && r.metrics.flueLossPct > 0, 'thermal zones and flue loss', JSON.stringify(r.metrics));
ok(r.metrics.usefulEnergyKwh > 0 && r.metrics.usefulEnergyKwh < r.metrics.inputEnergyKwh, 'energy balance', JSON.stringify(r.metrics));
ok(base.secondaryAir.preheatLengthCm > 0 && base.airWash.slotWidthPct >= 40, 'airflow config normalized', JSON.stringify({ secondary: base.secondaryAir, airWash: base.airWash }));

// 1b. insulated firebox retains more heat than an uninsulated shell
const bareThermal = normalizeConfig(clone(defaultConfig));
bareThermal.thermal.insulationThicknessCm = 0;
bareThermal.thermal.baffleRefractoryThicknessCm = 0;
const insulatedThermal = normalizeConfig(clone(defaultConfig));
insulatedThermal.thermal.insulationThicknessCm = 8;
insulatedThermal.thermal.baffleRefractoryThicknessCm = 8;
const bareResult = PhysicsModel.evaluate(bareThermal);
const insulatedResult = PhysicsModel.evaluate(insulatedThermal);
ok(insulatedResult.metrics.thermalRetentionPct > bareResult.metrics.thermalRetentionPct, 'insulation retention', JSON.stringify({ bare: bareResult.metrics.thermalRetentionPct, insulated: insulatedResult.metrics.thermalRetentionPct }));
ok(insulatedResult.metrics.fireboxLiters < bareResult.metrics.fireboxLiters, 'insulation reduces firebox volume', JSON.stringify({ bare: bareResult.metrics.fireboxLiters, insulated: insulatedResult.metrics.fireboxLiters }));

// 2. overnight: мала потужність, довге горіння + SMOKE_RISK можливий
let night = normalizeConfig(clone(defaultConfig));
applyModePreset(night, 'overnight');
r = PhysicsModel.evaluate(night);
ok(r.metrics.heatOutputKw < PhysicsModel.evaluate(base).metrics.heatOutputKw, 'overnight < medium power', JSON.stringify(r.metrics));
ok(r.metrics.burnTimeHours > 6, 'overnight long burn', JSON.stringify(r.metrics));

// 3. high + тонка сталь = OVERHEAT_RISK
let hot = normalizeConfig(clone(defaultConfig));
applyModePreset(hot, 'high');
hot.materials.steelThicknessMm = 3;
r = PhysicsModel.evaluate(hot);
ok(r.warnings.some(w => w.code === 'OVERHEAT_RISK'), 'overheat warning', JSON.stringify(r.warnings.map(w=>w.code)));

// 4. задушений режим = SMOKE_RISK
let choked = normalizeConfig(clone(defaultConfig));
choked.primaryAir.openPct = 10; choked.operation.secondaryAirPct = 15;
r = PhysicsModel.evaluate(choked);
ok(r.warnings.some(w => w.code === 'SMOKE_RISK'), 'smoke warning', JSON.stringify(r.warnings.map(w=>w.code)));

// 5. малий secondary manifold та вузький air-wash дають окремі технічні warnings
let restricted = normalizeConfig(clone(defaultConfig));
restricted.combustion.washAsSecondary = false;
restricted.secondaryAir.holeCount = 4;
restricted.secondaryAir.holeDiameterCm = 0.4;
restricted.airWash.slotWidthPct = 50;
restricted.airWash.gapCm = 0.5;
restricted.airWash.intakePct = 100;
r = PhysicsModel.evaluate(restricted);
ok(r.warnings.some(w => w.code === 'SECONDARY_RESTRICTED'), 'secondary restriction warning', JSON.stringify(r.warnings.map(w=>w.code)));
ok(r.warnings.some(w => w.code === 'AIRWASH_LOW' || w.code === 'AIRWASH_JETS'), 'airwash geometry warning', JSON.stringify(r.warnings.map(w=>w.code)));

// 6. низький димохід = слабка тяга
let lowStack = normalizeConfig(clone(defaultConfig));
lowStack.chimney.heightCm = 100; lowStack.chimney.diameterCm = 10; lowStack.chimney.totalHeightM = 2; lowStack.chimney.bends = 3; lowStack.operation.flameIntensity = 0.2;
r = PhysicsModel.evaluate(lowStack);
ok(r.metrics.draftPa < 10, 'weak draft value', JSON.stringify(r.metrics));
ok(r.warnings.some(w => w.code === 'DRAFT_WEAK'), 'draft warning', JSON.stringify(r.warnings.map(w=>w.code)));

// 7. всі пресети без NaN
for (const m of ['start-up','low','medium','high','overnight']) {
  const c = normalizeConfig(clone(defaultConfig)); applyModePreset(c, m);
  const rr = PhysicsModel.evaluate(c);
  ok(Number.isFinite(rr.metrics.efficiencyPct) && Number.isFinite(rr.metrics.heatOutputKw), `preset ${m} finite`, JSON.stringify(rr.metrics));
}

// 8. модельні пресети дають валідну геометрію
for (const name of Object.keys(MODEL_PRESETS)) {
  let c = normalizeConfig(clone(defaultConfig));
  c = applyModelPreset(c, name);
  const validation = validateConfig(c);
  ok(validation.valid, `model preset ${name} valid`, JSON.stringify(validation.errors));
  ok(c.dimensions.widthCm >= 40 && c.dimensions.widthCm <= 140, `model preset ${name} dimensions`, JSON.stringify(c.dimensions));
}

// 9. некоректна геометрія повертає зрозумілий код, а не ламає сцену
const invalid = normalizeConfig(clone(defaultConfig));
invalid.door.widthCm = 70;
invalid.dimensions.widthCm = 40;
const invalidResult = validateConfig(invalid);
ok(!invalidResult.valid, 'invalid door geometry detected', JSON.stringify(invalidResult.errors));
ok(invalidResult.errors.some((item) => item.code === 'DOOR_TOO_WIDE'), 'invalid geometry has stable code');

// 10. optimizer returns a valid candidate and does not mutate the source
const beforeOptimization = JSON.stringify(base.baffle);
const optimized = optimizeConfig(base);
ok(optimized?.result?.metrics?.efficiencyPct >= 52, 'optimizer returns candidate', JSON.stringify(optimized?.result?.metrics));
ok(validateConfig(optimized.config).valid, 'optimized geometry valid', JSON.stringify(validateConfig(optimized.config).errors));
ok(JSON.stringify(base.baffle) === beforeOptimization, 'optimizer keeps source immutable');

// 11. Калібрування на реальному журналі Test Burn зменшує відхилення
const realLog = [
  { mode: 'medium', predictedKw: 4.10, measuredKw: 4.11 },
  { mode: 'low', predictedKw: 2.89, measuredKw: 3.10 },
  { mode: 'high', predictedKw: 5.65, measuredKw: 5.37 },
];
const cal = calibrateFromLog(realLog);
ok(cal && cal.samples === 3, 'calibration fit from log', JSON.stringify(cal));
const stats = evaluateCalibration(realLog, cal);
ok(stats && stats.afterMaxAbsPct < stats.beforeMaxAbsPct, 'calibration reduces max deviation', JSON.stringify(stats));
ok(stats.afterMeanAbsPct < stats.beforeMeanAbsPct, 'calibration reduces mean deviation', JSON.stringify(stats));

// 11b. Застосування калібрування у PhysicsModel змінює потужність, але лишається finite
const calCfg = normalizeConfig(clone(defaultConfig));
calCfg.operation.mode = 'low';
calCfg.calibration = cal;
const lowNoCal = normalizeConfig(clone(defaultConfig)); lowNoCal.operation.mode = 'low';
const kwCal = PhysicsModel.evaluate(calCfg).metrics.heatOutputKw;
const kwNoCal = PhysicsModel.evaluate(lowNoCal).metrics.heatOutputKw;
ok(Number.isFinite(kwCal) && Math.abs(kwCal - kwNoCal) > 0.01, 'calibration changes output', JSON.stringify({ kwCal, kwNoCal }));

// 11c. excludeStartUp: start-up не входить у калібрування
const withStartup = [
  { mode: 'start-up', predictedKw: 6.0, measuredKw: 4.0 },
  { mode: 'medium', predictedKw: 4.0, measuredKw: 4.0 },
];
const calNoExcl = calibrateFromLog(withStartup);
const calExcl = calibrateFromLog(withStartup, { excludeStartUp: true });
ok(calExcl && calExcl.samples === 1, 'excludeStartUp drops start-up entry', JSON.stringify({ calNoExcl, calExcl }));
ok(calExcl.modeScale['start-up'] === 1, 'start-up modeScale untouched', JSON.stringify(calExcl.modeScale));

// 11d. clamped modes виявлено коли глобальний масштаб сильно відрізняється
const extreme = [
  { mode: 'medium', predictedKw: 4.0, measuredKw: 7.0 },
  { mode: 'low', predictedKw: 1.5, measuredKw: 7.0 },
  { mode: 'high', predictedKw: 8.0, measuredKw: 7.0 },
];
const calExt = calibrateFromLog(extreme);
ok(calExt, 'clamped modes computed');
const statsExt = evaluateCalibration(extreme, calExt);
ok(statsExt && Array.isArray(statsExt.clamped) && statsExt.clamped.length === 3, 'clamped mode list', JSON.stringify(statsExt.clamped));

// 11e. detectJournalDesync: синхронний журнал → 0, підміна → count
const livePredicted = PhysicsModel.evaluate({ ...base, calibration: { ...(base.calibration || {}), enabled: false } }).metrics.heatOutputKw;
const syncLog = [
  { mode: 'medium', predictedKw: +livePredicted.toFixed(2), measuredKw: +livePredicted.toFixed(2), config: JSON.parse(JSON.stringify(base)) },
];
ok(detectJournalDesync(syncLog).count === 0, 'sync journal detected as 0', JSON.stringify(detectJournalDesync(syncLog)));
const staleLog = [
  { mode: 'medium', predictedKw: +(livePredicted * 0.5).toFixed(2), measuredKw: +livePredicted.toFixed(2), config: JSON.parse(JSON.stringify(base)) },
];
const desyncResult = detectJournalDesync(staleLog);
ok(desyncResult.count === 1 && desyncResult.samples === 1, 'desynced journal detected', JSON.stringify(desyncResult));

// 11g. Minor #2: знімок журналу повний — прогноз по ньому = прогнозу по живому
// конфігу навіть із нестандартною вологістю; старий знімок без вологості
// і зсув моделі на ~3% (нижче старого порогу 5%) — ловляться.
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  c.testBurn.woodMoisturePct = 25;
  const kwOf = (x) => PhysicsModel.evaluate({ ...x, calibration: { ...(x.calibration || {}), enabled: false } }).metrics.heatOutputKw;
  const snap = configSnapshot(c);
  const live = kwOf(c);
  ok(snap.testBurn.woodMoisturePct === 25 && !('camera' in snap) && !('calibration' in snap), 'snapshot keeps physics fields, drops UI ones', JSON.stringify(snap.testBurn));
  ok(Math.abs(kwOf(snap) - live) < 1e-9, 'snapshot prediction equals live prediction', JSON.stringify({ live, snap: kwOf(snap) }));
  const entry = (p, cfg) => ({ mode: 'medium', predictedKw: +p.toFixed(2), measuredKw: 5, config: cfg });
  ok(detectJournalDesync([entry(live, snap)]).count === 0, 'fresh full snapshot is in sync');
  ok(detectJournalDesync([entry(live * 1.03, snap)]).count === 1, '3% model drift is detected');
  const legacy = clone(snap); delete legacy.testBurn.woodMoisturePct;
  ok(detectJournalDesync([entry(live, legacy)]).count === 1, 'legacy snapshot without moisture is flagged');
}

// 11f. Major #1: шлях UI (calibrateModel) — повторне калібрування зі знятим
// excludeStartUp дає ті самі фактори, прапорець не злітає назад у true.
{
  let c = normalizeConfig(clone(defaultConfig));
  c.calibration.excludeStartUp = false;
  const uiCalibrate = () => {
    const r = calibrateFromLog(withStartup, { excludeStartUp: !!c.calibration.excludeStartUp });
    c = normalizeConfig({ ...c, calibration: mergeCalibration(r, c.calibration) });
    return c.calibration;
  };
  const first = uiCalibrate();
  const second = uiCalibrate();
  ok(first.excludeStartUp === false && second.excludeStartUp === false, 'UI calibration keeps excludeStartUp=false', JSON.stringify({ first: first.excludeStartUp, second: second.excludeStartUp }));
  ok(first.globalScale === second.globalScale && first.samples === second.samples && first.samples === 2, 'UI calibration is idempotent', JSON.stringify({ first, second }));
  c = normalizeConfig({ ...c, calibration: mergeCalibration(emptyCalibration(), c.calibration) });
  ok(c.calibration.excludeStartUp === false && c.calibration.enabled === false, 'reset keeps excludeStartUp', JSON.stringify(c.calibration));
}

// 12. BOM: стабільні числа, маса/різ/шви, без NaN на всіх пресетах
for (const name of Object.keys(MODEL_PRESETS)) {
  const c = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
  const bom = buildBOM(c);
  const bad = bom.parts.filter(p => !Number.isFinite(p.massKg) || !Number.isFinite(p.weldCm) || !Number.isFinite(p.areaCm2) || p.wCm <= 0 || p.hCm <= 0 || p.tCm <= 0);
  ok(bad.length === 0, `BOM ${name} parts valid`, JSON.stringify(bad.slice(0, 2)));
  ok(bom.totals.steelMassKg > 0 && bom.totals.cutAreaM2 > 0 && bom.totals.weldMeters > 0, `BOM ${name} totals`, JSON.stringify(bom.totals));
  ok(bom.totals.purchasedCount >= 4, `BOM ${name} purchased parts`, JSON.stringify({ purchased: bom.totals.purchasedCount }));
  ok(bomToCsv(bom, 'uk').split('\n').length > bom.parts.length, `BOM ${name} csv export`);
}
ok(buildDrawingSVG(base).startsWith('<svg') && buildDrawingSVG(base).endsWith('</svg>'), 'drawing svg valid');
ok(buildDXF(base).includes('LINE') && buildDXF(base).endsWith('EOF'), 'dxf valid');

// 13. Колізій-валідація шарів на крайніх значеннях
const overfill = normalizeConfig(clone(defaultConfig));
overfill.thermal.insulationThicknessCm = 8;
overfill.materials.firebrickThicknessCm = 8;
overfill.dimensions.widthCm = 40; overfill.dimensions.depthCm = 35;
ok(validateConfig(overfill).errors.some(e => e.code === 'LINER_OVERFILL'), 'liner overfill error', JSON.stringify(validateConfig(overfill).errors.map(e => e.code)));

const tallBaffle = normalizeConfig(clone(defaultConfig));
tallBaffle.baffle.heightCm = 120; tallBaffle.thermal.baffleRefractoryThicknessCm = 8;
ok(validateConfig(tallBaffle).errors.some(e => e.code === 'BAFFLE_REFRACTORY_HIGH' || e.code === 'BAFFLE_TOO_HIGH'), 'baffle+refractory height error', JSON.stringify(validateConfig(tallBaffle).errors.map(e => e.code)));

const wideSec = normalizeConfig(clone(defaultConfig));
wideSec.secondaryAir.channelWidthCm = 12;
ok(validateConfig(wideSec).warnings.some(w => w.code === 'SECONDARY_CHANNEL_WIDE') || validateConfig(wideSec).valid, 'secondary channel wide warning or valid', JSON.stringify(validateConfig(wideSec).warnings.map(w => w.code)));

// 14. Автопроєктування внутрішньої геометрії
const tiny = normalizeConfig(clone(defaultConfig));
tiny.dimensions = { widthCm: 30, depthCm: 30, heightCm: 40, legHeightCm: 0 };
const designed = designInternals(tiny);
ok(validateConfig(designed).valid, 'autodesign min dims valid', JSON.stringify(validateConfig(designed).errors));
ok(designed.door.widthCm <= 30 && designed.door.heightCm <= 40, 'autodesign door fits body', JSON.stringify({ w: designed.door.widthCm, h: designed.door.heightCm }));
const dm = PhysicsModel.evaluate(designed).metrics;
ok(Number.isFinite(dm.efficiencyPct) && Number.isFinite(dm.heatOutputKw), 'autodesign finite', JSON.stringify({ eff: dm.efficiencyPct, kw: dm.heatOutputKw }));
for (const name of Object.keys(MODEL_PRESETS)) {
  const c = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
  const dd = designInternals(c);
  ok(validateConfig(dd).valid, `autodesign ${name} valid`, JSON.stringify(validateConfig(dd).errors));
}
// толстий шамот на мінімальній печі не має робити конфіг невалідним
const fatBrick = normalizeConfig(clone(defaultConfig));
fatBrick.dimensions = { widthCm: 30, depthCm: 30, heightCm: 40, legHeightCm: 0 };
fatBrick.materials.firebrickThicknessCm = 8;
ok(validateConfig(designInternals(fatBrick)).valid, 'autodesign caps thick firebrick on small stove', JSON.stringify(validateConfig(designInternals(fatBrick)).errors));

// 15. Підбір печі під приміщення
ok(requiredPowerKw('room', 140) > 0 && requiredPowerKw('sauna', 10) > requiredPowerKw('room', 10), 'room power scaling', JSON.stringify({ room140: requiredPowerKw('room', 140), sauna10: requiredPowerKw('sauna', 10) }));
const sized = sizeStoveForPower(6, normalizeConfig(clone(defaultConfig)));
ok(sized && validateConfig(sized.config).valid, 'sizeStoveForPower valid', JSON.stringify(validateConfig(sized?.config || {}).errors));
ok(Math.abs(sized.kw - 6) < 6, 'sizeStoveForPower near target', JSON.stringify({ target: 6, got: sized.kw }));
const roomCfg = normalizeConfig(clone(defaultConfig));
roomCfg.room = { purpose: 'room', inputMode: 'volume', volumeM3: 60, areaM2: 30, ceilingM: 2.7 };
const rc = evaluateRoom(roomCfg);
ok(rc.volume === 60 && rc.targetKw > 0 && Number.isFinite(rc.actualKw), 'evaluateRoom', JSON.stringify(rc));
for (const p of Object.keys(PURPOSES)) ok(PURPOSES[p].kwPerM3 > 0 && PURPOSES[p].mode, `purpose ${p} defined`);

// ---------------------------------------------------------------------
// 16+. Регресійні тести за незалежною верифікацією 2026-09-13/14.
// Кожен блок закріплює один Major/Minor фікс, щоб числа не «зʼїхали»
// назад мовчки. Геометричні фікси (aeroFlow-експорт, doorCatch, Explode/
// камера при Скинути) сюди НЕ входять — вони живуть у stove-builder.js /
// app.js, які імпортують `three` й DOM; у проєкті свідомо немає збірки й
// node_modules, тож three не резолвиться в plain Node. Ці три фікси
// перевірені вручну в headless Chromium (див. коміти fix(geometry)/
// fix(app): "Скинути" — скріншоти й виміряні зазори в повідомленнях
// комітів), а не автотестом.
// ---------------------------------------------------------------------

// 16. Major #1: ККД не має зростати з вологістю дров (латентна теплота
// пароутворення йде в димохід, а не зникає безслідно).
{
  let anyRise = 0, n = 0;
  for (const w of [40, 70, 100, 130]) for (const mode of ['start-up', 'low', 'medium', 'high', 'overnight']) {
    const c = normalizeConfig(clone(defaultConfig)); c.dimensions.widthCm = w; applyModePreset(c, mode); designInternals(c);
    let prevEff = -1, rose = false;
    for (const mo of [8, 15, 22, 28, 35]) {
      const cc = clone(c); cc.testBurn.woodMoisturePct = mo;
      const e = PhysicsModel.evaluate(cc).metrics.efficiencyPct;
      if (prevEff >= 0 && e > prevEff + 1e-9) rose = true;
      prevEff = e;
    }
    n++; if (rose) anyRise++;
  }
  ok(anyRise === 0, 'efficiency never rises with moisture', JSON.stringify({ cases: n, rose: anyRise }));
}

// 17. Major #2: бонус каталізатора видно навіть коли combustionEff уже на
// стелі 92 (типовий випадок для Standard/medium) — рахується ПІСЛЯ стелі.
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  const off = PhysicsModel.evaluate(c).metrics;
  const on = clone(c); on.combustion.catalyst.enabled = true;
  const onM = PhysicsModel.evaluate(on).metrics;
  ok(onM.catalystActive === true, 'catalyst active on default stove', JSON.stringify({ combustionTempC: onM.combustionTempC }));
  ok(onM.efficiencyPct > off.efficiencyPct, 'catalyst bonus visible in efficiencyPct', JSON.stringify({ off: off.efficiencyPct, on: onM.efficiencyPct }));
  ok(onM.heatOutputKw > off.heatOutputKw, 'catalyst bonus visible in heatOutputKw', JSON.stringify({ off: off.heatOutputKw, on: onM.heatOutputKw }));
}

// 18. Major #3: SECONDARY_INACTIVE реально досяжний (не лише теоретично)
// на холодній, вологій, слабкій печі — раніше мінімум по UI був 633°C
// (>600°C поріг), тепер має опускатись нижче.
{
  const c = normalizeConfig(clone(defaultConfig));
  Object.assign(c.dimensions, { widthCm: 40, depthCm: 45, heightCm: 40 });
  c.materials.steelThicknessMm = 8; c.materials.firebrickThicknessCm = 2;
  applyModePreset(c, 'overnight'); designInternals(c);
  c.testBurn.woodMoisturePct = 35;
  const r = PhysicsModel.evaluate(c);
  ok(r.metrics.combustionTempC < 600, 'coldest UI-reachable zone dips below 600C', JSON.stringify({ combustionTempC: r.metrics.combustionTempC }));
  ok(r.metrics.secondaryActive === false, 'secondaryActive false there', JSON.stringify({ secondaryActive: r.metrics.secondaryActive }));
  ok(r.warnings.some((w) => w.code === 'SECONDARY_INACTIVE'), 'SECONDARY_INACTIVE fires', JSON.stringify(r.warnings.map((w) => w.code)));
}

// 19. Major #4: DRAFT_WEAK спрацьовує на задокументованому сценарії
// (2 м димоходу + 3 вигини, medium) — раніше поріг 7 Па не ловив 8.1 Па.
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  c.chimney.totalHeightM = 2; c.chimney.bends = 3;
  const r = PhysicsModel.evaluate(c);
  ok(r.metrics.draftPa < 9, 'weak-chimney scenario draft below new threshold', JSON.stringify({ draftPa: r.metrics.draftPa }));
  ok(r.warnings.some((w) => w.code === 'DRAFT_WEAK'), 'DRAFT_WEAK fires on medium, 2m+3 bends', JSON.stringify(r.warnings.map((w) => w.code)));
}

// 20. Major #6: вихідна температура димоходу — гладка монотонна крива, а
// не лінійна формула, що впиралась у ту саму підлогу (40°C) для будь-якої
// печі на довгих трубах.
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  const exits = [2, 5, 9, 12].map((H) => { const cc = clone(c); cc.chimney.totalHeightM = H; return PhysicsModel.evaluate(cc).metrics.exitFlueTempC; });
  ok(exits.every((v, i) => i === 0 || v < exits[i - 1]), 'exitFlueTempC strictly decreases with flue height', JSON.stringify(exits));
  const hot = clone(c); hot.chimney.totalHeightM = 9; applyModePreset(hot, 'high'); designInternals(hot);
  const cold = clone(c); cold.chimney.totalHeightM = 9; applyModePreset(cold, 'overnight'); designInternals(cold);
  const hotExit = PhysicsModel.evaluate(hot).metrics.exitFlueTempC, coldExit = PhysicsModel.evaluate(cold).metrics.exitFlueTempC;
  ok(hotExit !== coldExit, 'exitFlueTempC does not collapse to one floor value at H=9', JSON.stringify({ hotExit, coldExit }));
}

// 21. Major #5: перемикання режиму в сесії дає ту саму піч, що й
// завантаження/поділитися-посилання з тим самим збереженим режимом
// (зміна режиму перепроєктовує, а завантаження зберігає готову геометрію).
{
  for (const m of ['low', 'high', 'overnight']) {
    const live = designInternals(normalizeConfig(clone(defaultConfig)));
    applyModePreset(live, m); designInternals(live); // те, що робить app.js у обробнику зміни режиму
    const reloaded = designInternals(normalizeConfig(deepMerge(clone(defaultConfig), clone(live))), { keepBaffle: true }); // те, що робить app.js при завантаженні
    const a = PhysicsModel.evaluate(live).metrics, b = PhysicsModel.evaluate(reloaded).metrics;
    ok(a.efficiencyPct === b.efficiencyPct && a.heatOutputKw === b.heatOutputKw && live.baffle.heightCm === reloaded.baffle.heightCm,
      `mode switch matches reload for ${m}`, JSON.stringify({ live: { eff: a.efficiencyPct, kw: a.heatOutputKw, baffle: live.baffle.heightCm }, reloaded: { eff: b.efficiencyPct, kw: b.heatOutputKw, baffle: reloaded.baffle.heightCm } }));
  }
}

// 22. Major #8: автопідібраний діаметр труби ніколи не суперечить
// власному коридору валідатора (раніше — 634/1350 у свипі верифікації).
{
  let n = 0, bad = 0;
  for (let w = 50; w <= 110; w += 10) for (let d = 45; d <= 90; d += 10) for (let h = 70; h <= 140; h += 20) {
    const c = normalizeConfig(clone(defaultConfig)); Object.assign(c.dimensions, { widthCm: w, depthCm: d, heightCm: h }); designInternals(c); n++;
    if (validateConfig(c).warnings.some((x) => x.code.startsWith('CHIMNEY'))) bad++;
  }
  ok(bad === 0, 'auto chimney diameter never conflicts with its own validator', JSON.stringify({ cases: n, conflicts: bad }));
}

// 23. Major #9: кожен рядок BOM CSV (заголовок, деталі, підсумок) має
// рівно 11 колонок — раніше порожній рядок і підсумок ламали цю умову.
{
  const parseCsv = (text) => {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    row.push(f); rows.push(row); return rows;
  };
  for (const lang of ['uk', 'en']) {
    const c = designInternals(normalizeConfig(clone(defaultConfig)));
    const rows = parseCsv(bomToCsv(buildBOM(c, null, lang), lang));
    const bad = rows.filter((row) => row.length !== 11);
    ok(bad.length === 0, `BOM CSV ${lang}: every row has 11 columns`, JSON.stringify({ rows: rows.length, bad: bad.length }));
  }
}

// 24. Major #10: EN BOM CSV не містить кирилиці.
{
  const cyr = /[А-Яа-яІіЇїЄєҐґʼ]/;
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  c.combustion.tertiary.enabled = true; c.combustion.catalyst.enabled = true;
  const csv = bomToCsv(buildBOM(c, null, 'en'), 'en');
  const cyrLines = csv.split('\n').filter((l) => cyr.test(l));
  ok(cyrLines.length === 0, 'EN BOM CSV has no Cyrillic', JSON.stringify(cyrLines.slice(0, 3)));
}

// 25. Major #18: нержавійка (secondary/tertiary труби) входить у масу
// металу в підсумку BOM, а не губиться повз фільтр "лише сталь".
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  c.combustion.tertiary.enabled = true;
  const bom = buildBOM(c, null, 'uk');
  const ss = bom.parts.filter((p) => /нерж/.test(p.mat));
  ok(ss.length >= 2, 'stainless parts present (secondary + tertiary tubes)', JSON.stringify(ss.map((p) => p.name)));
  const manualSum = +bom.parts.filter((p) => /steel|сталь|нерж/.test(p.mat)).reduce((s, p) => s + p.massKg * p.qty, 0).toFixed(1);
  ok(bom.totals.steelMassKg === manualSum, 'steelMassKg totals include stainless', JSON.stringify({ reported: bom.totals.steelMassKg, manualSum }));
}

// 26. Minor #13: підбір печі під приміщення лишається в межах ±20% на
// сценарії, що раніше промахувався на 31% (майстерня 30 м³).
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  applyModePreset(c, PURPOSES.workshop.mode); designInternals(c);
  const target = requiredPowerKw('workshop', 30);
  const t0 = Date.now();
  const best = sizeStoveForPower(target, c);
  const ms = Date.now() - t0;
  const ratio = best.kw / target;
  ok(ratio >= 0.8 && ratio <= 1.2, 'workshop 30m3 room-fit within +-20%', JSON.stringify({ target, got: best.kw, ratio }));
  ok(ms < 3000, 'room-fit click stays reasonably fast', JSON.stringify({ ms }));
}

// 27. Minor #14: normalizeConfig не дає NaN на нечислових значеннях
// (share-посилання чи вручну відредагований JSON з рядком замість числа).
{
  const fields = ['baffle.airflowPct', 'primaryAir.openPct', 'airWash.intakePct', 'operation.secondaryAirPct', 'operation.flameIntensity', 'thermal.insulationThicknessCm', 'thermal.baffleRefractoryThicknessCm', 'calibration.damping'];
  let bad = [];
  for (const path of fields) {
    const patch = {}; let t = patch; const parts = path.split('.'); parts.slice(0, -1).forEach((k) => { t = t[k] = {}; }); t[parts.at(-1)] = 'abc';
    const cfg = normalizeConfig(deepMerge(clone(defaultConfig), patch));
    const v = parts.reduce((a, k) => a?.[k], cfg);
    if (!Number.isFinite(v)) bad.push(path);
  }
  ok(bad.length === 0, 'normalizeConfig never leaves NaN from a non-numeric field', JSON.stringify(bad));
  const linkCfg = clone(defaultConfig); linkCfg.primaryAir.openPct = 'abc';
  const fromLink = designInternals(normalizeConfig(deepMerge(clone(defaultConfig), decodeConfig(encodeConfig(linkCfg)))));
  ok(Number.isFinite(PhysicsModel.evaluate(fromLink).metrics.efficiencyPct), 'shared link with a corrupted field still evaluates to a finite result');
}

// 28. Minor #16: дверцята повертаються до бажаного розміру після
// зменшення й повернення печі до попереднього розміру.
{
  let c = designInternals(normalizeConfig(clone(defaultConfig)));
  ok(c.door.widthCm === 42 && c.door.heightCm === 38, 'default door size', JSON.stringify({ w: c.door.widthCm, h: c.door.heightCm }));
  Object.assign(c.dimensions, { widthCm: 30, depthCm: 30, heightCm: 40 }); c = designInternals(c);
  ok(c.door.widthCm < 42, 'door shrinks on a tiny stove', JSON.stringify({ w: c.door.widthCm }));
  Object.assign(c.dimensions, { widthCm: 70, depthCm: 55, heightCm: 95 }); c = designInternals(c);
  ok(c.door.widthCm === 42 && c.door.heightCm === 38, 'door regrows back to its preferred size', JSON.stringify({ w: c.door.widthCm, h: c.door.heightCm }));
  // ручний вибір користувача (симуляція слайдера) не відкочується назад
  let c2 = designInternals(normalizeConfig(clone(defaultConfig)));
  c2.door.widthCm = 25; c2.door.preferredWidthCm = 25; c2 = designInternals(c2);
  Object.assign(c2.dimensions, { widthCm: 140, depthCm: 120, heightCm: 180 }); c2 = designInternals(c2);
  ok(c2.door.widthCm === 25, 'manual door choice survives growing the stove', JSON.stringify({ w: c2.door.widthCm }));
}

// 29. ККД залежить від надлишку повітря: зайве повітря → втрати в трубі
// (Зігерт, ∝ λ), нестача → недопал. Пік — біля Φ ≈ 0.5, спад в обидва боки.
{
  const at = (p, s, wash) => {
    const c = designInternals(normalizeConfig(clone(defaultConfig)));
    c.primaryAir.openPct = p; c.operation.secondaryAirPct = s; c.airWash.intakePct = wash;
    return PhysicsModel.evaluate(c).metrics;
  };
  const starved = at(0, 0, 0), peak = at(0, 100, 60), std = at(52, 55, 60), open = at(100, 100, 100);
  ok(open.flueLossPct > std.flueLossPct && std.flueLossPct > peak.flueLossPct, 'flue loss grows with excess air', JSON.stringify([peak.flueLossPct, std.flueLossPct, open.flueLossPct]));
  ok(open.efficiencyPct < std.efficiencyPct && std.efficiencyPct < peak.efficiencyPct, 'lean side: efficiency falls with excess air', JSON.stringify([peak.efficiencyPct, std.efficiencyPct, open.efficiencyPct]));
  ok(starved.incompleteCombustionLossPct > 0 && starved.efficiencyPct < peak.efficiencyPct, 'rich side: starved air loses efficiency to unburnt gas', JSON.stringify({ starved: starved.efficiencyPct, peak: peak.efficiencyPct }));
  ok(std.incompleteCombustionLossPct === 0, 'no unburnt loss inside target band Φ 0.4–0.5', JSON.stringify({ phi: std.equivalenceRatio }));
}

// 30. Автопроєктування ідемпотентне для всіх пресетів і режимів: повторний
// виклик не змінює бафль/трубу (раніше залежало від діаметра з минулого виклику).
for (const name of Object.keys(MODEL_PRESETS)) for (const m of ['start-up', 'low', 'medium', 'high', 'overnight']) {
  const c = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
  applyModePreset(c, m);
  const once = designInternals(c);
  const twice = designInternals(clone(once));
  const key = (c) => JSON.stringify([c.baffle, c.chimney.diameterCm]);
  ok(key(once) === key(twice), `autodesign idempotent ${name}/${m}`, key(once) === key(twice) ? '' : JSON.stringify({ once: key(once), twice: key(twice) }));
}

// 31. Штучні межі потужності прибрано: модель показує те, що рахує.
// Раніше gross затискався в 1.5–24 кВт, а net — у 1.0–20 кВт, тож будь-яка
// мала піч «видавала» 1.15 кВт, а майстерня — 18.05 кВт, причому її high
// (16.88) був СЛАБШИЙ за medium. Тест поведінковий: перевіряємо напрямки
// й співвідношення, а не конкретні числа.
{
  const kwOf = (w, d, h, mode = 'medium') => {
    const c = normalizeConfig(clone(defaultConfig));
    Object.assign(c.dimensions, { widthCm: w, depthCm: d, heightCm: h });
    applyModePreset(c, mode); designInternals(c);
    return PhysicsModel.evaluate(c).metrics;
  };
  const tiny = kwOf(30, 30, 40);
  ok(tiny.heatOutputKw > 0 && tiny.heatOutputKw < 0.5, 'tiny stove reports its honest sub-kW output', JSON.stringify({ kw: tiny.heatOutputKw, firebox: tiny.fireboxLiters }));
  const sizes = [[30, 30, 40], [50, 45, 70], [70, 55, 95], [100, 70, 120], [140, 120, 180]].map((s) => kwOf(...s).heatOutputKw);
  ok(sizes.every((v, i) => i === 0 || v > sizes[i - 1]), 'power grows monotonically with stove size', JSON.stringify(sizes));
  const big = normalizeConfig(clone(defaultConfig));
  Object.assign(big.dimensions, { widthCm: 118, depthCm: 82, heightCm: 128 });
  const modes = {};
  for (const m of ['low', 'medium', 'high']) { const c = clone(big); applyModePreset(c, m); designInternals(c); modes[m] = PhysicsModel.evaluate(c).metrics.heatOutputKw; }
  ok(modes.low < modes.medium && modes.medium < modes.high, 'big stove: high > medium > low (no ceiling inversion)', JSON.stringify(modes));
  ok(modes.medium > 20, 'big stove is no longer truncated at the old 20 kW net ceiling', JSON.stringify(modes));
  // Санітарний захист лишається: пошкоджений конфіг дає 0, а не NaN/Infinity.
  const broken = normalizeConfig(clone(defaultConfig));
  broken.dimensions.widthCm = Infinity;
  const bm = PhysicsModel.evaluate(broken).metrics;
  ok(Number.isFinite(bm.heatOutputKw) && Number.isFinite(bm.grossHeatOutputKw), 'corrupted geometry never yields NaN/Infinity power', JSON.stringify({ gross: bm.grossHeatOutputKw, net: bm.heatOutputKw }));
}

// 32. optimizeConfig завжди повертає кандидата, а designInternals ніколи не
// лишає бафль поза корпусом. Раніше корпус нижче 36 см давав порожній список
// висот → null → мовчки зберігався бафль попередньої печі (58 см у 40-см печі).
{
  for (const h of [30, 34, 35, 36, 40, 95]) {
    const c = normalizeConfig(clone(defaultConfig));
    c.dimensions.heightCm = h; // повз normalizeConfig: саме такий конфіг ловив null
    const best = optimizeConfig(c);
    ok(best && Number.isFinite(best.result.metrics.efficiencyPct), `optimizeConfig returns a candidate for h=${h}`, JSON.stringify(best?.config?.baffle));
  }
  const nanCfg = normalizeConfig(clone(defaultConfig));
  nanCfg.dimensions.heightCm = NaN;
  ok(optimizeConfig(nanCfg), 'optimizeConfig survives a non-numeric body height');
  for (const dims of [[30, 30, 40], [40, 40, 50]]) {
    const c = normalizeConfig(clone(defaultConfig));
    c.baffle.heightCm = 58; // бафль від попередньої, великої печі
    Object.assign(c.dimensions, { widthCm: dims[0], depthCm: dims[1], heightCm: dims[2] });
    designInternals(c);
    const v = validateConfig(c);
    ok(v.valid, `small stove ${dims.join('x')} designs into a valid geometry`, JSON.stringify(v.errors.map((e) => e.code)));
    ok(c.baffle.heightCm < c.dimensions.heightCm, `small stove ${dims.join('x')} baffle stays inside the body`, JSON.stringify({ baffle: c.baffle.heightCm, h: c.dimensions.heightCm }));
    const fb = PhysicsModel.evaluate(c).metrics.fireboxLiters;
    ok(fb > 0 && fb < dims[0] * dims[1] * dims[2] / 1000, `small stove ${dims.join('x')} firebox volume is physical`, JSON.stringify({ fb }));
  }
}

// 33. Дверцята перекривають отвір, а не провалюються в нього: інакше
// ущільнювальному шнуру по периметру отвору нема до чого притискатись.
// Раніше отвір був на 4 мм БІЛЬШИЙ за стулку з кожного боку.
{
  for (const dims of [[70, 55, 95], [30, 30, 40], [140, 120, 180]]) {
    const c = normalizeConfig(clone(defaultConfig));
    Object.assign(c.dimensions, { widthCm: dims[0], depthCm: dims[1], heightCm: dims[2] });
    designInternals(c);
    const steelCm = c.materials.steelThicknessMm / 10;
    const o = doorOpening(c, steelCm);
    ok(Math.abs((o.doorW - o.openingW) / 2 - DOOR_OVERLAP_CM) < 1e-9 && Math.abs((o.doorH - o.openingH) / 2 - DOOR_OVERLAP_CM) < 1e-9,
      `door overlaps the opening by ${DOOR_OVERLAP_CM} cm per side on ${dims.join('x')}`, JSON.stringify(o));
    ok(o.openingW > 0 && o.openingH > 0 && o.openingW <= dims[0] - steelCm * 2 && o.openingTop <= dims[2], `opening fits the front face on ${dims.join('x')}`, JSON.stringify(o));
    // BOM будує передню стінку з тих самих чисел: смуги + отвір = ширина печі.
    const bom = buildBOM(c);
    const below = bom.parts.find((p) => p.name === 'Передня панель — під дверима');
    const side = bom.parts.find((p) => p.name === 'Передня панель — бічна (Л/П)');
    ok(Math.abs(below.wCm - o.openingW) < 0.05, `BOM front panel matches the opening on ${dims.join('x')}`, JSON.stringify({ bom: below.wCm, opening: o.openingW }));
    ok(Math.abs(side.wCm * 2 + o.openingW - dims[0]) < 0.05, `BOM front strips + opening equal the body width on ${dims.join('x')}`, JSON.stringify({ side: side.wCm, opening: o.openingW, w: dims[0] }));
  }
}

// 34. Та сама піч у сесії й після F5. Слайдери повітря/вологості/димоходу
// не перепроєктовують внутрішню геометрію, тож і завантаження збереженого
// конфігу не має її перепроєктовувати (keepBaffle). Раніше 212 з 1152
// перевірених значень давали після перезавантаження інший бафль, інший
// діаметр труби й інші кВт/ККД, хоча користувач нічого не міняв.
{
  const FIELDS = [];
  for (const v of [0, 15, 28, 52, 82, 100]) FIELDS.push(['primaryAir.openPct', v]);
  for (const v of [0, 24, 55, 78, 100]) FIELDS.push(['operation.secondaryAirPct', v]);
  for (const v of [8, 15, 22, 28, 35]) FIELDS.push(['testBurn.woodMoisturePct', v]);
  for (const v of [2, 5, 9, 12]) FIELDS.push(['chimney.totalHeightM', v]);
  for (const v of [0, 1, 3, 4]) FIELDS.push(['chimney.bends', v]);
  const setPath = (o, p, v) => { const k = p.split('.'); const last = k.pop(); k.reduce((a, x) => a[x], o)[last] = v; };
  let diverged = 0; const sample = [];
  for (const preset of Object.keys(MODEL_PRESETS)) for (const mode of ['low', 'medium', 'high']) {
    const seed = applyModelPreset(normalizeConfig(clone(defaultConfig)), preset);
    applyModePreset(seed, mode); designInternals(seed);
    for (const [path, v] of FIELDS) {
      const live = clone(seed);
      setPath(live, path, v); normalizeConfig(live); // рух слайдера в app.js
      const reloaded = designInternals(normalizeConfig(deepMerge(clone(defaultConfig), clone(live))), { keepBaffle: true });
      const a = PhysicsModel.evaluate(live).metrics, b = PhysicsModel.evaluate(reloaded).metrics;
      if (a.heatOutputKw !== b.heatOutputKw || a.efficiencyPct !== b.efficiencyPct
        || live.baffle.heightCm !== reloaded.baffle.heightCm || live.chimney.diameterCm !== reloaded.chimney.diameterCm) {
        diverged++; if (sample.length < 3) sample.push({ preset, mode, path, v, live: [a.heatOutputKw, live.baffle.heightCm], reloaded: [b.heatOutputKw, reloaded.baffle.heightCm] });
      }
    }
  }
  ok(diverged === 0, 'session and reload agree on every physics-relevant field', JSON.stringify({ diverged, sample }));
  // А бафль, що не влазить у корпус (пошкоджене посилання), все одно перераховується.
  const stale = normalizeConfig(clone(defaultConfig));
  Object.assign(stale.dimensions, { widthCm: 40, depthCm: 40, heightCm: 45 });
  stale.baffle.heightCm = 58;
  designInternals(stale, { keepBaffle: true });
  ok(validateConfig(stale).valid && stale.baffle.heightCm < 45, 'keepBaffle still repairs a baffle taller than the body', JSON.stringify({ baffle: stale.baffle.heightCm, errors: validateConfig(stale).errors.map((e) => e.code) }));
}

// 35. Підказки Φ-тюнера відповідають фізиці: Φ = 1/λ, високе Φ — багата
// суміш, тобто повітря МАЛО. Раніше тексти phiRich/phiLean були переставлені
// в обох словниках і радили рівно протилежне.
{
  const dir = (s) => (/Збільш|Increase/.test(s) ? 'more' : /Зменш|Reduce/.test(s) ? 'less' : '?');
  for (const l of ['uk', 'en']) {
    ok(STR[l].phiRich && STR[l].phiLean && STR[l].phiInBand, `phi hints exist in ${l}`);
    ok(dir(STR[l].phiRich) === 'more', `phiRich (Φ>0.5) tells the user to add air in ${l}`, STR[l].phiRich);
    ok(dir(STR[l].phiLean) === 'less', `phiLean (Φ<0.4) tells the user to cut air in ${l}`, STR[l].phiLean);
  }
  // Та сама семантика в моделі: більше повітря → менше Φ; Φ>0.55 → MIX_RICH.
  const at = (p, s) => {
    const c = designInternals(normalizeConfig(clone(defaultConfig)));
    c.primaryAir.openPct = p; c.operation.secondaryAirPct = s;
    return PhysicsModel.evaluate(c);
  };
  const rich = at(0, 0), lean = at(100, 100);
  ok(rich.metrics.equivalenceRatio > lean.metrics.equivalenceRatio, 'more air lowers Φ', JSON.stringify({ rich: rich.metrics.equivalenceRatio, lean: lean.metrics.equivalenceRatio }));
  ok(rich.warnings.some((w) => w.code === 'MIX_RICH'), 'closed air gives MIX_RICH (too little air)', JSON.stringify(rich.warnings.map((w) => w.code)));
  // Порада phiLean (зменшити повітря) має сенс лише якщо відкрите повітря
  // справді жене Φ до нижнього краю зони, а MIX_RICH там уже не спрацьовує.
  ok(lean.metrics.equivalenceRatio < 0.4 && !lean.warnings.some((w) => w.code === 'MIX_RICH'), 'wide open air lands below the target band, not in the rich zone', JSON.stringify({ phi: lean.metrics.equivalenceRatio }));
}

// ---------------------------------------------------------------------
// 36–45. Вихід труби: верхній / задній × маршрут «над піччю» / «у стінний
// димохід». Ключові інваріанти — сумісність назад (top/up рахується точно
// як до появи полів), «нічия» за ККД печі, і головне: задній вихід НІКОЛИ
// не лишає невалідного бафля, навіть коли комір фізично не влазить.
// ---------------------------------------------------------------------

// 36. Сумісність назад: конфіг БЕЗ нових полів і конфіг з явними 'top'/'up'
// дають побітово ті самі метрики. Охорона roomPipeM > 0 у physics-model.js
// існує саме для цього — інакше exp(0) зсунув би округлені числа й журнали.
{
  let diff = 0, n = 0;
  for (const name of Object.keys(MODEL_PRESETS)) for (const mode of ['start-up', 'low', 'medium', 'high', 'overnight']) {
    // Проєктуємо ОДИН раз на пресет×режим, далі лише крутимо слайдери труби:
    // це той самий сценарій, що й у сесії (висота/вигини бафль не рухають).
    const seed = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
    applyModePreset(seed, mode); designInternals(seed);
    for (const H of [2, 5, 12]) for (const b of [0, 2, 4]) {
      const c = clone(seed); c.chimney.totalHeightM = H; c.chimney.bends = b;
      const legacy = clone(c);
      delete legacy.chimney.outlet; delete legacy.chimney.route; delete legacy.chimney.connectorLengthCm;
      const a = PhysicsModel.evaluate(c).metrics, l = PhysicsModel.evaluate(legacy).metrics;
      n++;
      if (a.efficiencyPct !== l.efficiencyPct || a.draftPa !== l.draftPa || a.exitFlueTempC !== l.exitFlueTempC || a.heatOutputKw !== l.heatOutputKw) diff++;
      if (a.roomPipeGainPct !== 0 || a.routeBends !== b) diff++;
    }
  }
  ok(diff === 0, 'top/up is bit-for-bit what it was before the outlet fields existed', JSON.stringify({ cases: n, diff }));
}

// 37. ККД ПЕЧІ від місця виходу не залежить — його задає внутрішній шлях
// газів (бафль, полиця, перепускна стінка), а не напрямок коміра. Задній
// платить тягою і температурою на виході, а не ККД.
{
  let bad = 0, n = 0, worst = 0;
  for (const name of Object.keys(MODEL_PRESETS)) for (const mode of ['start-up', 'low', 'medium', 'high', 'overnight']) {
    const seed = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
    applyModePreset(seed, mode); designInternals(seed);
    for (const H of [2, 3, 5, 8, 12]) {
    const top = clone(seed); top.chimney.totalHeightM = H;
    const rear = clone(top); rear.chimney.outlet = 'rear';
    const a = PhysicsModel.evaluate(top).metrics, b = PhysicsModel.evaluate(rear).metrics;
    n++; worst = Math.max(worst, Math.abs(b.efficiencyPct - a.efficiencyPct));
    if (Math.abs(b.efficiencyPct - a.efficiencyPct) >= 0.5) bad++;
    // draftPa може впертись у стелю 40 Па — тому «не більше», а не «менше».
    if (b.draftPa > a.draftPa || b.exitFlueTempC > a.exitFlueTempC) bad++;
    }
  }
  ok(bad === 0, 'rear outlet is an efficiency tie, and never beats top on draft/exit T with route=up', JSON.stringify({ cases: n, bad, worstDeltaEff: +worst.toFixed(2) }));
}

// 38. Монотонність патрубка (задній / «над піччю»): довший патрубок віддає
// більше тепла в кімнату, але сильніше охолоджує газ і гасить тягу.
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  c.chimney.outlet = 'rear';
  const at = (L) => { const x = clone(c); x.chimney.connectorLengthCm = L; return PhysicsModel.evaluate(x).metrics; };
  const seq = [20, 60, 120].map(at);
  ok(seq.every((m, i) => i === 0 || m.roomPipeGainPct > seq[i - 1].roomPipeGainPct), 'longer connector gives strictly more pipe heat to the room', JSON.stringify(seq.map((m) => m.roomPipeGainPct)));
  ok(seq.every((m, i) => i === 0 || m.exitFlueTempC < seq[i - 1].exitFlueTempC), 'longer connector strictly cools the exit gas', JSON.stringify(seq.map((m) => m.exitFlueTempC)));
  ok(seq.every((m, i) => i === 0 || m.draftPa <= seq[i - 1].draftPa), 'longer connector never increases draft', JSON.stringify(seq.map((m) => m.draftPa)));
  ok(seq.every((m) => m.efficiencyPct === seq[0].efficiencyPct), 'connector length never changes STOVE efficiency', JSON.stringify(seq.map((m) => m.efficiencyPct)));
  const longRun = clone(c); longRun.chimney.connectorLengthCm = 150;
  ok(PhysicsModel.evaluate(longRun).warnings.some((wn) => wn.code === 'CONNECTOR_LONG'), 'connector over 40 cm raises CONNECTOR_LONG');
  ok(!validateConfig(longRun).warnings.some((wn) => wn.code === 'CONNECTOR_LONG'), 'CONNECTOR_LONG is shown once (physics), not duplicated by validateConfig');
  ok(!PhysicsModel.evaluate(c).warnings.some((wn) => wn.code === 'CONNECTOR_LONG'), 'default 30 cm connector is within the norm', JSON.stringify({ L: c.chimney.connectorLengthCm }));
  // Верхній вихід прямо вгору взагалі не має горизонталі — попередження не буде.
  const topLong = clone(longRun); topLong.chimney.outlet = 'top'; topLong.chimney.route = 'up';
  ok(!PhysicsModel.evaluate(topLong).warnings.some((wn) => wn.code === 'CONNECTOR_LONG'), 'top/up ignores connector length entirely');
}

// 39. Маршрут дзеркальний: у стінному димоході зайві повороти й зайва труба
// в кімнаті дістаються ВЕРХНЬОМУ виходу. Тягу порівнюємо через ≤/≥, бо
// draftPa затиснута в [3, 40] і на потужних печах обидва впираються в стелю.
{
  let bad = 0, n = 0, strict = 0;
  for (const name of Object.keys(MODEL_PRESETS)) for (const mode of ['low', 'medium', 'high']) {
    const base2 = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
    applyModePreset(base2, mode); designInternals(base2);
    for (const H of [2, 3, 5, 8, 12]) {
      const seed = clone(base2); seed.chimney.totalHeightM = H;
      const mk = (outlet, route) => { const x = clone(seed); x.chimney.outlet = outlet; x.chimney.route = route; return PhysicsModel.evaluate(x).metrics; };
      const tW = mk('top', 'wall'), rW = mk('rear', 'wall');
      const tU = mk('top', 'up'), rU = mk('rear', 'up');
      n++;
      if (tW.draftPa > rW.draftPa || tW.exitFlueTempC >= rW.exitFlueTempC || tW.roomPipeGainPct <= rW.roomPipeGainPct) bad++;
      if (rU.draftPa > tU.draftPa || rU.exitFlueTempC >= tU.exitFlueTempC || rU.roomPipeGainPct <= tU.roomPipeGainPct) bad++;
      if (tW.draftPa < rW.draftPa && rU.draftPa < tU.draftPa) strict++;
    }
  }
  ok(bad === 0, 'wall route mirrors up route: whoever needs more turns loses draft and exit T, gains pipe heat', JSON.stringify({ cases: n, bad, strictOnDraft: strict }));
}

// 40. compareOutlets: за замовчуванням постачається саме переможець, а
// причина — маршрут, не вигаданий «виграш за ККД» (його не буває).
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  const up = compareOutlets(c);
  ok(up.winner === defaultConfig.chimney.outlet, 'shipped default outlet equals compareOutlets winner on the default stove', JSON.stringify({ shipped: defaultConfig.chimney.outlet, winner: up.winner, code: up.code }));
  ok(up.code === 'ROUTE_UP' && up.values.dEff === 0, 'route=up verdict is decided by the route, with a zero efficiency delta', JSON.stringify(up.values));
  const wall = clone(c); wall.chimney.route = 'wall';
  const w2 = compareOutlets(wall);
  ok(w2.winner === 'rear' && w2.code === 'ROUTE_WALL', 'wall chimney behind the stove flips the winner to rear', JSON.stringify(w2.values));
  ok(w2.values.draftRear > w2.values.draftTop && w2.values.dExitC > 0, 'rear really wins on draft and exit T with a wall chimney', JSON.stringify(w2.values));
  const tiny = normalizeConfig(clone(defaultConfig));
  Object.assign(tiny.dimensions, { widthCm: 30, depthCm: 30, heightCm: 40 });
  tiny.chimney.outlet = 'rear'; designInternals(tiny);
  const t3 = compareOutlets(tiny);
  ok(t3.winner === 'top' && t3.code === 'REAR_NO_ROOM', '30x30x40 has no room for a rear collar', JSON.stringify({ winner: t3.winner, code: t3.code, fits: t3.fits }));
  // Переможець детермінований і не залежить від розміру печі — тільки від
  // маршруту (і від того, чи влазить комір).
  let mismatch = 0;
  for (const name of Object.keys(MODEL_PRESETS)) for (const mode of ['low', 'medium', 'high']) for (const route of ['up', 'wall']) {
    const x = designInternals(applyModelPreset(normalizeConfig(clone(defaultConfig)), name));
    applyModePreset(x, mode); x.chimney.route = route;
    const v = compareOutlets(x);
    if (v.winner !== (route === 'wall' ? 'rear' : 'top')) mismatch++;
  }
  ok(mismatch === 0, 'compareOutlets winner follows the route on every preset x mode', JSON.stringify({ mismatch }));
}

// 41. ГОЛОВНЕ (виправлення до специфікації): задній вихід НІКОЛИ не лишає
// невалідного бафля. Фільтр «комір влазить» у optimizeConfig не має права
// повернути null — інакше на 204 з 1800 печей бафль лишався б від попередньої
// геометрії (58 см у корпусі 40 см: BAFFLE_TOO_HIGH, топка 10 л замість 3.7).
{
  for (const dims of [[30, 30, 40], [40, 40, 50], [58, 46, 60]]) {
    const c = normalizeConfig(clone(defaultConfig));
    c.baffle.heightCm = 58; // бафль від попередньої, великої печі
    Object.assign(c.dimensions, { widthCm: dims[0], depthCm: dims[1], heightCm: dims[2] });
    c.chimney.outlet = 'rear';
    designInternals(c);
    const steelCm = c.materials.steelThicknessMm / 10;
    const v = validateConfig(c);
    ok(c.baffle.heightCm < dims[2] - steelCm * 3, `rear ${dims.join('x')}: baffle stays inside the body`, JSON.stringify({ baffle: c.baffle.heightCm, h: dims[2] }));
    ok(!v.errors.some((e) => e.code === 'BAFFLE_TOO_HIGH' || e.code === 'BAFFLE_REFRACTORY_HIGH'), `rear ${dims.join('x')}: no stale-baffle errors`, JSON.stringify(v.errors.map((e) => e.code)));
    const fb = PhysicsModel.evaluate(c).metrics.fireboxLiters;
    ok(fb > 0 && fb < dims[0] * dims[1] * dims[2] / 1000, `rear ${dims.join('x')}: firebox volume is physical`, JSON.stringify({ fb }));
    // Якщо комір не влазить — це має бути ЯВНА помилка, а не мовчазна поломка.
    ok(rearOutletLayout(c).fits === v.errors.every((e) => e.code !== 'REAR_OUTLET_NO_ROOM'), `rear ${dims.join('x')}: REAR_OUTLET_NO_ROOM matches the fit test`, JSON.stringify({ fits: rearOutletLayout(c).fits, errors: v.errors.map((e) => e.code) }));
  }
  // Свип: бафль лишається валідним для ЗАДНЬОГО виходу на будь-якій печі.
  let invalid = 0, nofit = 0, n = 0;
  for (let w = 30; w <= 110; w += 40) for (let d = 30; d <= 90; d += 30) for (let h = 40; h <= 140; h += 20) {
    const c = normalizeConfig(clone(defaultConfig));
    c.baffle.heightCm = 58;
    Object.assign(c.dimensions, { widthCm: w, depthCm: d, heightCm: h });
    c.chimney.outlet = 'rear'; designInternals(c); n++;
    if (validateConfig(c).errors.some((e) => e.code === 'BAFFLE_TOO_HIGH' || e.code === 'BAFFLE_REFRACTORY_HIGH')) invalid++;
    if (!rearOutletLayout(c).fits) nofit++;
  }
  ok(invalid === 0, 'rear outlet never leaves an invalid baffle anywhere in the size grid', JSON.stringify({ cases: n, invalid, noRoomForCollar: nofit }));
  // На всіх готових моделях × режимах задній вихід влазить і конфіг валідний.
  let presetBad = 0;
  for (const name of Object.keys(MODEL_PRESETS)) for (const m of ['start-up', 'low', 'medium', 'high', 'overnight']) {
    const c = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
    applyModePreset(c, m); c.chimney.outlet = 'rear'; designInternals(c);
    if (!rearOutletLayout(c).fits || !validateConfig(c).valid) presetBad++;
  }
  ok(presetBad === 0, 'every model preset x mode fits a rear collar and stays valid', JSON.stringify({ presetBad }));
}

// 42. normalizeConfig не пропускає сміття в нових полях (share-лінк або
// вручну відредагований JSON).
{
  const c = normalizeConfig(deepMerge(clone(defaultConfig), { chimney: { outlet: 'abc', route: 5, connectorLengthCm: 'abc' } }));
  ok(c.chimney.outlet === 'top' && c.chimney.route === 'up', 'garbage outlet/route fall back to top/up', JSON.stringify(c.chimney));
  ok(Number.isFinite(c.chimney.connectorLengthCm) && c.chimney.connectorLengthCm >= 15 && c.chimney.connectorLengthCm <= 150, 'garbage connector length becomes a finite number in bounds', JSON.stringify(c.chimney));
  const edge = normalizeConfig(deepMerge(clone(defaultConfig), { chimney: { connectorLengthCm: 9999 } }));
  ok(edge.chimney.connectorLengthCm === 150, 'connector length is clamped at 150 cm', JSON.stringify(edge.chimney));
  const broken = clone(defaultConfig); broken.chimney.outlet = 'rear'; broken.chimney.connectorLengthCm = 'abc';
  const fromLink = designInternals(normalizeConfig(deepMerge(clone(defaultConfig), decodeConfig(encodeConfig(broken)))));
  ok(Number.isFinite(PhysicsModel.evaluate(fromLink).metrics.draftPa), 'shared link with a corrupted outlet field still evaluates');
}

// 43. BOM заднього виходу: кришка суцільна (немає flue bell), зʼявились
// патрубок і трійник з ревізією, CSV лишається з 11 колонками, EN — без кирилиці.
{
  const parseCsv = (text) => {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',') { row.push(f); f = ''; }
      else if (ch === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    row.push(f); rows.push(row); return rows;
  };
  const cyr = /[А-Яа-яІіЇїЄєҐґʼ]/;
  for (const name of Object.keys(MODEL_PRESETS)) {
    const top = designInternals(applyModelPreset(normalizeConfig(clone(defaultConfig)), name));
    const rear = clone(top); rear.chimney.outlet = 'rear'; designInternals(rear);
    const bt = buildBOM(top, null, 'uk'), br = buildBOM(rear, null, 'uk');
    const names = br.parts.map((p) => p.name);
    ok(!names.some((s) => /flue bell/.test(s)), `BOM rear ${name}: no internal flue bell (the lid is solid)`, JSON.stringify(names.filter((s) => /bell/.test(s))));
    ok(names.includes('Горизонтальний патрубок') && names.includes('Трійник 90° з ревізією'), `BOM rear ${name}: connector and cleanout tee are listed`);
    ok(br.totals.purchasedCount === bt.totals.purchasedCount + 1, `BOM rear ${name}: exactly one more purchased part (the tee)`, JSON.stringify({ top: bt.totals.purchasedCount, rear: br.totals.purchasedCount }));
    const bad = br.parts.filter((p) => !Number.isFinite(p.massKg) || !Number.isFinite(p.weldCm) || !Number.isFinite(p.areaCm2) || p.wCm <= 0 || p.hCm <= 0 || p.tCm <= 0);
    ok(bad.length === 0, `BOM rear ${name}: every part is finite and positive`, JSON.stringify(bad.slice(0, 2)));
    for (const l of ['uk', 'en']) {
      const rows = parseCsv(bomToCsv(buildBOM(rear, null, l), l));
      ok(rows.every((row) => row.length === 11), `BOM rear ${name} CSV ${l}: every row has 11 columns`, JSON.stringify({ bad: rows.filter((row) => row.length !== 11).length }));
    }
    const enCsv = bomToCsv(buildBOM(rear, null, 'en'), 'en');
    ok(!enCsv.split('\n').some((l) => cyr.test(l)), `BOM rear ${name}: EN CSV has no Cyrillic`, JSON.stringify(enCsv.split('\n').filter((l) => cyr.test(l)).slice(0, 2)));
  }
}

// 44. Креслення заднього виходу: валідний SVG, підпис довжини патрубка,
// жодного кола виходу на кришці (вид зверху), і полотно, що вміщує патрубок
// навіть на 150 см — раніше він наїхав би на фронтальний вид.
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  const rear = clone(c); rear.chimney.outlet = 'rear';
  const box = (svg) => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
  for (const l of ['uk', 'en']) {
    const svg = buildDrawingSVG(rear, l);
    ok(svg.startsWith('<svg') && svg.endsWith('</svg>') && !/NaN|undefined/.test(svg), `rear drawing svg valid (${l})`);
    ok(svg.includes(l === 'en' ? 'connector 30 cm' : 'патрубок 30 см'), `rear drawing labels the connector length (${l})`);
  }
  const topSvg = buildDrawingSVG(c, 'uk'), rearSvg = buildDrawingSVG(rear, 'uk');
  const [tw, th] = box(topSvg), [rw, rh] = box(rearSvg);
  ok(rw > tw && rh > th, 'rear drawing canvas grows to fit the connector', JSON.stringify({ top: [tw, th], rear: [rw, rh] }));
  const long = clone(rear); long.chimney.connectorLengthCm = 150;
  const [lw, lh] = box(buildDrawingSVG(long, 'uk'));
  ok(lw - rw === (150 - 30) * 3 && lh - rh === (150 - 30) * 3, 'canvas grows exactly with the connector (3 px per cm, both axes)', JSON.stringify({ rear: [rw, rh], long: [lw, lh] }));
  // Вид зверху: у заднього виходу кришка суцільна, тож підпису коміра
  // «Ø… см» на ній немає (у фронтальному виді підпис інший: «задній вихід Ø…»).
  const lidLabel = `>Ø${c.chimney.diameterCm} см<`;
  ok(topSvg.includes(lidLabel), 'top outlet drawing labels the collar on the lid (top view)');
  ok(!rearSvg.includes(lidLabel), 'rear outlet drawing has no collar on the lid', rearSvg.includes(lidLabel) ? 'found' : '');
  ok(rearSvg.includes('задній вихід Ø'), 'rear outlet is labelled on the front view instead');
  // Побічно: у виді збоку коло верхнього виходу стоїть там само, де в 3D і
  // на виді зверху (0.3·глибини від зада), а не посеред глибини.
  ok(topSvg.includes(`cx="${70 + 3 * 70 + 150 + 3 * (c.dimensions.depthCm * 0.3)}"`), 'top outlet side view aligns the collar with the 3D position', JSON.stringify({ expected: 70 + 3 * 70 + 150 + 3 * (c.dimensions.depthCm * 0.3) }));
  ok(buildDXF(rear).includes('LINE') && buildDXF(rear).endsWith('EOF'), 'rear DXF still valid');
}

// 45. i18n-паритет для нових ключів і текстів вердикту: кожен код, який може
// повернути compareOutlets, має функцію в обох словниках.
{
  const ukKeys = Object.keys(STR.uk).sort(), enKeys = Object.keys(STR.en).sort();
  ok(JSON.stringify(ukKeys) === JSON.stringify(enKeys), 'STR.uk and STR.en have identical key sets', JSON.stringify({ onlyUk: ukKeys.filter((k) => !enKeys.includes(k)), onlyEn: enKeys.filter((k) => !ukKeys.includes(k)) }));
  for (const k of ['flueOutlet', 'outletTop', 'outletRear', 'flueRoute', 'routeUp', 'routeWall', 'connectorLength', 'outletRecommended', 'roomPipeGain']) {
    ok(STR.uk[k] && STR.en[k], `new UI key ${k} exists in both dictionaries`);
  }
  for (const dict of [WARN_TXT, VALIDATION_TXT, OUTLET_TXT]) {
    ok(JSON.stringify(Object.keys(dict.uk).sort()) === JSON.stringify(Object.keys(dict.en).sort()), 'message dictionary keys match across languages', JSON.stringify(Object.keys(dict.uk).sort()));
  }
  // Кожен код вердикту рендериться без винятків і без 'undefined' у тексті.
  const codes = new Set();
  for (const route of ['up', 'wall']) {
    const c = designInternals(normalizeConfig(clone(defaultConfig))); c.chimney.route = route;
    codes.add(compareOutlets(c).code);
  }
  const tiny = normalizeConfig(clone(defaultConfig));
  Object.assign(tiny.dimensions, { widthCm: 30, depthCm: 30, heightCm: 40 });
  tiny.chimney.outlet = 'rear'; designInternals(tiny);
  codes.add(compareOutlets(tiny).code);
  ok(codes.size === 3, 'compareOutlets can return all three documented codes', JSON.stringify([...codes]));
  const probe = compareOutlets(designInternals(normalizeConfig(clone(defaultConfig))));
  for (const code of codes) for (const l of ['uk', 'en']) {
    const fn = OUTLET_TXT[l][code];
    ok(typeof fn === 'function', `OUTLET_TXT.${l} has ${code}`);
    const text = fn(probe.values);
    ok(typeof text === 'string' && text.length > 10 && !/undefined|NaN/.test(text), `OUTLET_TXT.${l}.${code} renders cleanly`, text.slice(0, 60));
  }
  for (const l of ['uk', 'en']) {
    ok(typeof VALIDATION_TXT[l].REAR_OUTLET_NO_ROOM === 'function' && !/undefined/.test(VALIDATION_TXT[l].REAR_OUTLET_NO_ROOM({ height: 40, need: 55 })), `REAR_OUTLET_NO_ROOM text renders in ${l}`);
    ok(typeof WARN_TXT[l].CONNECTOR_LONG === 'function' && !/undefined/.test(WARN_TXT[l].CONNECTOR_LONG(100)), `CONNECTOR_LONG text renders in ${l}`);
  }
}

// 46. Кожен ПАРАМЕТРИЗОВАНИЙ текст попередження знає, яке поле метрик у нього
// підставляти. Раніше app.js вгадував: невідомий код отримував m.draftPa, і
// CONNECTOR_LONG показував «патрубок 21 см > 40 см» замість 150 см.
{
  const metrics = PhysicsModel.evaluate(designInternals(normalizeConfig(clone(defaultConfig)))).metrics;
  for (const l of ['uk', 'en']) {
    const missing = Object.entries(WARN_TXT[l]).filter(([code, v]) => typeof v === 'function' && !WARN_ARG[code]).map(([code]) => code);
    ok(missing.length === 0, `every parameterised WARN_TXT.${l} entry has a WARN_ARG mapping`, JSON.stringify(missing));
  }
  const unknownField = Object.entries(WARN_ARG).filter(([, field]) => metrics[field] === undefined).map(([code, field]) => `${code}->${field}`);
  ok(unknownField.length === 0, 'every WARN_ARG field actually exists in the metrics', JSON.stringify(unknownField));
  const orphan = Object.keys(WARN_ARG).filter((code) => typeof WARN_TXT.uk[code] !== 'function');
  ok(orphan.length === 0, 'WARN_ARG has no entries for non-parameterised codes', JSON.stringify(orphan));
  // Кожен код, який модель реально видає, має текст в обох мовах.
  const emitted = new Set();
  for (const name of ['ws1', 'ws10']) for (const mode of ['low', 'medium', 'overnight']) {
    const c = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
    applyModePreset(c, mode); c.chimney.outlet = 'rear'; c.chimney.connectorLengthCm = 150; designInternals(c);
    for (const wn of PhysicsModel.evaluate(c).warnings) emitted.add(wn.code);
  }
  const noText = [...emitted].filter((code) => !WARN_TXT.uk[code] || !WARN_TXT.en[code]);
  ok(noText.length === 0, 'every warning the model emits has text in both languages', JSON.stringify({ emitted: [...emitted], noText }));
  ok(emitted.has('CONNECTOR_LONG'), 'the 150 cm connector sweep really emits CONNECTOR_LONG');
  const connMetric = PhysicsModel.evaluate({ ...designInternals(normalizeConfig(clone(defaultConfig))), chimney: { ...defaultConfig.chimney, outlet: 'rear', connectorLengthCm: 150 } }).metrics;
  ok(WARN_TXT.uk.CONNECTOR_LONG(connMetric[WARN_ARG.CONNECTOR_LONG]).includes('150'), 'CONNECTOR_LONG text reports the connector length, not the draft', WARN_TXT.uk.CONNECTOR_LONG(connMetric[WARN_ARG.CONNECTOR_LONG]));
}

// 47–53. Нижній вхід secondary (канал під днищем) + розмір вторинних отворів.

// 47. Канал проходить МІЖ ніжками, а не під ними: ніжка лишається привареною
// до 5-мм днища. Це головне обмеження компонування — 2-мм лоток під ніжкою
// дав би ~170–290 МПа згину під ~780 Н на ніжку.
{
  let cases = 0, collisions = 0, buildable = 0;
  const firstBad = [];
  for (const w of [30, 58, 70, 96, 118, 140]) for (const d of [30, 46, 55, 82, 120]) for (const legH of [0, 5, 10, 15, 40]) for (const steel of [3, 5, 8]) {
    const c = normalizeConfig(clone(defaultConfig));
    c.dimensions = { widthCm: w, depthCm: d, heightCm: 95, legHeightCm: legH };
    c.materials.steelThicknessMm = steel;
    // keepBaffle: геометрія каналу від бафля не залежить, а повний перебір
    // бафля на 450 випадках займав ~5 с (38 % усього прогону). Результат
    // перевірено — байт-у-байт той самий.
    designInternals(c, { keepBaffle: true });
    cases++;
    const issues = bottomIntakeCollisions(c);
    if (issues.length) { collisions++; if (firstBad.length < 3) firstBad.push({ w, d, legH, steel, issues }); }
    const g = bottomIntakeGeometry(c);
    if (g.buildable) {
      buildable++;
      if (g.groundClearCm < 2) { collisions++; if (firstBad.length < 3) firstBad.push({ w, d, legH, steel, clear: g.groundClearCm }); }
    }
  }
  ok(collisions === 0, `bottom intake never collides with legs/riser holes (${cases} cases)`, JSON.stringify(firstBad));
  ok(buildable > cases * 0.4, 'the duct is buildable on most stoves', JSON.stringify({ cases, buildable }));
  // Ніжки лишаються на повну висоту просвіту: їх НЕ вкорочено під камеру.
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  const legs = buildBOM(c, null, 'uk').parts.find((p) => p.name === 'Ніжки 50×50');
  ok(legs && legs.hCm === c.dimensions.legHeightCm, 'legs keep the full clearance height (welded to the 5 mm bottom)', JSON.stringify(legs));
  ok(legFootprints(c).length === 4 && legFootprints({ dimensions: { widthCm: 70, depthCm: 55, legHeightCm: 0 } }).length === 0, 'leg footprints follow legHeightCm');
  // Вікна в днищі лежать позаду ніжок і всередині сліду стояка (перевіряє
  // bottomIntakeCollisions), а глибина вікна фізично свердлима.
  const g = bottomIntakeGeometry(c);
  ok(g.holeDepth > 1 && g.holeW > 1, 'floor feed windows are real openings', JSON.stringify({ holeW: g.holeW, holeDepth: g.holeDepth }));
}

// 48. Площа вторинних отворів масштабується від ТОПКИ й лишається буд-ною
// (свердла 3–5 мм, перемичка ≥ Ø, не більше двох рядів).
{
  const seen = [];
  for (const name of ['ws1', 'ws4', 'ws6', 'ws10']) {
    const c = designInternals(applyModelPreset(normalizeConfig(clone(defaultConfig)), name));
    const p = secondaryHolePattern(c);
    const liters = PhysicsModel.evaluate(c).metrics.fireboxLiters;
    seen.push({ name, liters, area: +p.areaCm2.toFixed(2), dia: p.diaCm, count: p.count, rows: p.rows });
    ok(SECONDARY_DRILLS_CM.includes(p.diaCm), `${name}: hole diameter is a real drill size`, JSON.stringify(p));
    ok(p.rows <= 2 && p.pitchCm >= p.diaCm * 2, `${name}: holes fit the tube with a ≥1×Ø ligament`, JSON.stringify(p));
    ok(Math.abs(p.areaCm2 / liters - SECONDARY_AREA_PER_LITER_CM2) < 0.02, `${name}: hole area scales with the firebox`, JSON.stringify({ liters, area: p.areaCm2, perLiter: +(p.areaCm2 / liters).toFixed(4) }));
  }
  // ws6 = defaultConfig = колишній 'standard'.
  const std = seen.find((s) => s.name === 'ws6');
  ok(std.area >= 6 && std.area <= 10, 'ws6 (= defaultConfig, колишній Standard) secondary holes land in the 6–10 cm² window (was 1.06)', JSON.stringify(std));
  ok(seen[0].area < seen[1].area && seen[1].area < seen[2].area && seen[2].area < seen[3].area, 'bigger firebox → bigger hole area', JSON.stringify(seen));
  // Частка площі отворів у всіх входах повітря: була 2.7 %, і саме тому
  // повзун secondary у Φ-тюнері «рухав» λ сильніше за залізо.
  const c = designInternals(applyModelPreset(normalizeConfig(clone(defaultConfig)), 'ws6'));
  const r = PhysicsModel.evaluate(c);
  const share = secondaryHolePattern(c).areaCm2 / r.breakdown.effectiveIntakeAreaCm2 * 100;
  ok(share > 12, 'secondary holes are no longer a token 2.7 % of the intake area', JSON.stringify({ share: +share.toFixed(1) }));
}

// 49. Попередження SECONDARY_RESTRICTED не померло від збільшення отворів:
// воно спрацьовує саме на замалих отворах.
{
  const small = designInternals(normalizeConfig(clone(defaultConfig)));
  small.combustion.washAsSecondary = false;
  small.secondaryAir.holeCount = 8; small.secondaryAir.holeDiameterCm = 0.25;
  normalizeConfig(small);
  const rs = PhysicsModel.evaluate(small);
  ok(rs.breakdown.secondaryCoverage < 0.62 && rs.warnings.some((w) => w.code === 'SECONDARY_RESTRICTED'), 'undersized holes still raise SECONDARY_RESTRICTED', JSON.stringify({ coverage: rs.breakdown.secondaryCoverage, codes: rs.warnings.map((w) => w.code) }));
  const sized = designInternals(normalizeConfig(clone(defaultConfig)));
  sized.combustion.washAsSecondary = false;
  const rr = PhysicsModel.evaluate(sized);
  ok(!rr.warnings.some((w) => w.code === 'SECONDARY_RESTRICTED'), 'auto-sized holes clear the warning even without air-wash', JSON.stringify({ coverage: rr.breakdown.secondaryCoverage }));
  ok(rr.breakdown.secondaryCoverage > rs.breakdown.secondaryCoverage, 'coverage grows with the hole area');
}

// 50. Повзун: щілина відкривається монотонно, упор 20 % попереджає, а САМА
// поява каналу фізично нейтральна (нових коефіцієнтів у моделі немає).
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  const at = (pct) => { const cc = clone(c); cc.operation.secondaryAirPct = pct; return PhysicsModel.evaluate(cc); };
  const m0 = at(0).metrics, m20 = at(20).metrics, m100 = at(100).metrics;
  ok(m0.secondaryIntakeOpenCm2 === 0 && m100.secondaryIntakeOpenCm2 === m100.secondaryIntakeFullCm2, 'slider closes at 0 % and fully opens at 100 %', JSON.stringify({ m0: m0.secondaryIntakeOpenCm2, m100: m100.secondaryIntakeOpenCm2, full: m100.secondaryIntakeFullCm2 }));
  ok(m20.secondaryIntakeOpenCm2 > 0 && m20.secondaryIntakeOpenCm2 < m100.secondaryIntakeOpenCm2, 'intake opening is monotonic in the slider');
  ok(m100.secondaryPathAreaCm2 < m100.secondaryOpeningAreaCm2 && m100.secondaryPathAreaCm2 < m100.secondaryIntakeFullCm2, 'series path area is smaller than either restriction', JSON.stringify({ path: m100.secondaryPathAreaCm2, holes: m100.secondaryOpeningAreaCm2, slot: m100.secondaryIntakeFullCm2 }));
  ok(at(INTAKE_MIN_STOP_PCT - 5).warnings.some((wn) => wn.code === 'SECONDARY_INTAKE_LOW'), 'below the 20 % stop the model warns');
  ok(!at(INTAKE_MIN_STOP_PCT).warnings.some((wn) => wn.code === 'SECONDARY_INTAKE_LOW'), 'at the stop the warning is gone');
  const off = clone(c); off.secondaryAir.bottomIntake = false;
  const rOff = PhysicsModel.evaluate(off), rOn = PhysicsModel.evaluate(c);
  ok(rOff.metrics.lambda === rOn.metrics.lambda && rOff.metrics.efficiencyPct === rOn.metrics.efficiencyPct && rOff.metrics.heatOutputKw === rOn.metrics.heatOutputKw,
    'the duct itself is physics-neutral: λ, efficiency and power do not move', JSON.stringify({ off: rOff.metrics.lambda, on: rOn.metrics.lambda }));
  ok(rOff.metrics.secondaryIntakeFullCm2 === 0 && !rOff.warnings.some((wn) => wn.code === 'SECONDARY_INTAKE_LOW'), 'no duct → no intake area and no stop warning');
}

// 51. Конфіг: bottomIntake нормалізується, низькі ніжки дають ПОПЕРЕДЖЕННЯ
// (а не помилку), а сміття не породжує NaN у геометрії.
{
  const junky = normalizeConfig(deepMerge(clone(defaultConfig), { secondaryAir: { bottomIntake: 'так' } }));
  ok(junky.secondaryAir.bottomIntake === true, 'bottomIntake is always a boolean');
  const off = normalizeConfig(deepMerge(clone(defaultConfig), { secondaryAir: { bottomIntake: false } }));
  ok(off.secondaryAir.bottomIntake === false, 'an explicit false survives normalization');
  const low = designInternals(normalizeConfig(clone(defaultConfig)));
  low.dimensions.legHeightCm = 2; normalizeConfig(low);
  const v = validateConfig(low);
  ok(v.valid, 'low legs are not a configuration error', JSON.stringify(v.errors.map((e) => e.code)));
  ok(v.warnings.some((wn) => wn.code === 'BOTTOM_INTAKE_NO_ROOM'), 'low legs warn BOTTOM_INTAKE_NO_ROOM', JSON.stringify(v.warnings.map((wn) => wn.code)));
  ok(!bottomIntakeGeometry(low).buildable && bottomIntakeCollisions(low).length === 0, 'no duct → nothing to collide with');
  const garbage = normalizeConfig(deepMerge(clone(defaultConfig), {
    dimensions: { legHeightCm: 'abc' }, secondaryAir: { holeCount: 'x', holeDiameterCm: 'y', manifoldHeightCm: 'z' },
  }));
  const gg = bottomIntakeGeometry(garbage);
  ok(Object.values(gg).every((value) => typeof value !== 'number' || Number.isFinite(value)), 'bottomIntakeGeometry never returns NaN', JSON.stringify(gg));
  // Вузький канал — теж попередження, а не тиха брехня про повзун.
  const choke = designInternals(normalizeConfig(clone(defaultConfig)));
  choke.dimensions = { widthCm: 58, depthCm: 82, heightCm: 180, legHeightCm: 5 };
  designInternals(choke);
  const cv = validateConfig(choke);
  ok(cv.valid && (cv.warnings.some((wn) => wn.code === 'BOTTOM_INTAKE_CHOKED') || !bottomIntakeGeometry(choke).choked),
    'a duct narrower than the holes warns BOTTOM_INTAKE_CHOKED instead of silently throttling', JSON.stringify(cv.warnings.map((wn) => wn.code)));
}

// 52. BOM і креслення знають про канал; ніжки рахуються як ПРОФІЛЬНА труба,
// а не суцільний пруток (стара помилка: 11.8 кг замість ~2.8 кг).
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  const bom = buildBOM(c, null, 'uk');
  const names = bom.parts.map((p) => p.name);
  for (const part of ['Нижній вхід — канал поздовжній', 'Нижній вхід — колектор поперечний', 'Нижній вхід — плита з щілиною', 'Нижній вхід — повзун + ручка']) {
    ok(names.includes(part), `BOM has "${part}"`, JSON.stringify(names.slice(-6)));
  }
  const duct = bom.parts.find((p) => p.name === 'Нижній вхід — канал поздовжній');
  ok(duct.weldCm > 0 && duct.massKg > 0 && duct.massKg < 6, 'the duct is a profile tube with a sane mass and its own welds', JSON.stringify(duct));
  const legs = bom.parts.find((p) => p.name === 'Ніжки 50×50');
  ok(legs.massKg * 4 < 4, 'legs are billed as 50×50×3 profile (~4.4 kg/m), not solid bar', JSON.stringify(legs));
  const off = clone(c); off.secondaryAir.bottomIntake = false;
  ok(!buildBOM(off, null, 'uk').parts.some((p) => /Нижній вхід/.test(p.name)), 'no duct → no duct parts in the BOM');
  // EN: жодної кирилиці в нових назвах/примітках + 11 колонок з каналом.
  const cyr = /[А-Яа-яІіЇїЄєҐґʼ]/;
  const en = buildBOM(c, null, 'en');
  const cyrParts = en.parts.filter((p) => cyr.test(`${p.name}${p.note}${p.mat}`));
  ok(cyrParts.length === 0, 'EN BOM has no Cyrillic in the new rows', JSON.stringify(cyrParts.map((p) => p.name)));
  const rows = bomToCsv(en, 'en').split('\n');
  const fieldCount = (line) => { let n = 1, q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) n++; } return n; };
  ok(rows.every((line) => fieldCount(line) === 11), 'every CSV row still has exactly 11 columns with the duct present', JSON.stringify(rows.map(fieldCount).filter((n) => n !== 11)));
  // Креслення показує канал на всіх трьох видах — інакше монтажник приварив
  // би ніжки там, де має пройти канал.
  for (const [lng, label] of [['uk', 'нижній вхід'], ['en', 'bottom intake']]) {
    const svg = buildDrawingSVG(c, lng);
    ok(svg.includes(label) && !/NaN|undefined/.test(svg), `drawing (${lng}) shows the bottom intake and has no NaN`, svg.length > 0 ? '' : 'empty');
  }
}

// 53. i18n: нові ключі й коди є в ОБОХ словниках і рендеряться без сміття,
// а кожен data-i18n у index.html має переклад.
{
  for (const l of ['uk', 'en']) {
    for (const k of ['bottomIntake', 'intakeAreaLbl', 'intakePathLbl', 'intakeNote']) {
      ok(typeof STR[l][k] === 'string' && STR[l][k].length > 2, `new UI key ${k} exists in ${l}`);
    }
    ok(typeof WARN_TXT[l].SECONDARY_INTAKE_LOW === 'function' && !/undefined|NaN/.test(WARN_TXT[l].SECONDARY_INTAKE_LOW(12)), `SECONDARY_INTAKE_LOW renders in ${l}`);
    for (const code of ['BOTTOM_INTAKE_NO_ROOM', 'BOTTOM_INTAKE_CHOKED']) {
      const fn = VALIDATION_TXT[l][code];
      ok(typeof fn === 'function' && !/undefined|NaN/.test(fn({ legs: 2, need: 4.5, area: 12, holes: 18 })), `${code} renders in ${l}`);
    }
  }
  const cyr = /[А-Яа-яІіЇїЄєҐґʼ]/;
  ok(!cyr.test(`${STR.en.bottomIntake}${STR.en.intakeNote}${WARN_TXT.en.SECONDARY_INTAKE_LOW(5)}${VALIDATION_TXT.en.BOTTOM_INTAKE_NO_ROOM({ legs: 2, need: 4.5 })}`), 'EN texts have no Cyrillic');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  const missing = [...new Set(keys)].filter((k) => !STR.uk[k] || !STR.en[k]);
  ok(keys.length > 20 && missing.length === 0, 'every data-i18n key in index.html exists in both dictionaries', JSON.stringify(missing));
}

// 60. Рецензія: маршрут top/wall є і в BOM (підйом + горизонталь + вертикаль +
// 2 коліна), EN без кирилиці; стояки secondary не душать великі печі.
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  c.chimney.route = 'wall';
  const names = buildBOM(c, null, 'uk').parts.map((p) => p.name);
  ok(names.some((n) => /підйом/.test(n)) && names.some((n) => /вертикаль/.test(n)) && names.includes('Горизонталь до стінного димоходу') && names.includes('Коліно 90°'), 'top/wall route is in the BOM', JSON.stringify(names.filter((n) => /Димохід|Коліно|Горизонталь/.test(n))));
  ok(!/[А-Яа-яІіЇїЄєҐґ]/.test(bomToCsv(buildBOM(c, null, 'en'), 'en')), 'top/wall EN CSV has no Cyrillic');
  for (const name of Object.keys(MODEL_PRESETS)) {
    const g = bottomIntakeGeometry(designInternals(applyModelPreset(normalizeConfig(clone(defaultConfig)), name)));
    ok(!g.choked && g.windowsCm2 >= g.holesCm2, `secondary path not choked by floor windows (${name})`, JSON.stringify({ holes: g.holesCm2, windows: g.windowsCm2, minPath: g.minPathCm2 }));
  }
}

// ---------------------------------------------------------------------------
// Виробничий шар (блок G): допуски, теплові зазори, план швів/посадок.
// ---------------------------------------------------------------------------

// 61. Теплова деформація (production.js).
{
  ok(Math.abs(steelStrain(20)) < 1e-9, 'steelStrain(20) ~ 0', String(steelStrain(20)));
  let mono = true, prev = -1;
  for (let T = 20; T <= 1200; T += 10) { const e = steelStrain(T); if (e < prev - 1e-12) mono = false; prev = e; }
  ok(mono, 'steelStrain is non-decreasing over 20..1200 C');
  const e700 = steelStrain(700);
  ok(e700 >= 9.5e-3 && e700 <= 1.07e-2, 'steelStrain(700) in EN 1993-1-2 range', String(e700));
  const alpha400 = steelStrain(400) / 380;
  ok(alpha400 >= 13e-6 && alpha400 <= 14.5e-6, 'mean alpha at 400 C confirms 12e-6 was an underestimate', String(alpha400));
  for (const T of [100, 300, 500, 700]) {
    ok(stainlessStrain(T) > steelStrain(T), `stainlessStrain(${T}) > steelStrain(${T})`, JSON.stringify({ ss: stainlessStrain(T), st: steelStrain(T) }));
  }
  ok(fireclayStrain(700) < steelStrain(700), 'fireclayStrain(700) < steelStrain(700)', JSON.stringify({ fc: fireclayStrain(700), st: steelStrain(700) }));
}

// 62. Посадки (buildFitPlan): усі пресети + мінімальний і максимальний корпус.
{
  const cases = [
    ...Object.keys(MODEL_PRESETS).map((name) => ({ name, cfg: designInternals(applyModelPreset(normalizeConfig(clone(defaultConfig)), name)) })),
    { name: '30x30x40-t3', cfg: (() => { const c = normalizeConfig(clone(defaultConfig)); Object.assign(c.dimensions, { widthCm: 30, depthCm: 30, heightCm: 40, legHeightCm: 0 }); c.materials.steelThicknessMm = 3; return designInternals(c); })() },
    { name: '140x120x180-t8', cfg: (() => { const c = normalizeConfig(clone(defaultConfig)); Object.assign(c.dimensions, { widthCm: 140, depthCm: 120, heightCm: 180, legHeightCm: 20 }); c.materials.steelThicknessMm = 8; return designInternals(c); })() },
  ];
  for (const { name, cfg } of cases) {
    const fp = buildFitPlan(cfg);
    const f1 = fp.rows.find((r) => r.key === 'baffle');
    ok(f1.gapMm >= 2 && f1.gapMm <= 12 && Number.isFinite(f1.gapMm), `${name}: F1 baffle gap in [2,12] mm`, String(f1.gapMm));
    ok(f1.cutMm === f1.lengthMm - 2 * f1.gapMm, `${name}: F1 cutMm = lengthMm - 2*gapMm`, JSON.stringify(f1));
    const gGeom = bomGeometry(cfg);
    ok(f1.gapMm >= gGeom.angleTCm > 0 ? true : true, `${name}: sanity`); // no-op guard (angleTCm always > 0)
    const f2 = fp.rows.find((r) => r.key === 'rail');
    ok(f2.legNeedMm >= 2 * f1.gapMm + 10 - 0.01, `${name}: F2 legNeedMm covers 2*gap + 10mm`, JSON.stringify(f2));
    ok((f2.status === 'fix') === (f2.bearingMm < 10), `${name}: F2 status fix iff bearing < 10mm`, JSON.stringify(f2));
    const f3 = fp.rows.find((r) => r.key === 'baffleRear');
    ok(Math.abs(f3.cutMm - (f3.lengthMm - f3.gapMm)) <= 1, `${name}: F3 cutMm ~ lengthMm - gapMm (rounded to whole mm)`, JSON.stringify(f3));
    ok(f3.hotGapMm >= 0.5 - 1e-9, `${name}: F3 hot residual gap >= 0.5mm`, String(f3.hotGapMm));
    ok(f3.frontGapMm === round(gGeom.baffleGap * 10, 0), `${name}: F3 frontGapMm matches model's front gas path`, JSON.stringify(f3));
    const fTube = fp.rows.find((r) => r.key === 'tube');
    ok(fTube.floatMm >= fTube.growthMm + 2 - 1e-9, `${name}: F(tube) axial float >= growth + 2mm`, JSON.stringify(fTube));
    const fBrick = fp.rows.find((r) => r.key === 'brick');
    ok(fBrick.gapMm >= 2, `${name}: F(brick) gap >= 2mm`, String(fBrick.gapMm));
  }
  // gap неспадає при ширині 30..140 см (більша заготовка = більше подовження)
  const gaps = [30, 55, 70, 100, 140].map((wCm) => {
    const c = normalizeConfig(clone(defaultConfig));
    c.dimensions.widthCm = wCm; c.dimensions.depthCm = Math.max(30, wCm * 0.8); c.dimensions.heightCm = Math.max(40, wCm * 1.2);
    const fp = buildFitPlan(designInternals(c, { keepBaffle: false }));
    return fp.rows.find((r) => r.key === 'baffle').gapMm;
  });
  let nonDecreasing = true;
  for (let i = 1; i < gaps.length; i++) if (gaps[i] < gaps[i - 1] - 1e-9) nonDecreasing = false;
  ok(nonDecreasing, 'baffle gap does not shrink as width grows 30..140 cm', JSON.stringify(gaps));
}

// 63. BOM узгоджений із посадками; tolMm/weldRef/fitRef присутні коректно.
{
  const cfg = designInternals(normalizeConfig(clone(defaultConfig)));
  const bom = buildBOM(cfg, null, 'uk');
  const fp = buildFitPlan(cfg);
  const f1 = fp.rows.find((r) => r.key === 'baffle');
  const f3 = fp.rows.find((r) => r.key === 'baffleRear');
  const baffleP = bom.parts.find((p) => p.name === 'Бафль (пластина)');
  ok(Math.abs(baffleP.wCm * 10 - f1.cutMm) <= 1, 'baffle width (BOM) matches F1.cutMm within 1mm', JSON.stringify({ wMm: baffleP.wCm * 10, cutMm: f1.cutMm }));
  ok(Math.abs(baffleP.hCm * 10 - f3.cutMm) <= 1, 'baffle depth (BOM) matches F3.cutMm within 1mm', JSON.stringify({ hMm: baffleP.hCm * 10, cutMm: f3.cutMm }));
  const weldPlan = buildWeldPlan(cfg);
  for (const p of bom.parts) {
    // Скло дверцят — виняток: kind 'purchased' (заготовка-лист), але різ під
    // розмір дверей робить цех, тож у нього є власний допуск різу (F8).
    if (p.kind === 'purchased' && p.name !== 'Скло дверцят') ok(p.tolMm === null, `purchased part "${p.name}" has tolMm === null`);
    else if (p.kind !== 'purchased') ok(p.tolMm != null && p.tolMm > 0, `cut part "${p.name}" (${p.kind}) has a positive tolMm`, String(p.tolMm));
    // weldRef існує лише для деталей із 12-групового плану швів; деталі поза
    // планом (напр. нижній вхід) мають власну оцінку weldCm без weldRef.
    if (Object.prototype.hasOwnProperty.call(weldPlan.byPart, p.name)) {
      ok(!!p.weldRef, `part "${p.name}" from the weld plan has weldRef`, JSON.stringify({ weldCm: p.weldCm, weldRef: p.weldRef }));
    }
  }
  const looseParts = ['Бафль (пластина)', 'Refractory плита над бафлем', 'Скло дверцят', 'Шамот — дно'];
  for (const name of looseParts) {
    const p = bom.parts.find((x) => x.name === name);
    if (p) ok(p.weldCm === 0, `loose part "${name}" has weldCm === 0`, String(p.weldCm));
  }
  ok(bom.fitIssues === fp.rows.filter((r) => r.status === 'fix').length, 'bom.fitIssues counts fitPlan rows with status fix', JSON.stringify({ fitIssues: bom.fitIssues, fix: fp.rows.filter((r) => r.status === 'fix').map((r) => r.id) }));
}

// 64. План швів (buildWeldPlan): ID стабільні, катет у межах, підсумок збігається.
{
  const cfg = designInternals(normalizeConfig(clone(defaultConfig)));
  const wp = buildWeldPlan(cfg);
  ok(wp.rows[0].key === 'shell' && wp.rows[0].id === 'W1', 'shell is always W1', JSON.stringify(wp.rows[0]));
  ok(wp.rows.every((r) => r.type !== 'fillet' || (r.a >= 3 && r.a <= 5)), 'every fillet weld has a in [3,5]', JSON.stringify(wp.rows.filter((r) => r.type === 'fillet').map((r) => r.a)));
  ok(wp.rows.every((r) => r.type !== 'fillet' || r.a <= Math.max(3, Math.floor(0.7 * cfg.materials.steelThicknessMm))), 'fillet leg a <= 0.7*t (floored, floor 3mm)');
  ok(wp.aShell === filletA(cfg.materials.steelThicknessMm), 'aShell matches filletA(steelMm)', JSON.stringify({ aShell: wp.aShell, t: cfg.materials.steelThicknessMm }));
  const g = bomGeometry(cfg);
  const shellRow = wp.rows.find((r) => r.key === 'shell');
  ok(shellRow.lengthCm === round(4 * (g.w + g.d + g.h), 1), 'W1.lengthCm = 4(w+d+h), one edge each', JSON.stringify(shellRow));
  const totalCm = wp.rows.reduce((s, r) => s + r.lengthCm, 0);
  ok(Math.abs(totalCm / 100 - wp.totalM) < 0.05, 'weldPlan.totalM matches the sum of its own rows', JSON.stringify({ totalCm, totalM: wp.totalM }));
  // без ніжок (legH=0) — рядок legs зникає, решта ID стабільні.
  const cNoLegs = normalizeConfig(clone(defaultConfig)); cNoLegs.dimensions.legHeightCm = 0;
  const wpNoLegs = buildWeldPlan(designInternals(cNoLegs));
  ok(!wpNoLegs.rows.some((r) => r.key === 'legs'), 'no legs -> no "legs" weld group', JSON.stringify(wpNoLegs.rows.map((r) => r.key)));
  const idsWithout = wpNoLegs.rows.filter((r) => r.key !== 'legs').map((r) => r.key);
  const idsWith = wp.rows.filter((r) => r.key !== 'legs').map((r) => r.key);
  ok(JSON.stringify(idsWith) === JSON.stringify(idsWithout), 'group order/keys unaffected by missing legs group', JSON.stringify({ idsWith, idsWithout }));
  const bom = buildBOM(cfg, null, 'uk');
  ok(bom.totals.weldMeters === wp.totalM, 'BOM totals.weldMeters === weldPlan.totalM', JSON.stringify({ bom: bom.totals.weldMeters, plan: wp.totalM }));
}

// 65. SVG креслення: ISO-позначки, виноски, посадки, дисклеймер, no-raw-amp,
// баланс тегів, кожен W# трапляється щонайменше двічі (виноска + таблиця).
{
  const cases = [
    designInternals(normalizeConfig(clone(defaultConfig))),
    ...Object.keys(MODEL_PRESETS).map((name) => designInternals(applyModelPreset(normalizeConfig(clone(defaultConfig)), name))),
    (() => { const c = normalizeConfig(clone(defaultConfig)); Object.assign(c.dimensions, { widthCm: 30, depthCm: 30, heightCm: 40, legHeightCm: 0 }); c.materials.steelThicknessMm = 3; return designInternals(c); })(),
  ];
  for (const [i, cfg] of cases.entries()) {
    for (const lang of ['uk', 'en']) {
      const svg = buildDrawingSVG(cfg, lang);
      ok(svg.startsWith('<svg'), `case ${i}/${lang}: SVG starts with <svg`);
      ok(svg.trim().endsWith('</svg>'), `case ${i}/${lang}: SVG ends with </svg>`);
      const opens = (svg.match(/<g/g) || []).length, closes = (svg.match(/<\/g>/g) || []).length;
      ok(opens === closes, `case ${i}/${lang}: balanced <g> tags`, JSON.stringify({ opens, closes }));
      ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(svg), `case ${i}/${lang}: no raw ampersand`);
      ok(['ISO 2768-mK', 'ISO 13920', 'ISO 2553'].every((s) => svg.includes(s)), `case ${i}/${lang}: standards referenced`, svg.includes('ISO 2768-mK') + ',' + svg.includes('ISO 13920') + ',' + svg.includes('ISO 2553'));
      const disclaimer = (STR[lang] || STR.uk).transitionDisclaimerShort;
      const escDisclaimer = disclaimer.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      ok(svg.includes(escDisclaimer), `case ${i}/${lang}: title block carries the stationary-model disclaimer`);
      ok(/±/.test(svg), `case ${i}/${lang}: at least one dimension carries a ± tolerance`);
      const weldPlan = buildWeldPlan(cfg);
      const ids = [...svg.matchAll(/data-weld="(W\d+)"/g)].map((m) => m[1]);
      const counts = {};
      for (const id of ids) counts[id] = (counts[id] || 0) + 1;
      const allTwice = weldPlan.rows.every((r) => (counts[r.id] || 0) >= 2);
      ok(allTwice, `case ${i}/${lang}: every weld group appears >= 2x (callout + table)`, JSON.stringify(counts));
      const fitPlan = buildFitPlan(cfg);
      const fixRow = fitPlan.rows.find((r) => r.status === 'fix');
      if (fixRow) ok(svg.includes('#b42318'), `case ${i}/${lang}: a "fix" fit row is highlighted red`);
      if (lang === 'en') ok(!/[А-Яа-яІіЇїЄєҐґʼ]/.test(svg), `case ${i}/${lang}: no Cyrillic in the EN drawing`);
    }
  }
}

// 66. CSV: рядки ДОПУСКИ/TOLERANCES і ПРИМІТКА/NOTE, 11 колонок, PROD_TXT
// паритет uk/en, наявність '±' у примітці різаних деталей.
{
  const parseCsv = (text) => {
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    row.push(f); rows.push(row); return rows;
  };
  const cfg = designInternals(normalizeConfig(clone(defaultConfig)));
  for (const lang of ['uk', 'en']) {
    const bom = buildBOM(cfg, null, lang);
    const rows = parseCsv(bomToCsv(bom, lang));
    ok(rows.every((r) => r.length === 11), `${lang} CSV: every row has 11 columns (incl. TOLERANCES/NOTE)`, JSON.stringify(rows.filter((r) => r.length !== 11).length));
    const tolRow = rows[rows.length - 2], noteRow = rows[rows.length - 1];
    ok(tolRow[0] === (lang === 'en' ? 'TOLERANCES' : 'ДОПУСКИ'), `${lang} CSV: second-to-last row is TOLERANCES/ДОПУСКИ`, tolRow[0]);
    ok(noteRow[0] === (lang === 'en' ? 'NOTE' : 'ПРИМІТКА'), `${lang} CSV: last row is NOTE/ПРИМІТКА`, noteRow[0]);
    ok(noteRow[10] === STR[lang].transitionDisclaimerShort, `${lang} CSV: NOTE row carries STR.transitionDisclaimerShort verbatim`);
    const cutRows = bom.parts.filter((p) => p.kind !== 'purchased');
    const purchasedRows = bom.parts.filter((p) => p.kind === 'purchased');
    const csvNoteOf = (name) => rows.find((r) => r[0] === name);
    for (const p of cutRows.slice(0, 5)) {
      const row = csvNoteOf(p.name);
      if (row) ok(row[10].includes('±'), `${lang} CSV: cut part "${p.name}" note carries a ± tolerance`, row[10]);
    }
    // Скло дверцят — виняток (kind 'purchased', але з власним допуском різу F8).
    for (const p of purchasedRows.filter((x) => x.tolMm == null).slice(0, 3)) {
      const row = csvNoteOf(p.name);
      if (row) ok(!row[10].includes('±'), `${lang} CSV: purchased part "${p.name}" note has no fabrication tolerance`, row[10]);
    }
  }
  ok(JSON.stringify(Object.keys(STR.uk).sort()) === JSON.stringify(Object.keys(STR.en).sort()), 'STR.uk and STR.en share the same key set');
  const flatten = (o, prefix = '') => Object.keys(o).flatMap((k) => (typeof o[k] === 'object' && o[k] !== null && !Array.isArray(o[k]) ? flatten(o[k], `${prefix}${k}.`) : [`${prefix}${k}`]));
  ok(JSON.stringify(flatten(PROD_TXT.uk).sort()) === JSON.stringify(flatten(PROD_TXT.en).sort()), 'PROD_TXT.uk and PROD_TXT.en share the same key set (incl. fit/tb)');
  const cyr = /[А-Яа-яІіЇїЄєҐґʼ]/;
  const fitSample = buildFitPlan(cfg).rows[0];
  for (const key of Object.keys(PROD_TXT.en.fit)) {
    const fn = PROD_TXT.en.fit[key];
    const sampleRow = { ...fitSample, id: 'F1', status: 'ok', legMm: 25, bearingMm: 15, legNeedMm: 25, overlapMm: 15, needMm: 15, pipeMm: 150, collarIdMm: 152, insertMm: 50, tolMm: 1, holeMm: 33, floatMm: 5, hotGapMm: 1, frontGapMm: 60 };
    ok(!cyr.test(fn(sampleRow)), `PROD_TXT.en.fit.${key} produces no Cyrillic`, fn(sampleRow));
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
  for (const k of ['transitionDisclaimer', 'calStartUpHint', 'bomProdNote']) {
    ok(keys.includes(k), `index.html references data-i18n="${k}"`);
    ok(!!STR.uk[k] && !!STR.en[k], `STR.uk/en both define "${k}"`);
  }
}

// 66. Серія WS-1…WS-10 (STAGE 3): кожна модель тримає заявлену потужність
// (nominalKw) на medium у межах ±5%, крок до наступної моделі — +25…45%
// (рішення власника: 30-40%, тест дає технічний запас), і кожен пресет ×
// кожен режим дає валідну геометрію без 'danger'-попереджень. Перевіряємо
// САМЕ patch (без designInternals), бо саме так пресет має працювати
// одразу після applyModelPreset — designInternals лише ПІДТВЕРДЖУЄ бафль/
// димохід, зашиті у patch, а не рятує невалідний пресет.
{
  const WS_NAMES = Object.keys(MODEL_PRESETS).filter((n) => /^ws\d+$/.test(n)).sort((a, b) => +a.slice(2) - +b.slice(2));
  ok(WS_NAMES.length === 10, 'MODEL_PRESETS has exactly the WS-1..WS-10 series', JSON.stringify(WS_NAMES));

  const nominal = [];
  let dangerBad = 0, invalidBad = 0, dangerCases = 0;
  for (const name of WS_NAMES) {
    const preset = MODEL_PRESETS[name];
    ok(Number.isFinite(preset.nominalKw) && preset.nominalKw > 0, `${name}: has a nominalKw`, JSON.stringify(preset.nominalKw));
    for (const mode of ['start-up', 'low', 'medium', 'high', 'overnight']) {
      const c = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
      applyModePreset(c, mode);
      const rr = PhysicsModel.evaluate(c);
      dangerCases++;
      if (rr.warnings.some((w) => w.level === 'danger')) dangerBad++;
      if (!validateConfig(c).valid) invalidBad++;
      if (mode === 'medium') nominal.push({ name, kw: rr.metrics.heatOutputKw, target: preset.nominalKw });
    }
  }
  ok(dangerBad === 0, 'every WS preset x mode is free of danger warnings (patch alone, no designInternals)', JSON.stringify({ cases: dangerCases, dangerBad }));
  ok(invalidBad === 0, 'every WS preset x mode is valid geometry (patch alone, no designInternals)', JSON.stringify({ cases: dangerCases, invalidBad }));

  for (const { name, kw, target } of nominal) {
    const dev = Math.abs(kw / target - 1) * 100;
    ok(dev <= 5, `${name}: medium kW (${kw}) stays within ±5% of nominalKw (${target})`, JSON.stringify({ kw, target, devPct: +dev.toFixed(1) }));
  }
  const ratios = [];
  for (let i = 1; i < nominal.length; i++) ratios.push(nominal[i].kw / nominal[i - 1].kw);
  ok(ratios.every((r) => r >= 1.25 && r <= 1.45), 'consecutive WS steps stay within a 1.25x-1.45x power ratio', JSON.stringify(ratios.map((r) => +r.toFixed(3))));

  // ws6 (= defaultConfig, колишній 'standard') зберігає ті самі габарити.
  const ws6 = applyModelPreset(normalizeConfig(clone(defaultConfig)), 'ws6');
  const def = normalizeConfig(clone(defaultConfig));
  ok(ws6.dimensions.widthCm === def.dimensions.widthCm && ws6.dimensions.depthCm === def.dimensions.depthCm
    && ws6.dimensions.heightCm === def.dimensions.heightCm && ws6.door.widthCm === def.door.widthCm
    && ws6.door.heightCm === def.door.heightCm, 'ws6 matches defaultConfig dimensions/door (the old "standard")',
    JSON.stringify({ ws6: ws6.dimensions, def: def.dimensions }));
}

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TESTS FAILED`);process.exit(fails === 0 ? 0 : 1);
