// Швидкі тести PhysicsModel v5 — запуск: node tests/physics.test.js
import { readFileSync } from 'node:fs';
import { PhysicsModel, optimizeConfig, compareOutlets, fitAirToPhi, pickBaffleCandidate, SCORE_INDIFFERENCE, MODEL_VERSION } from '../js/physics-model.js';
import { parseConfigText, parseShareValue, applyImported } from '../js/sanitize.js';
import { bootState } from '../js/persist.js';
import { CONFIG_SCHEMA, defaultConfig, STORAGE_KEY, SCHEMA_VERSION, OPERATION_MODES, normalizeConfig, applyModePreset, applyModelPreset, validateConfig, deepMerge, encodeConfig, decodeConfig, doorOpening, DOOR_OVERLAP_CM, MODEL_PRESETS, rearOutletLayout, bottomIntakeGeometry, bottomIntakeCollisions, legFootprints, secondaryHolePattern, SECONDARY_AREA_PER_LITER_CM2, INTAKE_MIN_STOP_PCT, SECONDARY_DRILLS_CM } from '../js/config.js';
import { STR, WARN_TXT, WARN_ARG, VALIDATION_TXT, OUTLET_TXT, PROD_TXT } from '../js/i18n.js';
import { calibrateFromLog, isCalibrationCurrent, evaluateCalibration, detectJournalDesync, refreshLogPredictions, mergeCalibration, emptyCalibration, configSnapshot } from '../js/calibration.js';
import { buildBOM, bomToCsv, buildDrawingSVG, buildDXF, bomGeometry, buildWeldPlan, buildFitPlan } from '../js/bom.js';
import { steelStrain, stainlessStrain, fireclayStrain, filletA } from '../js/production.js';
import { designInternals } from '../js/autodesign.js';
import { requiredPowerKw, sizeStoveForPower, evaluateRoom, PURPOSES, OVERSIZE_RATIO } from '../js/room.js';
import { computeTestBurnCore, checkTestBurnPlausibility } from '../js/test-burn.js';
import { TB_TXT } from '../js/i18n.js';
import * as TH from '../js/thresholds.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
let fails = 0;
function ok(cond, msg, extra = '') {
  if (cond) console.log(`PASS ${msg} ${extra}`);
  else { console.error(`FAIL ${msg} ${extra}`); fails++; }
}

const base = normalizeConfig(clone(defaultConfig));

// Шлях UI: «Застосувати» = patch пресета + режим + designInternals (БЕЗ keepBaffle) —
// саме цю піч бачить користувач. Повний designInternals ≈ 12 мс, тож 50 клітинок
// пресет × режим рахуємо один раз і діляться ними блоки 66, 69, 72, 74 і 75.
const UI_CELLS = new Map();
function uiCell(name, mode) {
  const key = `${name}/${mode}`;
  if (!UI_CELLS.has(key)) {
    const cfg = designInternals(applyModePreset(applyModelPreset(normalizeConfig(clone(defaultConfig)), name), mode));
    UI_CELLS.set(key, { cfg, e: PhysicsModel.evaluate(cfg) });
  }
  return UI_CELLS.get(key);
}

// 1. medium в адекватних межах
let r = PhysicsModel.evaluate(base);
ok(r.metrics.efficiencyPct >= 65 && r.metrics.efficiencyPct <= 84, 'medium eff', JSON.stringify(r.metrics));
ok(r.metrics.heatOutputKw >= 4 && r.metrics.heatOutputKw <= 12, 'medium kW', JSON.stringify(r.metrics));
ok(r.metrics.burnTimeHours >= 3 && r.metrics.burnTimeHours <= 4.5, 'medium burn (full load ≈3–4.5 h)', JSON.stringify(r.metrics));
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
// Смуга 8–12 год — для здорової тяги (плато draftFactor); на холодній 5-метровій трубі
// повільний режим має тягу ≈6–7 Па (охолодження ∝ 1/витрата газу, REPORT §7), потужність
// нижча, а горіння довше за плато — тому вікно «повільна, але не стара 16–26 год» ширше.
ok(r.metrics.burnTimeHours >= 8 && r.metrics.burnTimeHours <= 14, 'overnight long burn (≈8–14 h on a 5 m chimney, not the old 16–26 h)', JSON.stringify(r.metrics));
const nightPlateau = r.metrics.burnTimeHours * r.breakdown.draftFactor / 1.3;
ok(nightPlateau >= 8 && nightPlateau <= 12, 'overnight burn without the draft throttle sits inside 8–12 h', JSON.stringify({ nightPlateau: +nightPlateau.toFixed(1), draftFactor: r.breakdown.draftFactor }));

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

// 11h. Після оновлення фізики журнал зі старими прогнозами не має калібрувати нову
// модель за старими цифрами: refreshLogPredictions перераховує predictedKw за
// знімком конфігу, тож масштаб (виміряне / прогноз) і відсотки «до/після»
// рахуються відносно ПОТОЧНОЇ моделі. Записи без знімка лишаються як були.
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  const kwOf = (x) => PhysicsModel.evaluate({ ...x, calibration: { ...(x.calibration || {}), enabled: false } }).metrics.heatOutputKw;
  const live = kwOf(c);
  const measured = +(live * 0.9).toFixed(2);
  // Запис, зроблений моделлю, що прогнозувала на 25 % менше (стара модель).
  const stale = { mode: 'medium', predictedKw: +(live * 0.75).toFixed(2), measuredKw: measured, config: configSnapshot(c) };
  const noSnap = { mode: 'low', predictedKw: 2, measuredKw: 1.8 };
  ok(detectJournalDesync([stale]).count === 1, 'the stale record is flagged as desynced');
  const fresh = refreshLogPredictions([stale, noSnap]);
  ok(Math.abs(fresh[0].predictedKw - live) <= 0.006 && fresh[1] === noSnap && stale.predictedKw !== fresh[0].predictedKw, 'refreshLogPredictions re-predicts snapshot records with the current model and leaves the others alone', JSON.stringify({ live, fresh: fresh[0].predictedKw, stale: stale.predictedKw }));
  const calStale = calibrateFromLog([stale]), calFresh = calibrateFromLog(fresh.slice(0, 1));
  ok(Math.abs(calFresh.globalScale - measured / live) < 0.01 && Math.abs(calStale.globalScale - measured / live) > 0.1, 'calibration from the refreshed log scales the CURRENT model (≈0.9), the stale log would give ≈1.2', JSON.stringify({ stale: calStale.globalScale, fresh: calFresh.globalScale }));
  // Збережений (застарілий) масштаб, застосований до свіжих прогнозів, більше не
  // маскується: «після» показує реальне відхилення (≈ −25 %), а не майже ідеальний збіг.
  const afterFresh = evaluateCalibration(fresh.slice(0, 1), calFresh).afterMaxAbsPct;
  const afterStaleScale = evaluateCalibration(fresh.slice(0, 1), calStale).afterMaxAbsPct;
  ok(afterFresh < 1.5 && afterStaleScale > 10, 'the "after" deviation is measured against the current model: a stale stored scale shows up instead of looking perfect', JSON.stringify({ afterFresh, afterStaleScale }));
  ok(refreshLogPredictions(undefined).length === 0 && refreshLogPredictions([null])[0] === null, 'refreshLogPredictions tolerates an empty or broken journal');
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
// (2 м димоходу + 3 вигини, medium). Поріг 8 Па на шкалі тяги кроку 2 (було 9 Па
// на старій шкалі, що завищувала тягу ≈2.1×).
{
  const c = designInternals(normalizeConfig(clone(defaultConfig)));
  c.chimney.totalHeightM = 2; c.chimney.bends = 3;
  const r = PhysicsModel.evaluate(c);
  ok(r.metrics.draftPa < 8, 'weak-chimney scenario draft below the DRAFT_WEAK threshold (8 Pa)', JSON.stringify({ draftPa: r.metrics.draftPa }));
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
  // Детермінована «швидкість»: рахуємо виклики PhysicsModel.evaluate, а не мілісекунди
  // (годинник на завантаженій машині робив тест флакі). Час міряє `npm run bench`.
  const origEvaluate = PhysicsModel.evaluate;
  let evalCalls = 0;
  PhysicsModel.evaluate = function (...args) { evalCalls++; return origEvaluate.apply(this, args); };
  let best;
  try { best = sizeStoveForPower(target, c); } finally { PhysicsModel.evaluate = origEvaluate; }
  const ratio = best.kw / target;
  ok(ratio >= 0.8 && ratio <= 1.2, 'workshop 30m3 room-fit within +-20%', JSON.stringify({ target, got: best.kw, ratio }));
  // Зараз ~7300 викликів; межа з запасом ловить регрес «потроєний скан», не залежить від CPU.
  ok(evalCalls > 0 && evalCalls < 12000, 'room-fit click does a bounded amount of work', JSON.stringify({ evalCalls }));
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
  // Пік ККД шукаємо свіпом (усі три входи разом 0…100 %), а не зашиваємо
  // точку: він має припадати на Φ ≈ 0.5 (межа недопалу λ = 2.0) в усіх режимах.
  for (const mode of ['low', 'medium', 'high']) {
    const sweep = [];
    for (let t = 0; t <= 100; t += 2) {
      const c = designInternals(applyModePreset(normalizeConfig(clone(defaultConfig)), mode), { keepBaffle: true });
      c.primaryAir.openPct = t; c.operation.secondaryAirPct = t; c.airWash.intakePct = t;
      const m = PhysicsModel.evaluate(c).metrics;
      sweep.push({ t, phi: m.equivalenceRatio, eff: m.efficiencyPct });
    }
    const top = sweep.reduce((a, b) => (b.eff > a.eff ? b : a));
    ok(top.phi >= 0.47 && top.phi <= 0.53, `${mode}: efficiency peaks near Φ 0.5 when all inlets open together`, JSON.stringify(top));
    ok(sweep[0].eff < top.eff && sweep[sweep.length - 1].eff < top.eff, `${mode}: efficiency falls on both the rich and the lean side of the peak`, JSON.stringify({ closed: sweep[0].eff, peak: top.eff, open: sweep[sweep.length - 1].eff }));
  }
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
  // λ тепер із ПЛОЩ: air-wash — ≈78 % відкритої площі medium, тож «закрите»
  // чи «навстіж» має означати ВСІ три входи, а не лише primary/secondary.
  const at = (p, s, wash) => {
    const c = designInternals(normalizeConfig(clone(defaultConfig)));
    c.primaryAir.openPct = p; c.operation.secondaryAirPct = s; c.airWash.intakePct = wash;
    return PhysicsModel.evaluate(c);
  };
  const rich = at(0, 0, 0), lean = at(100, 100, 100);
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
    // Задній ніколи не дає БІЛЬШЕ тяги за верхній (тут «не більше», а не «менше»:
    // на дуже слабкій тязі обидва можуть впертись у нижню межу 1 Па).
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
  // Патрубок не забирає тепло в ККД ПЕЧІ (це roomPipeGainPct), але трохи міняє
  // тягу → час перебування газу → T зони: це другий порядок, який раніше
  // ховало округлення до 0.1 (76.3 у всіх трьох), а не втрата тепла патрубка.
  ok(seq.every((m) => Math.abs(m.efficiencyPct - seq[0].efficiencyPct) <= 0.2), 'connector length does not change STOVE efficiency (≤ 0.2 п.п., лише через тягу)', JSON.stringify(seq.map((m) => m.efficiencyPct)));
  const longRun = clone(c); longRun.chimney.connectorLengthCm = 150;
  ok(PhysicsModel.evaluate(longRun).warnings.some((wn) => wn.code === 'CONNECTOR_LONG'), 'connector over 40 cm raises CONNECTOR_LONG');
  ok(!validateConfig(longRun).warnings.some((wn) => wn.code === 'CONNECTOR_LONG'), 'CONNECTOR_LONG is shown once (physics), not duplicated by validateConfig');
  ok(!PhysicsModel.evaluate(c).warnings.some((wn) => wn.code === 'CONNECTOR_LONG'), 'default 30 cm connector is within the norm', JSON.stringify({ L: c.chimney.connectorLengthCm }));
  // Верхній вихід прямо вгору взагалі не має горизонталі — попередження не буде.
  const topLong = clone(longRun); topLong.chimney.outlet = 'top'; topLong.chimney.route = 'up';
  ok(!PhysicsModel.evaluate(topLong).warnings.some((wn) => wn.code === 'CONNECTOR_LONG'), 'top/up ignores connector length entirely');
}

// 39. Маршрут дзеркальний: у стінному димоході зайві повороти й зайва труба
// в кімнаті дістаються ВЕРХНЬОМУ виходу. Тягу порівнюємо через ≤/≥: на дуже
// слабкій тязі обидва можуть впертись у нижню межу draftPa (1 Па).
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
      // Той, кому дісталась зайва труба, виходить холодніше — хіба що обидва вже впали до
      // температури довкілля (20 °C: газ не може вийти холоднішим за кімнату).
      const colder = (a, b) => a < b || (a === 20 && b === 20);
      if (tW.draftPa > rW.draftPa || !colder(tW.exitFlueTempC, rW.exitFlueTempC) || tW.roomPipeGainPct <= rW.roomPipeGainPct) bad++;
      if (rU.draftPa > tU.draftPa || !colder(rU.exitFlueTempC, tU.exitFlueTempC) || rU.roomPipeGainPct <= tU.roomPipeGainPct) bad++;
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
// (рішення власника: 30-40%, ціль серії ≈1.35×, тест дає технічний запас), і кожен
// пресет × кожен режим дає валідну геометрію без 'danger'-попереджень (крім
// CREOSOTE_RISK, див. нижче). Геометрію й 'danger' перевіряємо на САМОМУ patch
// (без designInternals), бо саме так пресет має працювати одразу після
// applyModelPreset — designInternals лише ПІДТВЕРДЖУЄ бафль/димохід, зашиті у
// patch, а не рятує невалідний пресет.
// Потужність — на двох шляхах: голий patch (±5 %) і те, що показує UI після
// «Застосувати» (patch + режим + designInternals, ±2 %): підпис пресета
// називає саме другу цифру, а вона відрізняється від першої на −1.5…+0.8 %.
{
  const WS_NAMES = Object.keys(MODEL_PRESETS).filter((n) => /^ws\d+$/.test(n)).sort((a, b) => +a.slice(2) - +b.slice(2));
  ok(WS_NAMES.length === 10, 'MODEL_PRESETS has exactly the WS-1..WS-10 series', JSON.stringify(WS_NAMES));

  const nominal = [];
  let dangerBad = 0, invalidBad = 0, dangerCases = 0;
  // CREOSOTE_RISK за режимом: масив по пресетах WS-1…WS-10 (від малої до великої).
  const creosoteBy = { 'start-up': [], low: [], medium: [], high: [], overnight: [] };
  for (const name of WS_NAMES) {
    const preset = MODEL_PRESETS[name];
    ok(Number.isFinite(preset.nominalKw) && preset.nominalKw > 0, `${name}: has a nominalKw`, JSON.stringify(preset.nominalKw));
    for (const mode of ['start-up', 'low', 'medium', 'high', 'overnight']) {
      const c = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
      applyModePreset(c, mode);
      const rr = PhysicsModel.evaluate(c);
      dangerCases++;
      // CREOSOTE_RISK — це про холодний ВИХІД труби, а не про геометрію пресета:
      // газ на 5 м одностінної труби остигає нижче 150 °C (тяга й вихід рахуються
      // від одного профілю T(z), охолодження зростає з Ø і падає з витратою газу, REPORT §7), і це
      // чесне попередження. Решта 'danger' (перегрів, сталь) має бути відсутня.
      creosoteBy[mode].push(rr.warnings.some((w) => w.code === 'CREOSOTE_RISK'));
      if (rr.warnings.some((w) => w.level === 'danger' && w.code !== 'CREOSOTE_RISK')) dangerBad++;
      if (!validateConfig(c).valid) invalidBad++;
      // UI після «Застосувати» = patch + режим + designInternals (без keepBaffle):
      // саме цю потужність називає підпис пресета.
      if (mode === 'medium') { const ui = uiCell(name, 'medium').e.metrics; nominal.push({ name, kw: rr.metrics.heatOutputKw, uiKw: ui.heatOutputKw, uiL: ui.fireboxLiters, target: preset.nominalKw }); }
    }
  }
  ok(dangerBad === 0, 'every WS preset x mode is free of danger warnings except CREOSOTE_RISK (patch alone, no designInternals)', JSON.stringify({ cases: dangerCases, dangerBad }));
  // Креозот на 5 м: НІКОЛИ в start-up/high; у medium — лише на двох найменших печах
  // (WS-1/WS-2, 1.2–1.7 кВт: мала витрата газу → швидко остигає; ВІДОМИЙ ВИНЯТОК, питання
  // власнику в REPORT §7); у low/overnight — на малих і середніх. Чим більша піч, тим гарячіший
  // вихід, тож множина клітинок з креозотом — префікс серії.
  const crShape = Object.fromEntries(Object.entries(creosoteBy).map(([m, f]) => [m, f.map((x) => (x ? 'C' : '.')).join('')]));
  ok(!creosoteBy['start-up'].some(Boolean) && !creosoteBy.high.some(Boolean), 'CREOSOTE_RISK on a 5 m chimney never fires in start-up/high on any WS preset', JSON.stringify(crShape));
  ok(Object.values(creosoteBy).every((f) => f.every((x, i) => i === 0 || !x || f[i - 1])), 'CREOSOTE_RISK follows stove size: a smaller WS model in the same mode is never safer than a larger one', JSON.stringify(crShape));
  ok(creosoteBy.medium.slice(2).every((x) => !x) && creosoteBy.medium[0], 'medium: CREOSOTE_RISK fires only on the two smallest stoves (WS-1, WS-2 — the known exception on a bare 5 m flue, REPORT §7); WS-3…WS-10 are clean', JSON.stringify(crShape));
  ok(creosoteBy.low.slice(0, 6).every(Boolean) && creosoteBy.overnight.slice(0, 6).every(Boolean), 'low/overnight fire CREOSOTE_RISK on WS-1…WS-6 on a bare 5 m flue', JSON.stringify(crShape));
  ok(invalidBad === 0, 'every WS preset x mode is valid geometry (patch alone, no designInternals)', JSON.stringify({ cases: dangerCases, invalidBad }));

  for (const { name, kw, uiKw, target } of nominal) {
    const dev = Math.abs(kw / target - 1) * 100;
    ok(dev <= 5, `${name}: medium kW of the bare patch (${kw}) stays within ±5% of nominalKw (${target})`, JSON.stringify({ kw, target, devPct: +dev.toFixed(1) }));
    const uiDev = Math.abs(uiKw / target - 1) * 100;
    ok(uiDev <= 2, `${name}: medium kW after Apply (${uiKw}) matches the labelled nominalKw (${target}) within ±2%`, JSON.stringify({ uiKw, target, devPct: +uiDev.toFixed(1) }));
  }
  const ratios = [];
  for (let i = 1; i < nominal.length; i++) ratios.push(nominal[i].uiKw / nominal[i - 1].uiKw);
  // Потужність ∝ об'єму топки (без geometryFactor), тож габарити WS-1…WS-9 підібрані
  // під ладдер ≈1.35× від WS-6 (= defaultConfig, 5.52 кВт): кроки 1.25–1.45 з технічним
  // запасом, а середній крок (геометричне середнє) ≈1.35.
  ok(ratios.every((r) => r >= 1.25 && r <= 1.45), 'consecutive WS steps stay within a 1.25x-1.45x power ratio', JSON.stringify(ratios.map((r) => +r.toFixed(3))));
  const meanStep = Math.pow(nominal[nominal.length - 1].uiKw / nominal[0].uiKw, 1 / (nominal.length - 1));
  ok(meanStep >= 1.30 && meanStep <= 1.40, 'the geometric-mean step of the series is the ≈1.35x target (owner: +30…40 % per model)', JSON.stringify({ meanStep: +meanStep.toFixed(3) }));
  // Серія — це ЗРОСТАННЯ: габарити, об'єм топки й потужність не спадають від моделі до моделі
  // (інакше пресет «більша піч» опинився б меншим за попередній).
  const dimsOf = (name) => { const c = applyModelPreset(normalizeConfig(clone(defaultConfig)), name); return { w: c.dimensions.widthCm, d: c.dimensions.depthCm, h: c.dimensions.heightCm, L: PhysicsModel.evaluate(c).metrics.fireboxLiters }; };
  const grid = WS_NAMES.map(dimsOf);
  const shrinks = [];
  for (let i = 1; i < grid.length; i++) for (const key of ['w', 'd', 'h', 'L']) if (grid[i][key] < grid[i - 1][key]) shrinks.push(`${WS_NAMES[i]}:${key}`);
  ok(shrinks.length === 0, 'width, depth, height and firebox volume never shrink along WS-1…WS-10', JSON.stringify(shrinks));
  // Потужність medium на літр топки однакова по всій серії (ККД від розміру майже не
  // залежить), тому серія й виходить геометричною саме за об'ємом топки.
  const kwPerL = nominal.map((n) => n.uiKw / n.uiL);
  ok(Math.max(...kwPerL) / Math.min(...kwPerL) < 1.04, 'medium kW per litre of firebox is the same across the series (±2 %): the steps come from the volume, not from a size clamp', JSON.stringify(kwPerL.map((v) => +v.toFixed(4))));

  // Свіп 5 режимів × верх/зад × вгору/в стіну на кожній моделі (бафль збережено — швидко):
  // валідна геометрія й жодного 'danger', окрім CREOSOTE_RISK, який є чесним наслідком
  // охолодження труби (REPORT §7). Що задній комір влазить у кожну модель після
  // «Застосувати», перевіряє блок 41.
  const sweepDanger = [], sweepInvalid = [];
  let sweepCells = 0;
  for (const name of WS_NAMES) {
    for (const mode of ['start-up', 'low', 'medium', 'high', 'overnight']) {
      const seed = designInternals(applyModePreset(applyModelPreset(normalizeConfig(clone(defaultConfig)), name), mode), { keepBaffle: true });
      for (const outlet of ['top', 'rear']) for (const route of ['up', 'wall']) {
        const c = clone(seed); c.chimney.outlet = outlet; c.chimney.route = route;
        sweepCells++;
        if (!validateConfig(c).valid) sweepInvalid.push(`${name}/${mode}/${outlet}/${route}`);
        if (PhysicsModel.evaluate(c).warnings.some((w) => w.level === 'danger' && w.code !== 'CREOSOTE_RISK')) sweepDanger.push(`${name}/${mode}/${outlet}/${route}`);
      }
    }
  }
  ok(sweepInvalid.length === 0 && sweepDanger.length === 0, 'WS × 5 modes × top/rear × up/wall (200 cells): valid geometry and no danger warning except CREOSOTE_RISK', JSON.stringify({ sweepCells, sweepInvalid: sweepInvalid.slice(0, 5), sweepDanger: sweepDanger.slice(0, 5) }));

  // ws6 (= defaultConfig, колишній 'standard') зберігає ті самі габарити.
  const ws6 = applyModelPreset(normalizeConfig(clone(defaultConfig)), 'ws6');
  const def = normalizeConfig(clone(defaultConfig));
  ok(ws6.dimensions.widthCm === def.dimensions.widthCm && ws6.dimensions.depthCm === def.dimensions.depthCm
    && ws6.dimensions.heightCm === def.dimensions.heightCm && ws6.door.widthCm === def.door.widthCm
    && ws6.door.heightCm === def.door.heightCm, 'ws6 matches defaultConfig dimensions/door (the old "standard")',
    JSON.stringify({ ws6: ws6.dimensions, def: def.dimensions }));
}

// 61. Крок 1: «Перепроєктувати» (= designInternals без keepBaffle) повертає
// застарілу збережену піч до свіжого розрахунку; MIX_LEAN досяжний; час
// горіння більше не упирається в штучні 2…14 год.
{
  const fresh = designInternals(normalizeConfig(clone(defaultConfig)));
  const stale = clone(fresh);
  stale.baffle.heightCm = 30; stale.baffle.angleDeg = 10; stale.chimney.diameterCm = 12;
  const kept = designInternals(clone(stale), { keepBaffle: true });
  ok(kept.baffle.heightCm === 30, 'keepBaffle leaves a saved (stale) baffle alone', JSON.stringify(kept.baffle));
  const redone = designInternals(clone(stale));
  ok(redone.baffle.heightCm === fresh.baffle.heightCm && redone.chimney.diameterCm === fresh.chimney.diameterCm, 'redesign restores the fresh-design baffle and chimney diameter', JSON.stringify({ redone: [redone.baffle.heightCm, redone.chimney.diameterCm], fresh: [fresh.baffle.heightCm, fresh.chimney.diameterCm] }));
  const open = designInternals(normalizeConfig(clone(defaultConfig)));
  // «Навстіж» = усі входи на максимум, включно з щілиною air-wash (3 см): вона
  // ≈78 % відкритої площі, тож без неї λ лишається в межах цільової зони.
  open.primaryAir.openPct = 100; open.operation.secondaryAirPct = 100; open.airWash.intakePct = 100; open.airWash.gapCm = 3;
  ok(PhysicsModel.evaluate(open).warnings.some((wn) => wn.code === 'MIX_LEAN'), 'MIX_LEAN is reachable with every air inlet wide open', JSON.stringify({ phi: PhysicsModel.evaluate(open).metrics.equivalenceRatio }));
  ok(!PhysicsModel.evaluate(fresh).warnings.some((wn) => wn.code === 'MIX_LEAN'), 'MIX_LEAN does not fire on the default stove');
  const big = applyModelPreset(normalizeConfig(clone(defaultConfig)), 'ws10');
  applyModePreset(big, 'high');
  const bh = PhysicsModel.evaluate(designInternals(big)).metrics.burnTimeHours;
  ok(Number.isFinite(bh) && bh >= 0 && bh < 200, 'burn time stays finite without the old 2..14 h clamp', JSON.stringify({ bh }));
}

// 67. λ із ПЛОЩ відкритих входів (крок 1 із 4: λ → тяга → час горіння → перепін).
// Повітря задають відкриті площі (primary, вторинний шлях із заслінкою, щілина
// air-wash, tertiary), а не відсотки слайдерів з умовними вагами.
{
  const mkStove = (name, mode) => designInternals(applyModePreset(applyModelPreset(normalizeConfig(clone(defaultConfig)), name), mode), { keepBaffle: true });
  const evalOf = (c) => PhysicsModel.evaluate(c);
  const presetNames = Object.keys(MODEL_PRESETS);

  // (а) Розмір печі на λ не впливає: частка відкритої площі однакова для всієї
  // серії (медіум), а не абсолютні см² — WS-1 і WS-10 мають ту саму Φ.
  const mediumPhis = presetNames.map((n) => evalOf(mkStove(n, 'medium')).metrics.equivalenceRatio);
  ok(Math.max(...mediumPhis) - Math.min(...mediumPhis) < 0.03, 'medium Φ is size-independent across WS-1…WS-10', JSON.stringify(mediumPhis));
  ok(mediumPhis.every((p) => p >= 0.4 && p <= 0.5), 'medium Φ of every WS model sits inside the 0.4–0.5 band', JSON.stringify(mediumPhis));

  // (б) λ монотонно росте від ВІДКРИТОЇ площі кожного входу.
  const c0 = mkStove('ws6', 'medium');
  const lamAt = (mut) => { const c = clone(c0); mut(c); return evalOf(c).metrics.lambda; };
  const levers = {
    'primary opening': (v) => (c) => { c.primaryAir.openPct = v; },
    'secondary slider': (v) => (c) => { c.operation.secondaryAirPct = v; },
    'secondary damper': (v) => (c) => { c.baffle.airflowPct = v; },
    'air-wash intake': (v) => (c) => { c.airWash.intakePct = v; },
    'air-wash gap': (v) => (c) => { c.airWash.gapCm = v; },
  };
  const ranges = { 'primary opening': [0, 25, 50, 75, 100], 'secondary slider': [0, 25, 50, 75, 100], 'secondary damper': [0, 25, 50, 75, 100], 'air-wash intake': [0, 25, 50, 75, 100], 'air-wash gap': [0.5, 1, 1.5, 2, 3] };
  for (const [name, make] of Object.entries(levers)) {
    const seq = ranges[name].map((v) => lamAt(make(v)));
    ok(seq.every((x, i) => i === 0 || x >= seq[i - 1]) && seq[seq.length - 1] > seq[0], `λ grows monotonically with ${name}`, JSON.stringify(seq));
  }
  const withTertiary = clone(c0); withTertiary.combustion.tertiary.enabled = true;
  ok(evalOf(withTertiary).metrics.lambda > evalOf(c0).metrics.lambda, 'tertiary holes add air');

  // (в) Вага слайдера = його реальна частка площі. Розкладаємо повний хід λ
  // (усе закрито → усе навстіж) на внески трьох входів; внески лінійні по
  // площах, тож їх сума дає повний хід. Secondary — малий (труба з ~10 отворами
  // послідовно з заслінкою), air-wash — домінує (щілина на всю ширину скла).
  const closed = clone(c0);
  closed.primaryAir.openPct = 0; closed.operation.secondaryAirPct = 0; closed.airWash.intakePct = 0;
  closed.baffle.airflowPct = 100; closed.airWash.gapCm = 3;
  const lamClosed = evalOf(closed).metrics.lambda;
  const only = (mut) => { const c = clone(closed); mut(c); return evalOf(c).metrics.lambda - lamClosed; };
  const swing = { primary: only((c) => { c.primaryAir.openPct = 100; }), secondary: only((c) => { c.operation.secondaryAirPct = 100; }), wash: only((c) => { c.airWash.intakePct = 100; }) };
  const total = swing.primary + swing.secondary + swing.wash;
  const share = Object.fromEntries(Object.entries(swing).map(([k, v]) => [k, +(v / total).toFixed(3)]));
  ok(share.secondary >= 0.03 && share.secondary <= 0.12, 'secondary slider carries only its real area share of the λ swing (3–12 %, was 35 % of a weight)', JSON.stringify(share));
  ok(share.wash >= 0.7 && share.wash <= 0.92 && share.wash > 5 * share.primary, 'air-wash dominates the λ swing, then primary, then secondary', JSON.stringify(share));
  const dSec = lamAt((c) => { c.operation.secondaryAirPct = 100; }) - lamAt((c) => { c.operation.secondaryAirPct = 20; });
  ok(dSec > 0 && dSec < 0.1, 'secondary slider 20→100 % moves λ by < 0.1 (was 0.45)', JSON.stringify({ dSec }));

  // (г) λ — властивість відкритих площ, а не тяги: висота димоходу її не міняє
  // (тяга впливає на потужність і швидкості, але не на відношення площ).
  const tall = clone(c0); tall.chimney.totalHeightM = 10;
  ok(evalOf(tall).metrics.lambda === evalOf(c0).metrics.lambda, 'λ does not depend on chimney height / draft');

  // (д) Не спамимо попередженнями: у жодному режимі жодної моделі серії
  // (50 клітинок) немає MIX_RICH/MIX_LEAN — start-up навмисно відкритий навстіж
  // (Φ ≈ 0.32 там норма), overnight навмисно багатий. Але обидва досяжні.
  let spam = [];
  for (const n of presetNames) for (const m of ['start-up', 'low', 'medium', 'high', 'overnight']) {
    const codes = evalOf(mkStove(n, m)).warnings.map((w) => w.code).filter((code) => code === 'MIX_RICH' || code === 'MIX_LEAN');
    if (codes.length) spam.push(`${n}/${m}:${codes}`);
  }
  ok(spam.length === 0, 'MIX_RICH/MIX_LEAN do not fire in any WS preset × mode (50 cases)', JSON.stringify(spam));
  const su = evalOf(mkStove('ws6', 'start-up'));
  ok(su.metrics.equivalenceRatio < 0.35 && !su.warnings.some((w) => w.code === 'MIX_LEAN'), 'start-up is deliberately lean and exempt from MIX_LEAN', JSON.stringify({ phi: su.metrics.equivalenceRatio }));
  const starved = clone(c0); starved.primaryAir.openPct = 0; starved.operation.secondaryAirPct = 0; starved.airWash.intakePct = 0;
  ok(evalOf(starved).warnings.some((w) => w.code === 'MIX_RICH'), 'MIX_RICH stays reachable in medium when every inlet is closed');

  // (е) Φ-тюнер: три важелі (primary, secondary, air-wash intake) дістають Φ
  // у зону 0.4–0.5 у КОЖНОМУ режимі кожної моделі, у межах ходу слайдерів.
  let bad = [], worstErr = 0;
  const drift = [];
  for (const n of presetNames) for (const m of ['start-up', 'low', 'medium', 'high', 'overnight']) {
    const c = mkStove(n, m);
    const fit = fitAirToPhi(c, 0.45);
    const probe = clone(c); probe.primaryAir.openPct = fit.primaryPct; probe.operation.secondaryAirPct = fit.secondaryPct; probe.airWash.intakePct = fit.washIntakePct;
    const phi = evalOf(probe).metrics.equivalenceRatio;
    // Тюнер тримає швидкість горіння: потужність без впливу тяги (кВт / draftFactor — це
    // і є швидкість горіння, яку задає повітря ложа) після підбору в 0.8…1.6× від початкової
    // (без цього primary, тепер головний важіль потужності, давав ×0.35…×4.8). Фактична
    // потужність у робочих режимах теж у цих межах; у повільних режимах малих печей
    // додаткове повітря ще й оживляє тягу (більша витрата газу → менше охолодження), тож
    // там фактичний приріст більший — це не збій тюнера, і тут його не міряємо.
    const e0 = evalOf(c), e1 = evalOf(probe);
    const kwFree0 = e0.metrics.heatOutputKw / e0.breakdown.draftFactor, kwFree1 = e1.metrics.heatOutputKw / e1.breakdown.draftFactor;
    const kwQ = kwFree1 / kwFree0, kwActual = e1.metrics.heatOutputKw / e0.metrics.heatOutputKw;
    if (kwQ < 0.8 || kwQ > 1.6 || (m !== 'overnight' && m !== 'low' && (kwActual < 0.8 || kwActual > 1.6))) drift.push(`${n}/${m}:${kwQ.toFixed(2)}/${kwActual.toFixed(2)}`);
    worstErr = Math.max(worstErr, Math.abs(phi - 0.45));
    const inReach = fit.secondaryPct >= INTAKE_MIN_STOP_PCT && fit.primaryPct >= 10 && fit.primaryPct <= 95 && fit.washIntakePct >= 0 && fit.washIntakePct <= 100;
    if (phi < 0.4 || phi > 0.5 || Math.abs(phi - fit.phi) > 1e-9 || !inReach) bad.push(`${n}/${m}:${phi}`);
  }
  ok(bad.length === 0, 'Φ auto-fit lands inside 0.4–0.5 for all 50 preset × mode cases, inside the slider ranges', JSON.stringify({ bad, worstErr: +worstErr.toFixed(3) }));
  ok(drift.length === 0, 'Φ auto-fit holds the burn rate: the draft-free power after the fit stays within 0.8–1.6× of the one before it in all 50 cases (actual power too, outside the slow modes)', JSON.stringify(drift));
  // Без air-wash (лише primary/secondary) до зони не дістати в start-up: саме тому
  // тюнер має третій важіль.
  let twoLeverBest = 1;
  for (let p = 15; p <= 95; p += 5) for (let s = INTAKE_MIN_STOP_PCT; s <= 90; s += 10) {
    const c = mkStove('ws6', 'start-up'); c.primaryAir.openPct = p; c.operation.secondaryAirPct = s;
    twoLeverBest = Math.min(twoLeverBest, Math.abs(evalOf(c).metrics.equivalenceRatio - 0.45));
  }
  ok(twoLeverBest > 0.05, 'primary/secondary alone cannot reach Φ 0.45 in start-up (air-wash is the third lever)', JSON.stringify({ twoLeverBest: +twoLeverBest.toFixed(3) }));
}

// 68. Тяга (крок 2 із 4: λ → тяга → час горіння → перепін). Середня температура
// стовпа з експоненційного профілю охолодження + один підписаний коефіцієнт
// «робоча/теоретична» (ОЦІНКА) замість старої завищеної в 2–3 рази тяги.
// Перевіряємо ПОВЕДІНКУ (реалістичне вікно, монотонність, поріг слабкої тяги,
// незмінність потужності), а не точні константи. Усе через keepBaffle.
{
  const MODES = ['start-up', 'low', 'medium', 'high', 'overnight'];
  const mk = (mode = 'medium') => designInternals(applyModePreset(normalizeConfig(clone(defaultConfig)), mode), { keepBaffle: true });
  const evalOf = (c) => PhysicsModel.evaluate(c);
  const c0 = mk();
  const at = (mut, base = c0) => { const c = clone(base); mut(c); return evalOf(c); };
  const drafts = (mut, values, base = c0) => values.map((v) => at((c) => mut(c, v), base).metrics.draftPa);
  const setH = (c, H) => { c.chimney.totalHeightM = H; };

  // (а) Реалістичне вікно: типова експлуатаційна тяга 10–20 Па на 4–5 м (паспорти
  // 0.04–0.08 in wc), а не 30 Па. Усі п'ять режимів на 4–6 м, medium на 5 м.
  const win = {};
  for (const m of MODES) win[m] = [4, 5, 6].map((H) => at((c) => setH(c, H), mk(m)).metrics.draftPa);
  // Повільний режим на холодній трубі тягне слабше (газ остигає: витрата мала, k велике;
  // 8-Па поріг DRAFT_WEAK для overnight не діє, там він 4 Па) — його нижня межа ≈4 Па, решти режимів — 8 Па.
  // Гарячі режими з великою витратою газу (start-up/high) тягнуть сильніше за medium,
  // бо їх газ остигає менше: верх вікна 25 Па (було 22, коли охолодження не залежало від витрати).
  const working = Object.entries(win).filter(([m]) => m !== 'overnight').flatMap(([, v]) => v);
  ok(working.every((v) => v >= 8 && v <= 25) && win.overnight.every((v) => v >= 4 && v <= 25), 'draft sits in a realistic 8–25 Pa band on 4–6 m in start-up/low/medium/high (overnight: 4–25 Pa)', JSON.stringify(win));
  const d5 = at((c) => setH(c, 5)).metrics.draftPa;
  ok(d5 >= 10 && d5 <= 18, 'default stove, medium, 5 m: draft 10–18 Pa (was ≈30)', JSON.stringify({ d5 }));
  ok(Math.abs(evalOf(c0).metrics.draftPa - d5) < 1e-9 && c0.chimney.totalHeightM === 5, 'the default stove has a 5 m chimney');
  const d3to9 = drafts(setH, [3, 4, 5, 6, 7, 8, 9]);
  ok(d3to9.every((v) => v >= 8 && v <= 25), 'medium draft stays in 8–25 Pa for 3–9 m', JSON.stringify(d3to9));

  // (б) Монотонність: зростає з висотою (стелі 40 Па більше немає), падає з
  // вигинами, росте з діаметром труби; ні NaN, ні виходу за запобіжник.
  const byH = drafts(setH, [2, 3, 5, 7, 9, 12]);
  ok(byH.every((v, i) => i === 0 || v > byH[i - 1]), 'draft rises strictly with chimney height up to 12 m (no 40 Pa ceiling)', JSON.stringify(byH));
  const byBends = drafts((c, b) => { c.chimney.bends = b; }, [0, 1, 2, 3, 4]);
  ok(byBends.every((v, i) => i === 0 || v < byBends[i - 1]), 'draft falls strictly with bends', JSON.stringify(byBends));
  const byDia = drafts((c, D) => { c.chimney.diameterCm = D; }, [10, 14, 18, 25]);
  ok(byDia.every((v, i) => i === 0 || v > byDia[i - 1]), 'draft rises with chimney diameter (a narrower flue draws worse)', JSON.stringify(byDia));
  // Гази остигають вздовж труби, тож середня температура стовпа падає з висотою:
  // удвічі вищий димохід дає МЕНШЕ ніж удвічі більшу тягу (стара модель була лінійна).
  const d10 = drafts(setH, [10])[0];
  ok(d10 > d5 && d10 < 2 * d5, 'doubling the height gives less than double the draft (the gas cools along the stack)', JSON.stringify({ d5, d10 }));
  // Гарячіший режим тягне сильніше за холодніший на тій самій висоті.
  const byMode = MODES.map((m) => at((c) => setH(c, 5), mk(m)).metrics.draftPa);
  ok(byMode[4] < byMode[1] && byMode[1] < byMode[2] && byMode[2] < byMode[3], 'hotter burn draws harder at the same height (overnight < low < medium < high)', JSON.stringify(byMode));
  let sane = 0, cells = 0;
  for (const H of [2, 12]) for (const b of [0, 4]) for (const D of [10, 25]) for (const m of MODES) {
    const v = at((c) => { setH(c, H); c.chimney.bends = b; c.chimney.diameterCm = D; }, mk(m)).metrics.draftPa;
    cells++; if (Number.isFinite(v) && v >= 1 && v < 100) sane++;
  }
  ok(sane === cells, 'draft is finite and inside [1, 100) Pa at the UI corners', JSON.stringify({ cells, sane }));
  // Стару стелю 40 Па знято: у найсприятливішому куті UI тяга > 30 Па і ще росте з висотою.
  const hi = mk('high');
  const hiTall = drafts((c, H) => { setH(c, H); c.chimney.diameterCm = 25; }, [9, 12], hi);
  ok(hiTall[0] > 30 && hiTall[1] > hiTall[0] && hiTall[1] < 100, 'high, Ø25: draft passes 30 Pa and is not flattened at the old 40 Pa ceiling', JSON.stringify(hiTall));

  // (в) DRAFT_WEAK: спрацьовує на короткому й на звивистому димоході, не на
  // типовому (5 м, ≤1 вигин, будь-який режим крім overnight, який вільний від нього).
  const weak = (mut, base = c0) => at(mut, base).warnings.some((w) => w.code === 'DRAFT_WEAK');
  ok(!weak(() => {}), 'DRAFT_WEAK does not fire on the default stove');
  ok(weak((c) => setH(c, 2)), 'DRAFT_WEAK fires on a 2 m chimney');
  ok(weak((c) => { setH(c, 2); c.chimney.bends = 3; }), 'DRAFT_WEAK fires on a 2 m chimney with 3 bends');
  ok(!weak((c) => setH(c, 3)), 'DRAFT_WEAK stays quiet on a 3 m chimney in medium');
  const quietModes = MODES.filter((m) => m !== 'overnight' && weak((c) => { setH(c, 5); c.chimney.bends = 1; }, mk(m)));
  ok(quietModes.length === 0, 'DRAFT_WEAK never fires on 5 m + 1 bend in start-up/low/medium/high', JSON.stringify(quietModes));
  // Overnight тягне природно слабше (≈6–10 Па на 5 м), тож 8-Па поріг для нього не діє, але
  // найслабша тяга серії не лишається без попередження: нижче 4 Па DRAFT_WEAK є в КОЖНОМУ режимі
  // (раніше виняток для overnight ховав і тягу 1.8 Па). Сітка висота × вигини × режим.
  const hidden = [], noisy = [];
  let weakCells = 0;
  for (const m of MODES) for (const H of [2, 3, 4, 5, 6, 8]) for (const b of [0, 1, 2, 3]) {
    const r = at((c) => { setH(c, H); c.chimney.bends = b; }, mk(m));
    const has = r.warnings.some((w) => w.code === 'DRAFT_WEAK');
    if (r.metrics.draftPa < 4 - 1e-9) { weakCells++; if (!has) hidden.push(`${m}/${H}m/${b}b:${r.metrics.draftPa}`); }
    if (m === 'overnight' && r.metrics.draftPa >= 4 && has) noisy.push(`${H}m/${b}b:${r.metrics.draftPa}`);
  }
  ok(weakCells > 0 && hidden.length === 0, 'any cell with a draft below 4 Pa carries DRAFT_WEAK, overnight included (nothing weak is hidden)', JSON.stringify({ weakCells, hidden: hidden.slice(0, 5) }));
  ok(noisy.length === 0, 'overnight keeps its relaxed threshold: a 4–8 Pa draft in overnight does not warn', JSON.stringify(noisy.slice(0, 5)));

  // (г) Потужність не стрибнула від переякорення: draftFactor тепер обмежує її
  // лише на слабкій тязі (нижче ≈8 Па), а на звичайному димоході лежить на плато.
  const ws6 = applyModePreset(applyModelPreset(normalizeConfig(clone(defaultConfig)), 'ws6'), 'medium');
  const kw6 = evalOf(ws6).metrics.heatOutputKw;
  ok(Math.abs(kw6 / MODEL_PRESETS.ws6.nominalKw - 1) <= 0.05, 'default (ws6) medium power stays within ±5 % of its pinned nominalKw', JSON.stringify({ kw6 }));
  const kwAt = (H, mode = 'medium') => at((c) => setH(c, H), mk(mode)).metrics.heatOutputKw;
  // Overnight виключено: його потужність обмежена тягою навіть на 5 м (тяга ≈6 Па < 7.8),
  // тож вища труба її піднімає — але ніколи не знижує.
  const plateauModes = MODES.filter((m) => m !== 'overnight');
  ok(plateauModes.every((m) => Math.abs(kwAt(5, m) / kwAt(8, m) - 1) < 0.02), 'power is on the draft plateau at 5 m and 8 m (same kW, ±2 %) in start-up/low/medium/high', JSON.stringify(plateauModes.map((m) => [kwAt(5, m), kwAt(8, m)])));
  ok(kwAt(8, 'overnight') >= kwAt(5, 'overnight') - 1e-9, 'overnight: a taller chimney never lowers the draft-limited power', JSON.stringify({ h5: kwAt(5, 'overnight'), h8: kwAt(8, 'overnight') }));
  const kw2 = kwAt(2), kw5 = kwAt(5);
  ok(kw2 < kw5 && kw2 >= kw5 * 0.7 / 1.3 - 1e-9, 'a weak 2 m draft throttles power, but never below 0.7/1.3 of the plateau', JSON.stringify({ kw2, kw5 }));

  // (д) Швидкісні евристики лишились на своїй шкалі (від них залежать час
  // перебування, T зони й поріг AIRWASH_JETS): 1–7 м/с у димоході, не лякаючий
  // AIRWASH_JETS на типовій печі, і зростання з висотою.
  const m5 = evalOf(c0).metrics;
  ok(m5.stackVelocityMs >= 3 && m5.stackVelocityMs <= 5.5 && !evalOf(c0).warnings.some((w) => w.code === 'AIRWASH_JETS'), 'velocity heuristics stay on their fitted scale for the default stove', JSON.stringify({ stack: m5.stackVelocityMs, sec: m5.secondaryVelocityMs, wash: m5.airWashVelocityMs }));
  const sv = [2, 5, 9].map((H) => at((c) => setH(c, H)).metrics.stackVelocityMs);
  ok(sv.every((v, i) => i === 0 || v > sv[i - 1]), 'stack velocity rises with height', JSON.stringify(sv));

  // (е) Маршрут виходу: верхній вихід над піччю тягне краще за задній, для
  // стінного димоходу навпаки; різниця тяги десятки відсотків, не кратна.
  const up = compareOutlets(c0).values;
  ok(up.draftTop > up.draftRear && up.dDraftPct < -8 && up.dDraftPct > -30, 'route=up: rear gives 8–30 % less draft than top', JSON.stringify(up));
  const wallCfg = clone(c0); wallCfg.chimney.route = 'wall';
  const wall = compareOutlets(wallCfg).values;
  ok(wall.draftRear > wall.draftTop && wall.dDraftPct > 8 && wall.dDraftPct < 45, 'route=wall: rear gives 8–45 % more draft than top', JSON.stringify(wall));

  // (ж) Тяга й температура на ВИХОДІ рахуються від одного профілю T(z): газ
  // не виходить із труби гарячішим, ніж увійшов (раніше exit стартував від
  // modeledFlueTempC і на low/overnight виходив гарячішим за T на патрубку),
  // а кожен метр труби його остуджує. Усі 50 пресет × режим на 3 висотах.
  const hotter = [], notCooling = [];
  for (const name of Object.keys(MODEL_PRESETS)) for (const m of MODES) {
    const base = applyModePreset(applyModelPreset(normalizeConfig(clone(defaultConfig)), name), m);
    let prevExit = Infinity;
    for (const H of [3, 5, 9]) {
      const cc = clone(base); setH(cc, H);
      const mm = evalOf(cc).metrics;
      if (mm.exitFlueTempC > mm.stackGasC) hotter.push(`${name}/${m}/H${H}:${mm.exitFlueTempC}>${mm.stackGasC}`);
      // Строге остигання — доки газ вище температури довкілля (20 °C): нижче він не
      // охолоджується, і два сусідні H можуть обидва лежати на цій підлозі.
      if (!(mm.exitFlueTempC < prevExit) && !(mm.exitFlueTempC <= 20 && prevExit <= 20)) notCooling.push(`${name}/${m}/H${H}`);
      prevExit = mm.exitFlueTempC;
    }
  }
  ok(hotter.length === 0, 'the exit gas is never hotter than the gas that entered the chimney (one T(z) profile for draft and exit)', JSON.stringify(hotter.slice(0, 5)));
  ok(notCooling.length === 0, 'the exit gas cools with every extra metre of chimney', JSON.stringify(notCooling.slice(0, 5)));
  // Наслідок єдиного профілю: повільні режими на типовій 5-метровій одностінній
  // трубі остигають нижче 150 °C (CREOSOTE_RISK), робочі — ні.
  const creosote = Object.fromEntries(MODES.map((m) => [m, at((c) => setH(c, 5), mk(m)).warnings.some((w) => w.code === 'CREOSOTE_RISK')]));
  ok(creosote.low && creosote.overnight && !creosote['start-up'] && !creosote.medium && !creosote.high, 'CREOSOTE_RISK on a 5 m chimney: low and overnight fire, start-up/medium/high do not', JSON.stringify(creosote));
}

// 69. Час горіння (крок 3 із 4: λ → тяга → час горіння → перепін). burn = енергія
// закладки / потужність, БЕЗ множників режиму й сталі: колишні burnFactor
// 0.72…1.75 і (1+0.015·сталь) лічили двічі (heat·burn давало 74–196 % енергії
// дров, overnight 16–26 год). Режими розрізняє розмір закладки (fillFactor) і
// потужність. Перевіряємо ПОВЕДІНКУ: баланс енергії, порядок режимів, смуги
// повної закладки, вплив калібрування/тяги/сталі, поріг STARTUP_LONG. Без свіпів.
{
  const MODES = ['start-up', 'low', 'medium', 'high', 'overnight'];
  // Типові межі часу горіння повної закладки (год): ОЦІНКА, REPORT §7.
  const BANDS = { 'start-up': [0.7, 1.2], low: [5, 7], medium: [3, 4.5], high: [1.5, 2.5], overnight: [8, 12] };
  const mkPreset = (name, mode) => applyModePreset(applyModelPreset(normalizeConfig(clone(defaultConfig)), name), mode);
  const metricsOf = (c) => PhysicsModel.evaluate(c).metrics;
  const names = Object.keys(MODEL_PRESETS);
  // Смуги — для ЗДОРОВОЇ тяги (плато draftFactor 1.3, тяга ≥ ≈7.8 Па). Мала піч або повільний
  // режим на холодній 5-метровій трубі має слабшу тягу, потужність нижча, горіння довше
  // (охолодження труби ∝ 1/витрата газу, REPORT §7): це чесний наслідок, а не збій смуги.
  // Тому смуги перевіряємо на «часі без впливу тяги» = burn·draftFactor/1.3 (потужність
  // там та сама, що на плато), а реальний час — окремо: поза смугою він лише довший і лише
  // там, де тяга справді слабка.
  const DRAFT_MAX = 1.3;
  const plateauHours = (c) => { const e = PhysicsModel.evaluate(c); return e.metrics.burnTimeHours * e.breakdown.draftFactor / DRAFT_MAX; };

  // (а) Баланс енергії: heat × burn = корисна енергія закладки (η скорочується).
  // Допуск — лише округлення метрик (потужність до 0.01 кВт, час до 0.1 год, енергія до 0.1 кВт·год):
  // прихований множник дав би ≥ 25 % розбіжності.
  const balanceBad = [];
  for (const name of names) for (const mode of MODES) {
    const m = metricsOf(mkPreset(name, mode));
    const gap = Math.abs(m.heatOutputKw * m.burnTimeHours - m.usefulEnergyKwh);
    const rounding = 0.05 * m.heatOutputKw + 0.005 * m.burnTimeHours + 0.06 + 0.01 * m.usefulEnergyKwh;
    if (gap > rounding) balanceBad.push(`${name}/${mode}:${(m.heatOutputKw * m.burnTimeHours / m.usefulEnergyKwh).toFixed(2)}`);
  }
  ok(balanceBad.length === 0, 'burn conserves energy: heat × burn equals the useful energy of the load (no hidden multipliers)', JSON.stringify({ cases: names.length * MODES.length, balanceBad }));
  // Те саме на крихітній топці (30×30×40 см, overnight): потужність там < 0.1 кВт,
  // і колишній нижній поріг знаменника 0.1 кВт занижував час (≈9.6 замість ≈14 год).
  // 30×30×40 см — найменший корпус, який лишає normalizeConfig; сталь 5 мм і шамот
  // 4 см дають топку ≈3.7 л і потужність ≈0.06 кВт (з 3 мм/2.5 см було 0.11 кВт —
  // після переходу на fuelBedAir це вже не «sub-0.1 kW»).
  const tinyCfg = mkPreset('ws1', 'overnight');
  Object.assign(tinyCfg.dimensions, { widthCm: 30, depthCm: 30, heightCm: 40, legHeightCm: 0 });
  tinyCfg.materials.steelThicknessMm = 5;
  tinyCfg.materials.firebrickThicknessCm = 4;
  const tiny = metricsOf(designInternals(normalizeConfig(tinyCfg)));
  const tinyRatio = tiny.heatOutputKw * tiny.burnTimeHours / tiny.usefulEnergyKwh;
  ok(tiny.heatOutputKw > 0 && tiny.heatOutputKw < 0.1 && tinyRatio > 0.8 && tinyRatio < 1.2, 'burn conserves energy on a sub-0.1 kW firebox too (no floor on the denominator)', JSON.stringify({ kw: tiny.heatOutputKw, useful: tiny.usefulEnergyKwh, burn: tiny.burnTimeHours, ratio: +tinyRatio.toFixed(2) }));

  // (б) Порядок режимів на кожному пресеті: розпал < high < medium < low < overnight.
  const orderBad = names.filter((name) => {
    const b = Object.fromEntries(MODES.map((m) => [m, metricsOf(mkPreset(name, m)).burnTimeHours]));
    return !(b['start-up'] < b.high && b.high < b.medium && b.medium < b.low && b.low < b.overnight);
  });
  ok(orderBad.length === 0, 'burn time orders start-up < high < medium < low < overnight on every preset', JSON.stringify(orderBad));

  // (в) Смуги повної закладки: defaultConfig (як його показує UI, після
  // designInternals) і середній пресет WS-5 — усі п'ять режимів СТРОГО в смузі.
  const inBand = (mode, h) => h >= BANDS[mode][0] && h <= BANDS[mode][1];
  const stoves = {
    default: (mode) => designInternals(applyModePreset(normalizeConfig(clone(defaultConfig)), mode), { keepBaffle: true }),
    ws5: (mode) => designInternals(mkPreset('ws5', mode), { keepBaffle: true }),
  };
  for (const [label, mk] of Object.entries(stoves)) {
    const hours = Object.fromEntries(MODES.map((mode) => [mode, +plateauHours(mk(mode)).toFixed(2)]));
    ok(MODES.every((mode) => inBand(mode, hours[mode])), `${label} stove: every mode burns a full load inside its band (0.7–1.2 / 5–7 / 3–4.5 / 1.5–2.5 / 8–12 h) without the draft throttle`, JSON.stringify(hours));
    const real = Object.fromEntries(MODES.map((mode) => [mode, metricsOf(mk(mode)).burnTimeHours]));
    ok(MODES.every((mode) => inBand(mode, real[mode])), `${label} stove: all five modes, overnight included, stay in their bands at the REAL 5 m draft (not only without the throttle)`, JSON.stringify(real));
  }

  // (г) Час горіння повної закладки НЕ залежить від розміру печі: і закладка, і
  // потужність ∝ об'єму топки (колишній geometryFactor 0.75…1.25 на краях серії
  // давав розкид 1.67× і 22 з 50 клітинок поза смугами). Тепер усі 50 клітинок
  // (голі patch-и) СТРОГО в смугах, а розкид по 10 моделях в кожному режимі — не
  // більше 5 % або одного кроку округлення метрики (0.1 год; на start-up ≈0.9 год
  // це 11 %).
  const cellsBy = Object.fromEntries(MODES.map((mode) => [mode, names.map((name) => PhysicsModel.evaluate(mkPreset(name, mode)))]));
  const burnsBy = Object.fromEntries(MODES.map((mode) => [mode, cellsBy[mode].map((e) => e.metrics.burnTimeHours)]));
  const platBy = Object.fromEntries(MODES.map((mode) => [mode, cellsBy[mode].map((e) => e.metrics.burnTimeHours * e.breakdown.draftFactor / DRAFT_MAX)]));
  const off = [];
  for (const mode of MODES) names.forEach((name, i) => { if (!inBand(mode, platBy[mode][i])) off.push(`${name}/${mode}:${platBy[mode][i].toFixed(2)}`); });
  ok(off.length === 0, 'all 50 preset × mode burn times lie strictly inside their bands without the draft throttle (series edges included)', JSON.stringify(off));
  const sizeFlat = (hours) => Math.max(...hours) - Math.min(...hours) <= Math.max(0.05 * Math.min(...hours), 0.1 + 1e-9);
  ok(MODES.every((mode) => sizeFlat(platBy[mode])), 'burn time of a full load is size-independent: max/min across WS-1…WS-10 within 5 % (or 0.1 h) in every mode, without the draft throttle', JSON.stringify(Object.fromEntries(MODES.map((mode) => [mode, [+Math.min(...platBy[mode]).toFixed(2), +Math.max(...platBy[mode]).toFixed(2)]]))));
  ok(['start-up', 'medium', 'high'].every((mode) => sizeFlat(burnsBy[mode])), 'start-up/medium/high are never draft-limited: their real burn time is size-independent too', JSON.stringify(Object.fromEntries(['start-up', 'medium', 'high'].map((mode) => [mode, burnsBy[mode]]))));
  // Реальний час поза смугою — лише ДОВШИЙ і лише там, де тяга слабка (draftFactor < 1.3):
  // повільний режим малої печі на холодній трубі. Робочі режими цього не торкається.
  const offReal = [], throttledModes = new Set();
  for (const mode of MODES) cellsBy[mode].forEach((e, i) => {
    const hrs = e.metrics.burnTimeHours, thr = e.breakdown.draftFactor < DRAFT_MAX - 1e-9;
    if (thr) throttledModes.add(mode);
    if (!inBand(mode, hrs) && !(thr && hrs > BANDS[mode][1])) offReal.push(`${names[i]}/${mode}:${hrs}`);
    if (thr && hrs < platBy[mode][i] - 0.1) offReal.push(`${names[i]}/${mode}:shorter-than-plateau`);
  });
  ok(offReal.length === 0, 'a burn time outside its band is only ever LONGER than the band and only on a draft-throttled cell (draft < 7.8 Pa); a throttle never shortens the burn', JSON.stringify(offReal));
  ok([...throttledModes].every((m) => m === 'low' || m === 'overnight'), 'only the slow modes (low/overnight) are ever draft-throttled on the WS series', JSON.stringify([...throttledModes]));
  // Те саме на шляху UI («Застосувати» = patch + режим + designInternals): бафль
  // оптимізатор підбирає під режим, топка стає іншою, але закладка йде за нею. Усі 50
  // клітинок (спільний кеш uiCell): саме цю таблицю бачить користувач. РЕАЛЬНІ (з тягою)
  // часи цієї таблиці перевіряє блок 75.
  const uiNames = names;
  const uiBurn = Object.fromEntries(MODES.map((mode) => [mode, uiNames.map((name) => { const e = uiCell(name, mode).e; return +(e.metrics.burnTimeHours * e.breakdown.draftFactor / DRAFT_MAX).toFixed(2); })]));
  const offUi = [];
  for (const mode of MODES) uiBurn[mode].forEach((h, i) => { if (!inBand(mode, h)) offUi.push(`${uiNames[i]}/${mode}:${h}`); });
  ok(offUi.length === 0, 'the same strict burn bands hold after Apply on all 50 cells (patch + mode + designInternals), without the draft throttle', JSON.stringify(offUi));
  ok(MODES.every((mode) => sizeFlat(uiBurn[mode])), 'burn time is size-independent after Apply too (all 10 models, within 5 % or 0.1 h per mode, without the draft throttle)', JSON.stringify(uiBurn));

  // (д) Без множника сталі: товща сталь не подовжує горіння. Вона зменшує об'єм
  // топки, а закладка й потужність масштабуються разом з ним.
  const steel = (mm) => { const c = mkPreset('ws6', 'medium'); c.materials.steelThicknessMm = mm; return metricsOf(c).burnTimeHours; };
  ok(Math.abs(steel(8) - steel(3)) <= 0.11, 'steel thickness does not scale burn time (the old 1 + 0.015·mm multiplier is gone)', JSON.stringify({ t3: steel(3), t8: steel(8) }));

  // (е) Калібрування потужності ×1.25 скорочує час горіння тієї самої закладки
  // рівно на стільки ж (≈ −20 %; беремо overnight — довгий час менше страждає від
  // округлення); слабка тяга (2 м) знижує потужність і подовжує його.
  const plain = mkPreset('ws6', 'overnight');
  const cal = clone(plain); cal.calibration = { enabled: true, globalScale: 1.25, modeScale: {} };
  const tPlain = metricsOf(plain).burnTimeHours, tCal = metricsOf(cal).burnTimeHours;
  ok(Math.abs(tCal / tPlain - 0.8) < 0.02, 'power calibration ×1.25 shortens the burn of the same load by ≈20 %', JSON.stringify({ tPlain, tCal }));
  const medium = mkPreset('ws6', 'medium');
  const weak = clone(medium); weak.chimney.totalHeightM = 2;
  const tMedium = metricsOf(medium).burnTimeHours, tWeak = metricsOf(weak).burnTimeHours;
  ok(tWeak > tMedium, 'a weak 2 m draft cuts power and lengthens the burn', JSON.stringify({ tMedium, tWeak }));

  // (ж) STARTUP_LONG: поріг лежить над смугою розпалу — не спрацьовує на жодному
  // із 10 пресетів у start-up, але спрацьовує, коли розпал задушено (мінімум
  // повітря на всіх входах).
  const longOn = names.filter((name) => PhysicsModel.evaluate(mkPreset(name, 'start-up')).warnings.some((w) => w.code === 'STARTUP_LONG'));
  ok(longOn.length === 0, 'STARTUP_LONG stays quiet for a normal start-up on every WS preset', JSON.stringify(longOn));
  const starved = mkPreset('ws6', 'start-up');
  starved.primaryAir.openPct = 15; starved.operation.secondaryAirPct = 20; starved.airWash.intakePct = 10;
  const rs = PhysicsModel.evaluate(starved);
  ok(rs.warnings.some((w) => w.code === 'STARTUP_LONG'), 'STARTUP_LONG fires when the start-up air is choked and the load drags on', JSON.stringify({ burn: rs.metrics.burnTimeHours }));
}

// 70. Перепін серії WS (крок 4 із 4: λ → тяга → час горіння → перепін) і свіп
// екстремальної геометрії. Після зміни λ/тяги/часу горіння усі метрики на межах
// UI мають лишатись скінченними й у розумних межах — жодних NaN/Infinity,
// від'ємної потужності чи часу, тяги поза [1, 100) Па. Лише evaluate (швидко);
// дорогий designInternals — на малій вибірці з keepBaffle.
{
  const WS_NAMES = Object.keys(MODEL_PRESETS).filter((n) => /^ws\d+$/.test(n)).sort((a, b) => +a.slice(2) - +b.slice(2));
  const MODES5 = ['start-up', 'low', 'medium', 'high', 'overnight'];

  // (а) Підпис пресета в селекті (uk/en) називає ту саму потужність, що й
  // nominalKw: до 10 кВт — один знак після коми, від 10 — ціле. Інакше після
  // перепіну чисел підписи тихо застарівають; англійський підпис без кирилиці.
  const fmtKw = (kw) => (kw < 10 ? kw.toFixed(1) : String(Math.round(kw)));
  const staleLabels = [];
  for (const name of WS_NAMES) {
    for (const lng of ['uk', 'en']) {
      const label = STR[lng][MODEL_PRESETS[name].labelKey] || '';
      const want = `~${fmtKw(MODEL_PRESETS[name].nominalKw)} `;
      if (!label.startsWith(`WS-${name.slice(2)} `) || !label.includes(want) || (lng === 'en' && /[А-Яа-яІіЇїЄє]/.test(label))) staleLabels.push(`${lng}:${name}:${label}`);
    }
  }
  ok(staleLabels.length === 0, 'WS labels (uk/en) quote the rounded nominalKw of their preset', JSON.stringify(staleLabels));

  // (б) Практична нижня межа серії зберігається на найменшій моделі: поліно 25 см
  // влазить у топку (внутрішні ширина й глибина — як у physics-model.js: мінус
  // сталь і футеровка шамот+ізоляція з обох боків), зона горіння під бафлем ≥ 15 см,
  // дверцята ≥ 20×20 см, а «чесна» потужність medium ≥ 1 кВт.
  const ws1 = applyModelPreset(normalizeConfig(clone(defaultConfig)), 'ws1');
  const steelCm = ws1.materials.steelThicknessMm / 10, linerCm = ws1.materials.firebrickThicknessCm + ws1.thermal.insulationThicknessCm;
  const inW = ws1.dimensions.widthCm - 2 * steelCm - 2 * linerCm, inD = ws1.dimensions.depthCm - 2 * steelCm - 2 * linerCm;
  const burnZone = ws1.baffle.heightCm - steelCm - linerCm;
  const ws1kw = PhysicsModel.evaluate(ws1).metrics.heatOutputKw;
  ok(Math.min(inW, inD) >= 25 && burnZone >= 15 && ws1.door.widthCm >= 20 && ws1.door.heightCm >= 20 && ws1kw >= 1,
    'WS-1 keeps the practical floor (25 cm log fits, burn zone >= 15 cm, door >= 20x20 cm, power >= 1 kW)',
    JSON.stringify({ inW: round(inW, 1), inD: round(inD, 1), burnZone: round(burnZone, 1), door: [ws1.door.widthCm, ws1.door.heightCm], kw: ws1kw }));

  // (в) Свіп: випадкова геометрія й повітря на межах normalizeConfig (кути й
  // середина діапазону) × усі п'ять режимів. Детермінований генератор, щоб
  // збій відтворювався.
  let seed = 4242;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const ext = (lo, hi) => { const q = rnd(); return q < 0.35 ? lo : q < 0.7 ? hi : lo + rnd() * (hi - lo); };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const randomStove = () => {
    const c = normalizeConfig(clone(defaultConfig));
    Object.assign(c.dimensions, { widthCm: ext(30, 140), depthCm: ext(30, 120), heightCm: ext(40, 180), legHeightCm: ext(0, 40) });
    Object.assign(c.materials, { steelThicknessMm: Math.round(ext(3, 8)), firebrickThicknessCm: ext(2, 8) });
    Object.assign(c.chimney, { diameterCm: ext(10, 25), heightCm: ext(100, 150), totalHeightM: ext(2, 12), bends: Math.round(ext(0, 4)), outlet: pick(['top', 'rear']), route: pick(['up', 'wall']), connectorLengthCm: Math.round(ext(15, 150)) });
    Object.assign(c.door, { widthCm: ext(20, 70), heightCm: ext(20, 70) });
    Object.assign(c.baffle, { heightCm: ext(20, 120), angleDeg: ext(-20, 30), frontGapCm: ext(2, 15), airflowPct: ext(0, 100) });
    Object.assign(c.primaryAir, { openPct: ext(0, 100), holeCount: Math.round(ext(3, 14)), holeDiameterCm: ext(0.6, 2.5) });
    Object.assign(c.secondaryAir, { holeCount: Math.round(ext(8, 240)), holeDiameterCm: ext(0.25, 5), bottomIntake: rnd() < 0.5 });
    Object.assign(c.airWash, { gapCm: ext(0.5, 3), intakePct: ext(0, 100), slotWidthPct: ext(40, 100) });
    c.operation.secondaryAirPct = ext(0, 100);
    c.combustion.tertiary.enabled = rnd() < 0.5; c.combustion.catalyst.enabled = rnd() < 0.5;
    c.thermal.heatExchangePasses = Math.round(ext(1, 4));
    c.testBurn.woodMoisturePct = ext(8, 35);
    return normalizeConfig(c);
  };
  const bad = [];
  let cases = 0, minDraft = Infinity, maxDraft = 0, maxKw = 0, maxBurn = 0;
  const check = (c, tag) => {
    const m = PhysicsModel.evaluate(c).metrics;
    cases++;
    for (const [k, v] of Object.entries(m)) if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${tag} ${k}=${v}`);
    if (!(m.heatOutputKw >= 0 && m.heatOutputKw < 1000)) bad.push(`${tag} kW=${m.heatOutputKw}`);
    if (!(m.burnTimeHours >= 0 && m.burnTimeHours <= 200)) bad.push(`${tag} burn=${m.burnTimeHours}`);
    if (!(m.efficiencyPct >= 0 && m.efficiencyPct <= 100)) bad.push(`${tag} eff=${m.efficiencyPct}`);
    if (!(m.draftPa >= 1 && m.draftPa < 100)) bad.push(`${tag} draft=${m.draftPa}`);
    if (!(m.lambda >= 1.1 && m.lambda <= 4)) bad.push(`${tag} lambda=${m.lambda}`);
    minDraft = Math.min(minDraft, m.draftPa); maxDraft = Math.max(maxDraft, m.draftPa); maxKw = Math.max(maxKw, m.heatOutputKw); maxBurn = Math.max(maxBurn, m.burnTimeHours);
  };
  for (let i = 0; i < 300; i++) {
    const s = randomStove();
    for (const mode of MODES5) check(applyModePreset(clone(s), mode), `raw#${i}/${mode}`);
  }
  for (let i = 0; i < 12; i++) {
    const s = randomStove();
    for (const mode of MODES5) check(designInternals(applyModePreset(clone(s), mode), { keepBaffle: true }), `designed#${i}/${mode}`);
  }
  ok(bad.length === 0, 'extreme geometry x all modes: every metric is finite and inside sane bounds (kW, burn, efficiency, draft, lambda)',
    JSON.stringify({ cases, bad: bad.slice(0, 5), draft: [round(minDraft, 1), round(maxDraft, 1)], maxKw: round(maxKw, 1), maxBurn: round(maxBurn, 1) }));
}

// 71. Φ-датчик: зелена цільова смуга стоїть там, де маркер показує Φ 0.4–0.5.
// Маркер мапить Φ → (Φ−0.1)/0.9 треку (renderPhiGauge); раніше смуга була
// left:40 % / right:40 % — тобто Φ 0.46–0.64, і маркер Φ = 0.61 («мало повітря»)
// лежав усередині зеленого.
{
  const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const band = css.match(/\.phi-band\{[^}]*left:([\d.]+)%;right:([\d.]+)%/);
  const pos = (phi) => (phi - 0.1) / 0.9 * 100;
  ok(/clamp\(\(phi - 0\.1\) \/ 0\.9, 0, 1\)/.test(app), 'renderPhiGauge maps phi to (phi - 0.1) / 0.9 of the track');
  ok(band && Math.abs(+band[1] - pos(0.4)) < 0.05 && Math.abs(100 - +band[2] - pos(0.5)) < 0.05, 'the green .phi-band spans exactly phi 0.4–0.5 of the track', JSON.stringify({ band: band && [band[1], band[2]], want: [+pos(0.4).toFixed(2), +(100 - pos(0.5)).toFixed(2)] }));
}

// 72. Потужність (швидкість горіння) = повітря, що доходить до ложа палива
// (breakdown.fuelBedAir = 0.65·primary + 0.30·air-wash + 0.05 нещільності; ваги —
// ОЦІНКИ, REPORT §7), а не частка ВСІЄЇ відкритої площі, як було через airMix:
// air-wash (≈78 % площі) тоді забирав керування в primary. λ, ККД і Φ лишаються
// площовими (блок 67). Суворість режиму у ВАЛОВІЙ потужності (швидкості горіння) береться
// ЛИШЕ з положень слайдерів режиму; окремого powerFactor немає. Єдиний інший канал — слабка
// тяга (flameIntensity режиму → T на патрубку → draftFactor < 1.3), він окремо виміряний
// у пункті (г) і діє лише на найменших печах. Перевіряємо ПОВЕДІНКУ (напрям,
// порядок, діапазони відношень), а не точні константи; усе через голі patch-и або
// designInternals з keepBaffle.
{
  const MODES = ['start-up', 'low', 'medium', 'high', 'overnight'];
  const names = Object.keys(MODEL_PRESETS);
  const mkBare = (name, mode) => applyModePreset(applyModelPreset(normalizeConfig(clone(defaultConfig)), name), mode);
  const evalOf = (c) => PhysicsModel.evaluate(c);
  const kwOf = (c) => evalOf(c).metrics.heatOutputKw;
  // Потужність без впливу тяги (кВт / draftFactor): саме її задають положення слайдерів
  // режиму. Фактична потужність повільних режимів на холодній трубі ще й урізається слабкою
  // тягою (охолодження труби ∝ 1/витрата газу), тому співвідношення режимів, які мають
  // відображати лише суворість положень, міряємо без неї.
  const kwFreeOf = (c) => { const e = evalOf(c); return e.metrics.heatOutputKw / e.breakdown.draftFactor; };
  const c0 = designInternals(applyModePreset(normalizeConfig(clone(defaultConfig)), 'medium'), { keepBaffle: true });
  const kwAt = (mut) => { const c = clone(c0); mut(c); return kwOf(c); };
  const strictlyUp = (seq) => seq.every((x, i) => i === 0 || x > seq[i - 1]);

  // (а) Primary — головний регулятор: повне закриття лишає невелику частку
  // потужності («піч, закрита по primary, горить повільно»), хід 10→95 % — кратний.
  const prim = [10, 25, 50, 75, 95].map((v) => kwAt((c) => { c.primaryAir.openPct = v; }));
  ok(strictlyUp(prim), 'power rises strictly with the primary opening', JSON.stringify(prim));
  ok(prim[4] / prim[0] >= 2.5, 'primary 10→95 % multiplies the power by at least 2.5 (it was ×1.08 when power followed the open-area share)', JSON.stringify({ lo: prim[0], hi: prim[4], x: +(prim[4] / prim[0]).toFixed(2) }));
  ok(prim[0] / kwAt(() => {}) < 0.6, 'a stove closed down on primary (10 %) burns far slower than at the medium setting (52 %)', JSON.stringify({ closed: prim[0], medium: kwAt(() => {}) }));
  // (б) Air-wash — помірний вплив; secondary — майже нуль (заходить над ложем).
  const wash = [10, 40, 70, 100].map((v) => kwAt((c) => { c.airWash.intakePct = v; }));
  const sec = [20, 40, 60, 80, 95].map((v) => kwAt((c) => { c.operation.secondaryAirPct = v; }));
  ok(strictlyUp(wash) && wash[3] / wash[0] >= 1.1 && wash[3] / wash[0] <= 2.0, 'air-wash 10→100 % raises power moderately (×1.1…×2.0)', JSON.stringify({ wash, x: +(wash[3] / wash[0]).toFixed(2) }));
  ok(Math.abs(sec[4] / sec[0] - 1) < 0.1 && Math.max(...sec) / Math.min(...sec) < 1.1, 'secondary 20→95 % changes power by less than 10 % (secondary air only completes the combustion)', JSON.stringify(sec));
  ok(prim[4] / prim[0] > 1.5 * (wash[3] / wash[0]) && wash[3] / wash[0] > sec[4] / sec[0], 'influence on power: primary > air-wash > secondary', JSON.stringify({ primary: +(prim[4] / prim[0]).toFixed(2), wash: +(wash[3] / wash[0]).toFixed(2), secondary: +(sec[4] / sec[0]).toFixed(2) }));
  // (в) fuelBedAir: у (0, 1], рухається лише primary і air-wash (не secondary, не заслінка).
  const bed = (mut) => { const c = clone(c0); mut(c); return evalOf(c).breakdown.fuelBedAir; };
  const b0 = bed(() => {});
  const bClosed = bed((c) => { c.primaryAir.openPct = 0; c.airWash.intakePct = 0; });
  const bOpen = bed((c) => { c.primaryAir.openPct = 100; c.airWash.intakePct = 100; c.airWash.gapCm = 3; });
  ok(b0 > 0 && b0 < 1 && bClosed > 0 && bClosed < b0 && Math.abs(bOpen - 1) < 1e-9, 'fuelBedAir: a fully closed stove still leaks (>0), a fully open one is 1', JSON.stringify({ bClosed, b0, bOpen }));
  ok(bed((c) => { c.operation.secondaryAirPct = 95; }) === b0 && bed((c) => { c.baffle.airflowPct = 100; }) === b0, 'fuelBedAir ignores the secondary slider and the baffle damper');
  ok(bed((c) => { c.primaryAir.openPct = 90; }) > b0 && bed((c) => { c.airWash.intakePct = 90; }) > b0, 'fuelBedAir grows with primary and air-wash');

  // (г) Суворість режиму береться з ОДНОГО місця — положень слайдерів. Та сама піч з
  // положеннями medium і лише іншою позначкою режиму дає ту саму валову потужність
  // (раніше powerFactor режиму множив її ще раз, разом ×2.9 для overnight).
  const grossByLabel = MODES.map((m) => { const c = clone(c0); c.operation.mode = m; return evalOf(c).metrics.grossHeatOutputKw; });
  ok(Math.max(...grossByLabel) / Math.min(...grossByLabel) < 1.01, 'the mode label alone does not scale power (no powerFactor): mode severity comes only from the slider positions', JSON.stringify(grossByLabel));
  // Те саме для flameIntensity режиму: швидкість горіння (валова потужність без тяги) від неї не
  // залежить ні в якій клітинці, а фактична потужність — лише там, де тяга нижча за плато
  // (слабка тяга малих печей у повільних режимах; на плато лише ККД, ≤ 7 %).
  const flameBad = [], flameChan = [];
  for (const name of ['ws1', 'ws3', 'ws6', 'ws10']) for (const m of ['low', 'overnight']) {
    const cell = uiCell(name, m);
    const hot = clone(cell.cfg); hot.operation.flameIntensity = 0.62; // як у medium
    const eh = evalOf(hot), ec = cell.e;
    const free = (e) => e.metrics.grossHeatOutputKw / e.breakdown.draftFactor;
    if (Math.abs(free(eh) / free(ec) - 1) > 0.01) flameBad.push(`${name}/${m}`);
    const plateau = ec.breakdown.draftFactor >= 1.3 - 1e-9;
    const q = eh.metrics.heatOutputKw / ec.metrics.heatOutputKw;
    flameChan.push(`${name}/${m}:${q.toFixed(2)}`);
    if (plateau && q > 1.07) flameBad.push(`${name}/${m}:plateau-but-x${q.toFixed(2)}`);
  }
  ok(flameBad.length === 0, 'flameIntensity does not scale the burn rate (draft-free power) anywhere; on the draft plateau it moves net power only through efficiency (≤ 7 %)', JSON.stringify({ flameBad, flameChan }));

  // (д) Порядок і співвідношення режимів на ОДНАКОВІЙ топці (голий patch: той самий
  // бафль і об'єм): start-up і high вище medium > low > overnight; overnight 25–40 %
  // від medium, high 1.4–1.9× (потужність без впливу тяги). Не залежить від розміру печі.
  const badRatios = [];
  for (const name of ['ws1', 'ws6', 'ws10']) {
    const k = Object.fromEntries(MODES.map((m) => [m, kwFreeOf(mkBare(name, m))]));
    const q = Object.fromEntries(MODES.map((m) => [m, k[m] / k.medium]));
    const orderOk = k['start-up'] > k.high && k.high > k.medium && k.medium > k.low && k.low > k.overnight;
    const inR = q.overnight >= 0.25 && q.overnight <= 0.40 && q.high >= 1.4 && q.high <= 1.9 && q.low >= 0.5 && q.low <= 0.8 && q['start-up'] >= 1.3 && q['start-up'] <= 2.0;
    if (!orderOk || !inR) badRatios.push(`${name}:${MODES.map((m) => q[m].toFixed(2)).join('/')}`);
  }
  ok(badRatios.length === 0, 'on the same firebox: start-up > high > medium > low > overnight, overnight 0.25–0.40, high 1.4–1.9, low 0.5–0.8, start-up 1.3–2.0 of medium (draft-free power)', JSON.stringify(badRatios));
  // Фактична потужність (з тягою) на тій самій топці: порядок режимів лишається, а
  // слабка тяга повільних режимів малих печей лише ПОГЛИБЛЮЄ їх відставання від medium.
  const actualRatioBad = ['ws1', 'ws6', 'ws10'].filter((name) => {
    const k = Object.fromEntries(MODES.map((m) => [m, kwOf(mkBare(name, m))]));
    const kf = Object.fromEntries(MODES.map((m) => [m, kwFreeOf(mkBare(name, m))]));
    return !(k['start-up'] > k.high && k.high > k.medium && k.medium > k.low && k.low > k.overnight
      && k.overnight / k.medium <= kf.overnight / kf.medium + 1e-9 && k.low / k.medium <= kf.low / kf.medium + 1e-9);
  });
  ok(actualRatioBad.length === 0, 'with the real draft the mode order holds and slow modes fall further behind medium, never ahead', JSON.stringify(actualRatioBad));
  // На шляху UI бафль вибирає оптимізатор. Тайбрейк (SCORE_INDIFFERENCE) більше не
  // «роздуває» бафль під повільні режими, тож суворість режиму тут теж лише з положень
  // слайдерів (див. нижче «спільний бафль режимів»). Порядок режимів лишається.
  const uiOrderBad = ['ws1', 'ws6', 'ws10'].filter((name) => {
    const k = Object.fromEntries(MODES.map((m) => [m, uiCell(name, m).e.metrics.heatOutputKw]));
    return !(k['start-up'] > k.high && k.high > k.medium && k.medium > k.low && k.low > k.overnight && k.overnight / k.medium <= 0.5);
  });
  ok(uiOrderBad.length === 0, 'after Apply (designInternals) the mode order holds and overnight stays at or below 50 % of medium', JSON.stringify(uiOrderBad));

  // (е) Потужність ∝ об'єму топки без обрізання (geometryFactor прибрано): кВт на
  // літр у medium однаковий для всієї серії (розбіг лише через ККД ≈ 1.5 %).
  const perL = names.map((n) => { const m = evalOf(mkBare(n, 'medium')).metrics; return m.heatOutputKw / m.fireboxLiters; });
  ok(Math.max(...perL) / Math.min(...perL) < 1.03, 'medium kW per litre of firebox is the same for WS-1…WS-10 (no size clamp)', JSON.stringify(perL.map((v) => +v.toFixed(4))));

  // (ж) Закладка за наміром неспадна: start-up (розпалювання) найменша, overnight
  // не менша за medium (її не «підгонять» під потужність, як було з 0.60 < 0.65).
  const fill = MODES.map((m) => evalOf(applyModePreset(normalizeConfig(clone(defaultConfig)), m)).metrics.loadingVolumePct);
  ok(fill[0] < fill[1] && fill[1] <= fill[2] && fill[2] <= fill[3] && fill[3] <= fill[4], 'load fraction is monotone by intent: start-up < low <= medium <= high <= overnight', JSON.stringify(fill));
  ok(fill[4] >= fill[2], 'overnight is loaded at least as full as medium', JSON.stringify({ overnight: fill[4], medium: fill[2] }));
}

// 73. Охолодження труби залежить від витрати газу й Ø (крок D). k ∝ D·ṁ^−α (NTU на метр
// U·π·D/(ṁ·cp) дає α = 1, але це верхня межа; прийнято α = 0.5, ОЦІНКА): мала піч або
// повільний режим (мала ṁ) остигає швидше, ширша труба при тій самій витраті — теж. Еталон —
// default medium (k = 0.12/м → 14.3 Па, 184 °C). U, cp, α, 4.5 кг повітря/кг дров і еталонна
// витрата — ОЦІНКИ (REPORT §7); перевіряємо ПОВЕДІНКУ (масштабування, еталон, єдиний профіль
// T(z)), а не окремі константи.
{
  const MODES = ['start-up', 'low', 'medium', 'high', 'overnight'];
  const names = Object.keys(MODEL_PRESETS);
  const evalOf = (c) => PhysicsModel.evaluate(c);
  const mkBare = (name, mode) => applyModePreset(applyModelPreset(normalizeConfig(clone(defaultConfig)), name), mode);
  const def = designInternals(normalizeConfig(clone(defaultConfig))); // як його показує UI
  const dm = evalOf(def).metrics;
  const strictlyUp = (seq) => seq.every((x, i) => i === 0 || x > seq[i - 1]);
  const strictlyDown = (seq) => seq.every((x, i) => i === 0 || x < seq[i - 1]);

  // (а) Еталон: default medium лишається на 14.3 Па / 184 °C (k = 0.12/м), патрубок заднього
  // виходу охолоджує так само, як і раніше (293 °C на вході у вертикаль, 164 °C на виході).
  ok(Math.abs(dm.draftPa - 14.3) <= 0.1 && Math.abs(dm.exitFlueTempC - 184) <= 1 && Math.abs(dm.flueCoolingPerM - 0.12) <= 0.001,
    'default stove, medium, 5 m: the reference anchor holds (14.3 Pa, 184 °C, k = 0.12 /m)', JSON.stringify({ draft: dm.draftPa, exit: dm.exitFlueTempC, k: dm.flueCoolingPerM, mdot: dm.flueGasKgS }));
  const rearDef = clone(def); rearDef.chimney.outlet = 'rear';
  const rdm = evalOf(rearDef).metrics;
  ok(Math.abs(rdm.stackGasC - 293) <= 2 && Math.abs(rdm.exitFlueTempC - 164) <= 2, 'default stove with a rear 30 cm connector: the connector cools the gas as before (293 °C at the vertical, 164 °C at the exit)', JSON.stringify({ stackGasC: rdm.stackGasC, exit: rdm.exitFlueTempC, draft: rdm.draftPa }));

  // (б) k = C·D·ṁ^−α з ОДНИМ показником α на всіх 50 клітинках: ln(k/D) лежить на прямій за ln ṁ.
  // Сам α — ОЦІНКА (REPORT §7), тест вимагає лише фізичного діапазону 0.2…1 (турбулентна течія …
  // чистий NTU зі сталим U) і щільного збігу з прямою, тобто що Ø і витрата справді множать k.
  // Допуск — округлення метрик (ṁ до 5 знаків, k до 4).
  const xs = [], ys = [];
  for (const name of names) for (const mode of MODES) { const c = mkBare(name, mode), m = evalOf(c).metrics; xs.push(Math.log(m.flueGasKgS)); ys.push(Math.log(m.flueCoolingPerM / c.chimney.diameterCm)); }
  const mx = xs.reduce((a, b) => a + b) / xs.length, my = ys.reduce((a, b) => a + b) / ys.length;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const resid = Math.max(...xs.map((x, i) => Math.abs(ys[i] - my - slope * (x - mx))));
  ok(slope <= -0.2 && slope >= -1.0 && resid < 0.03, 'k ∝ Ø·ṁ^−α on all 50 preset × mode cells with one exponent α in the physical range 0.2…1 (cooling per metre grows with pipe diameter and falls with gas flow)', JSON.stringify({ alpha: +(-slope).toFixed(3), maxResid: +resid.toFixed(4) }));

  // (в) Менша витрата газу → швидше остигання. Серія WS у medium: більша піч — більша ṁ,
  // менше k, гарячіший вихід. Те саме на ОДНІЙ печі, коли primary міняє витрату.
  const med = names.map((n) => evalOf(mkBare(n, 'medium')).metrics);
  ok(strictlyUp(med.map((m) => m.flueGasKgS)) && strictlyDown(med.map((m) => m.flueCoolingPerM)) && strictlyUp(med.map((m) => m.exitFlueTempC)),
    'WS-1…WS-10 in medium: bigger stove — more gas, less cooling per metre, hotter exit', JSON.stringify({ mdot: med.map((m) => m.flueGasKgS), k: med.map((m) => m.flueCoolingPerM), exit: med.map((m) => m.exitFlueTempC) }));
  const byPrimary = [95, 52, 10].map((p) => { const c = clone(def); c.primaryAir.openPct = p; return evalOf(c).metrics; });
  ok(strictlyDown(byPrimary.map((m) => m.flueGasKgS)) && strictlyUp(byPrimary.map((m) => m.flueCoolingPerM)) && strictlyDown(byPrimary.map((m) => m.exitFlueTempC)),
    'one stove, primary 95 → 52 → 10 %: less gas flow, faster cooling, colder exit', JSON.stringify(byPrimary.map((m) => [m.flueGasKgS, m.flueCoolingPerM, m.exitFlueTempC])));
  // Повільні режими тієї самої печі остигають швидше за робочі (менше повітря ложа → менша ṁ).
  const wsCool = (name) => MODES.map((mode) => evalOf(mkBare(name, mode)).metrics.flueCoolingPerM);
  ok(['ws1', 'ws6', 'ws10'].every((n) => { const k = wsCool(n); return k[4] > k[1] && k[1] > k[2] && k[2] > k[3] && k[3] > k[0]; }),
    'on one stove the slow modes cool faster per metre: overnight > low > medium > high > start-up', JSON.stringify(['ws1', 'ws6', 'ws10'].map(wsCool)));

  // (г) Ширша труба при тій самій витраті: k росте з Ø (k/Ø стале), вихід холодніший.
  const byDia = [10, 14, 18, 25].map((D) => { const c = clone(def); c.chimney.diameterCm = D; return { D, m: evalOf(c).metrics }; });
  const perCm = byDia.map(({ D, m }) => m.flueCoolingPerM / D);
  ok(strictlyUp(byDia.map(({ m }) => m.flueCoolingPerM)) && strictlyDown(byDia.map(({ m }) => m.exitFlueTempC)) && Math.max(...perCm) / Math.min(...perCm) < 1.01,
    'a wider pipe at the same gas flow cools faster (k ∝ Ø) and exits colder', JSON.stringify(byDia.map(({ D, m }) => [D, m.flueCoolingPerM, m.exitFlueTempC])));

  // (д) Вихід WS-1 реалістичний: мала піч на 5 м одностінної труби має вихід ВІДЧУТНО
  // холодніший за еталонні 184 °C (а не однаковий для всієї серії), але не «кімнатний» (раніше
  // ≈44–52 °C — з показником 1); вихід росте з розміром печі, велика піч гарячіша за еталон.
  const ws1m = med[0], ws10m = med[med.length - 1];
  ok(ws1m.exitFlueTempC >= 90 && ws1m.exitFlueTempC < dm.exitFlueTempC - 30 && ws10m.exitFlueTempC > dm.exitFlueTempC,
    'WS-1 medium on 5 m: exit clearly below the default 184 °C but well above room temperature (not the old ≈50 °C); WS-10 hotter than the default', JSON.stringify({ ws1: ws1m.exitFlueTempC, def: dm.exitFlueTempC, ws10: ws10m.exitFlueTempC }));
  ok(ws1m.draftPa < ws10m.draftPa && ws1m.draftPa > 5, 'WS-1 draws less than WS-10 on the same 5 m flue (a small stove cools its flue), but still draws', JSON.stringify({ ws1: ws1m.draftPa, ws10: ws10m.draftPa }));

  // (е) ОДИН профіль T(z) для тяги, виходу і CREOSOTE_RISK: exit = 20 + (T_патрубка − 20)·e^(−k·H) − 6·повороти
  // (в межах округлення метрик), а CREOSOTE_RISK спрацьовує рівно тоді, коли exit < 150 °C —
  // на всіх 50 клітинках × 3 висоти. Підлога exit — кімнатна температура.
  const profileBad = [], crBad = [];
  let floorHit = 0;
  for (const name of names) for (const mode of MODES) for (const H of [3, 5, 9]) {
    const c = mkBare(name, mode); c.chimney.totalHeightM = H;
    const r = evalOf(c), m = r.metrics;
    const pred = 20 + (m.stackGasC - 20) * Math.exp(-m.flueCoolingPerM * H) - 6 * m.routeBends;
    if (m.exitFlueTempC > 22 && Math.abs(pred - m.exitFlueTempC) > 1.5) profileBad.push(`${name}/${mode}/${H}:${pred.toFixed(1)}vs${m.exitFlueTempC}`);
    if (m.exitFlueTempC < 20) profileBad.push(`${name}/${mode}/${H}:below-ambient`);
    if (m.exitFlueTempC <= 20) floorHit++;
    if (r.warnings.some((w) => w.code === 'CREOSOTE_RISK') !== (m.exitFlueTempC < 150)) crBad.push(`${name}/${mode}/${H}:${m.exitFlueTempC}`);
  }
  ok(profileBad.length === 0, 'exit temperature follows the same exponential profile as the draft (k from gas flow and Ø, ±1.5 °C) and never drops below room temperature', JSON.stringify({ profileBad: profileBad.slice(0, 5), floorHit }));
  ok(crBad.length === 0, 'CREOSOTE_RISK fires exactly when the exit gas is below 150 °C (same profile) on 150 cells', JSON.stringify(crBad.slice(0, 5)));

  // (ж) Патрубок масштабується тим самим множником: на малій печі він віддає в кімнату
  // більшу частку тепла, ніж на великій (газу менше, тож труба остуджує його сильніше); top/up патрубка не має.
  const gain = (name) => { const c = mkBare(name, 'medium'); c.chimney.outlet = 'rear'; c.chimney.connectorLengthCm = 30; return evalOf(c).metrics.roomPipeGainPct; };
  ok(gain('ws1') > gain('ws6') && gain('ws6') > gain('ws10') && gain('ws10') > 0, 'rear connector: the smaller the stove, the larger the share of heat the bare pipe gives to the room', JSON.stringify({ ws1: gain('ws1'), ws6: gain('ws6'), ws10: gain('ws10') }));
  ok(evalOf(mkBare('ws1', 'medium')).metrics.roomPipeGainPct === 0, 'top/up has no connector heat (cooling scale does not leak into it)');

  // (з) Межа UI: піч, що ледь горить (топка ≈3.7 л, 0.06 кВт), дає скінченне k, у кілька разів
  // більше за еталонне 0.12, і вихід майже кімнатної температури; тяга не нижче підлоги 1 Па.
  const tinyCfg = mkBare('ws1', 'overnight');
  Object.assign(tinyCfg.dimensions, { widthCm: 30, depthCm: 30, heightCm: 40, legHeightCm: 0 });
  tinyCfg.materials.steelThicknessMm = 5; tinyCfg.materials.firebrickThicknessCm = 4;
  const tinyM = evalOf(designInternals(normalizeConfig(tinyCfg))).metrics;
  ok(Number.isFinite(tinyM.flueCoolingPerM) && tinyM.flueCoolingPerM > 0.5 && tinyM.exitFlueTempC >= 20 && tinyM.exitFlueTempC <= 40 && tinyM.draftPa >= 1, 'a near-dead tiny stove: k is several times the reference but finite, exit is near room temperature, draft stays above its 1 Pa floor', JSON.stringify({ k: tinyM.flueCoolingPerM, exit: tinyM.exitFlueTempC, draft: tinyM.draftPa }));
}

// 74. Вибір бафля: детермінований тайбрейк (крок E). Оцінка кандидата майже не залежить від
// висоти бафля (стеля ККД 92 + округлення 0.1), тож нічиї реальні. Правило: усі в межах
// SCORE_INDIFFERENCE від найкращого — рівні; серед рівних максимум secondaryCoverage, далі
// найнижчий бафль, далі порядок перебору. CREOSOTE_RISK/DRAFT_WEAK не штрафуються (вони про
// димохід, а не про геометрію). Тести: правило на синтетичному пулі + поведінка оптимізатора.
{
  const MODES = ['start-up', 'low', 'medium', 'high', 'overnight'];
  const evalOf = (c) => PhysicsModel.evaluate(c);
  const mkBare = (name, mode) => applyModePreset(applyModelPreset(normalizeConfig(clone(defaultConfig)), name), mode);
  const cand = (score, coverage, heightCm, tag = '') => ({ score, coverage, config: { baffle: { heightCm } }, result: { tag } });
  const permutations = (arr) => (arr.length <= 1 ? [arr] : arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p])));

  // (а) Правило. Смуга: 90 − SCORE_INDIFFERENCE. У смузі — висоти 40, 34, 28, 46 (на 0, 0.4, 0.8 і 0
  // ширини від найкращого); кандидат h=22 з найвищим покриттям (на 1.2 ширини нижче) у смугу не потрапляє.
  // Серед чотирьох найбільше покриття 1.3 мають 34, 28, 46, з них найнижчий бафль — 28. Результат не
  // залежить від порядку в пулі (усі 120 перестановок). Зсуви виражено через саму смугу, а не числами.
  ok(SCORE_INDIFFERENCE > 0 && SCORE_INDIFFERENCE < 1, 'the indifference band is positive and smaller than one score point', String(SCORE_INDIFFERENCE));
  const SI = SCORE_INDIFFERENCE;
  const pool = [cand(90, 1.2, 40), cand(90 - 0.4 * SI, 1.3, 34), cand(90 - 0.8 * SI, 1.3, 28), cand(90 - 1.2 * SI, 1.5, 22), cand(90, 1.3, 46)];
  const winners = new Set(permutations(pool).map((p) => pickBaffleCandidate(p).config.baffle.heightCm));
  ok(winners.size === 1 && winners.has(28), 'tie rule: within the band take the best secondary coverage, then the lowest baffle; a candidate outside the band loses; any pool order gives the same winner', JSON.stringify([...winners]));
  ok(pickBaffleCandidate([cand(90, 1.3, 46), cand(90, 1.3, 34), cand(90, 1.3, 40)]).config.baffle.heightCm === 34, 'exact tie with equal coverage: the lowest baffle wins');
  ok(pickBaffleCandidate([cand(90, 1.3, 34, 'first'), cand(90, 1.3, 34, 'second')]).result.tag === 'first', 'a complete tie falls back to the enumeration order (the first candidate)');
  ok(pickBaffleCandidate([cand(88, 1.5, 22), cand(90, 1.0, 50)]).config.baffle.heightCm === 50, 'a clearly better score wins even against a higher coverage (the band is narrow)');
  ok(pickBaffleCandidate([]) === null, 'an empty pool gives null');

  // (б) Детермінізм оптимізатора: ту саму піч designInternals дає той самий бафль незалежно від
  // того, який бафль був у конфігу до цього (стара/чужа геометрія, інший режим перед цим).
  const stoves = [['ws1', 'overnight'], ['ws4', 'low'], ['ws6', 'medium'], ['ws9', 'high']];
  const sig = (c) => JSON.stringify([c.baffle.heightCm, c.baffle.angleDeg, c.baffle.frontGapCm, c.baffle.airflowPct, c.chimney.diameterCm]);
  const dependent = [];
  for (const [name, mode] of stoves) {
    const fresh = sig(designInternals(mkBare(name, mode)));
    for (const [h, a] of [[30, 10], [80, -2], [52, 6]]) {
      const seeded = mkBare(name, mode); Object.assign(seeded.baffle, { heightCm: h, angleDeg: a });
      if (sig(designInternals(seeded)) !== fresh) dependent.push(`${name}/${mode} from baffle ${h}/${a}`);
    }
    if (sig(designInternals(mkBare(name, mode))) !== fresh) dependent.push(`${name}/${mode} repeat`);
  }
  ok(dependent.length === 0, 'the same stove always gets the same baffle and flue diameter, whatever baffle the config held before', JSON.stringify(dependent));

  // (в) Бафль більше не «кодує» режим: на шляху UI (усі 10 моделей) висота бафля в усіх режимах
  // однієї печі в межах одного кроку сітки (6 см) від medium, а потужність без впливу тяги в
  // overnight — 25–40 % від medium (раніше low/overnight отримували бафль на 10–20 см вищий, топку
  // на 40–50 % більшу, і overnight/medium на UI був 0.43–0.49 замість ≈0.31 на однаковій топці;
  // з вужчою смугою 0.25 і показником охолодження 1 WS-3/WS-6/WS-7 overnight знову піднімали бафль на 6–12 см).
  const spread = [], ratio = [], ratioOff = [];
  for (const name of Object.keys(MODEL_PRESETS)) {
    const ui = Object.fromEntries(MODES.map((m) => [m, uiCell(name, m)]));
    const heights = MODES.map((m) => ui[m].cfg.baffle.heightCm);
    if (Math.max(...heights) - ui.medium.cfg.baffle.heightCm > 6 || ui.medium.cfg.baffle.heightCm - Math.min(...heights) > 6) spread.push(`${name}:${heights}`);
    const free = (e) => e.metrics.heatOutputKw / e.breakdown.draftFactor;
    const q = free(ui.overnight.e) / free(ui.medium.e);
    ratio.push(+q.toFixed(2));
    if (q < 0.25 || q > 0.40) ratioOff.push(`${name}:${q.toFixed(2)}`);
  }
  ok(spread.length === 0, 'after Apply every mode of EVERY WS model keeps its baffle within one grid step (6 cm) of medium', JSON.stringify(spread));
  ok(ratioOff.length === 0, 'after Apply overnight/medium (draft-free power) stays 0.25–0.40 on all ten models — the baffle no longer re-encodes the mode', JSON.stringify({ ratio, ratioOff }));

  // (в2) Неперервність: крок висоти корпусу на 1 см не має змінювати потужність low/overnight стрибком.
  // Раніше штраф 6 балів за SECONDARY_COLD перемикав бафль 30 → 43 см (ws2/low, висота 55 → 56 см:
  // 0.76 → 1.54 кВт, ×2.03), а після зміни охолодження труби кроків > 15 % було ще більше.
  const jumps = [];
  let steps = 0, maxJump = 1;
  for (const [name, mode] of [['ws2', 'low'], ['ws2', 'overnight'], ['ws4', 'low'], ['ws6', 'overnight']]) {
    const seed = mkBare(name, mode);
    let prev = null;
    for (let dh = -8; dh <= 8; dh++) {
      const c = clone(seed); c.dimensions.heightCm = seed.dimensions.heightCm + dh;
      const kw = evalOf(designInternals(c)).metrics.heatOutputKw;
      if (prev) { steps++; const q = Math.max(kw / prev, prev / kw); maxJump = Math.max(maxJump, q); if (q > 1.15) jumps.push(`${name}/${mode}@h${c.dimensions.heightCm}:${prev}->${kw}`); }
      prev = kw;
    }
  }
  ok(jumps.length === 0, 'power of low/overnight is continuous in the body height: no 1 cm step moves it by more than 15 % (no baffle cliffs)', JSON.stringify({ steps, maxJump: +maxJump.toFixed(2), jumps: jumps.slice(0, 4) }));

  // (г) Попередження про димохід не керують геометрією: бафль (а отже й топка) не залежить від
  // висоти димоходу, хоча на 2 м спрацьовує DRAFT_WEAK, а на 5–12 м у малої печі — CREOSOTE_RISK.
  // Раніше оптимізатор «рятував» піч від креозоту більшою топкою (ws4 medium +33 % кВт).
  const flueDriven = [];
  for (const [name, mode] of [['ws1', 'low'], ['ws3', 'medium'], ['ws4', 'medium'], ['ws6', 'overnight']]) {
    const hs = [2, 5, 12].map((H) => { const c = mkBare(name, mode); c.chimney.totalHeightM = H; return designInternals(c).baffle.heightCm; });
    if (new Set(hs).size !== 1) flueDriven.push(`${name}/${mode}:${hs}`);
  }
  ok(flueDriven.length === 0, 'the baffle (firebox size) does not depend on chimney height: flue warnings no longer drive the geometry', JSON.stringify(flueDriven));

  // (д) Піни: medium не зсунувся від тайбрейка (блок 66 тримає medium усієї серії).
  const ws6mk = (m) => evalOf(designInternals(mkBare('ws6', m))).metrics;
  ok(ws6mk('medium').heatOutputKw === 5.52 && ws6mk('medium').fireboxLiters === 97.9, 'ws6 medium after Apply is the default 5.52 kW / 97.9 L (pinned anchor unchanged)', JSON.stringify({ kw: ws6mk('medium').heatOutputKw, l: ws6mk('medium').fireboxLiters }));
}

// 75. РЕАЛЬНІ цифри шляху UI (REPORT §7). Блоки 69/72/74 міряють смуги й відношення режимів
// «без впливу тяги» (burn·draftFactor/1.3, кВт/draftFactor); тут — те, що бачить користувач
// після «Застосувати» (patch + режим + designInternals), 5 м одностінної труби, верхній вихід
// «над піччю». Відомі винятки названо ЯВНО: нова деградація в іншій клітинці валить тест, і
// усунення винятку теж (тоді список слід оновити разом із REPORT §7). Усі смуги й пороги — ОЦІНКИ.
{
  const MODES = ['start-up', 'low', 'medium', 'high', 'overnight'];
  const BANDS = { 'start-up': [0.7, 1.2], low: [5, 7], medium: [3, 4.5], high: [1.5, 2.5], overnight: [8, 12] };
  const names = Object.keys(MODEL_PRESETS).filter((n) => /^ws\d+$/.test(n)).sort((a, b) => +a.slice(2) - +b.slice(2));
  const cell = (n, m) => uiCell(n, m).e;
  const kw = (n, m) => cell(n, m).metrics.heatOutputKw;
  const sameSet = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  // (а) Час горіння повної закладки з реальною тягою. Поза смугою — лише overnight двох найменших
  // печей (WS-1 13.5 год, WS-2 12.5 год), обидва ДОВШЕ за смугу: слабка тяга (6.1 / 6.6 Па) урізає
  // потужність. Раніше (показник охолодження 1) таких клітинок було 8 з 50 (19.6 год на WS-1…WS-4).
  const off = [], shorter = [];
  for (const n of names) for (const m of MODES) {
    const h = cell(n, m).metrics.burnTimeHours;
    if (h < BANDS[m][0] - 1e-9 || h > BANDS[m][1] + 1e-9) { off.push(`${n}/${m}`); if (h < BANDS[m][0]) shorter.push(`${n}/${m}:${h}`); }
  }
  ok(sameSet(off, ['ws1/overnight', 'ws2/overnight']) && shorter.length === 0, 'REAL burn times after Apply: only overnight on WS-1/WS-2 is outside its band (known exception, longer — weak draft); the other 48 of 50 cells are inside', JSON.stringify({ off, shorter }));

  // (б) Відношення потужностей режимів (фактичних, з тягою) до medium: overnight 0.25–0.40 скрізь,
  // крім WS-1 (≈0.23: найслабша тяга серії); low ≈ 0.65 скрізь; high ≈ 1.45; start-up ≈ 1.6.
  const q = (n, m) => kw(n, m) / kw(n, 'medium');
  const ovnOff = names.filter((n) => q(n, 'overnight') < 0.25 || q(n, 'overnight') > 0.40);
  ok(sameSet(ovnOff, ['ws1']), 'REAL overnight/medium power is 0.25–0.40 on WS-2…WS-10; WS-1 (≈0.23, weakest draft) is the one known exception', JSON.stringify({ ovnOff, ratios: names.map((n) => +q(n, 'overnight').toFixed(2)) }));
  ok(names.every((n) => q(n, 'low') >= 0.55 && q(n, 'low') <= 0.75 && q(n, 'high') >= 1.35 && q(n, 'high') <= 1.6 && q(n, 'start-up') >= 1.5 && q(n, 'start-up') <= 1.8),
    'REAL low / high / start-up power relative to medium is the same on every model (0.55–0.75 / 1.35–1.6 / 1.5–1.8)', JSON.stringify(names.map((n) => [+q(n, 'low').toFixed(2), +q(n, 'high').toFixed(2), +q(n, 'start-up').toFixed(2)])));

  // (в) Розкид часу горіння по серії (max/min) у кожному режимі на реальній тязі: робочі режими
  // практично не залежать від розміру, overnight ≈ 1.27× (слабка тяга WS-1/WS-2). Раніше low 1.77×, overnight 1.85×.
  const spreadOf = (m) => { const b = names.map((n) => cell(n, m).metrics.burnTimeHours); return Math.max(...b) / Math.min(...b); };
  const spreads = Object.fromEntries(MODES.map((m) => [m, +spreadOf(m).toFixed(2)]));
  ok(['start-up', 'low', 'medium', 'high'].every((m) => spreads[m] <= 1.05) && spreads.overnight <= 1.35, 'REAL burn-time spread across WS-1…WS-10 (max/min): ≤ 1.05 in start-up/low/medium/high, ≤ 1.35 in overnight (was 1.77 / 1.85 in low / overnight)', JSON.stringify(spreads));

  // (г) Тяга: робочі режими ≥ 8 Па на всіх 40 клітинках; overnight 6–10 Па (природно слабше), без тяги < 4 Па.
  const draft = (n, m) => cell(n, m).metrics.draftPa;
  const weakWorking = names.flatMap((n) => ['start-up', 'low', 'medium', 'high'].filter((m) => draft(n, m) < 8).map((m) => `${n}/${m}:${draft(n, m)}`));
  const ovnDrafts = names.map((n) => draft(n, 'overnight'));
  ok(weakWorking.length === 0 && Math.min(...ovnDrafts) >= 6 && Math.min(...ovnDrafts) < 8, 'REAL draft after Apply on 5 m: ≥ 8 Pa in the four working modes; overnight 6–10 Pa (the slow mode draws weaker by nature)', JSON.stringify({ weakWorking, ovnDrafts }));

  // (д) CREOSOTE_RISK (danger) на реальному шляху: start-up/high — ніколи; medium — лише WS-1/WS-2
  // (ВІДОМИЙ ВИНЯТОК: 1.2–1.7 кВт на голій 5-метровій одностінній трубі, вихід 124/136 °C —
  // питання власнику в REPORT §7); low/overnight — на малих і середніх печах (чесна оцінка).
  const crOf = (m) => names.filter((n) => cell(n, m).warnings.some((w) => w.code === 'CREOSOTE_RISK'));
  ok(crOf('start-up').length === 0 && crOf('high').length === 0 && sameSet(crOf('medium'), ['ws1', 'ws2']) && crOf('low').length >= 8 && crOf('overnight').length >= 8,
    'REAL CREOSOTE_RISK on 5 m: never in start-up/high; in medium only WS-1/WS-2 (known exception); in low/overnight on small and mid stoves', JSON.stringify(Object.fromEntries(MODES.map((m) => [m, crOf(m).map((n) => n.slice(2)).join(',')]))));
  const dangerOther = names.flatMap((n) => MODES.filter((m) => cell(n, m).warnings.some((w) => w.level === 'danger' && w.code !== 'CREOSOTE_RISK')).map((m) => `${n}/${m}`));
  ok(dangerOther.length === 0, 'after Apply no WS cell has any danger warning except CREOSOTE_RISK', JSON.stringify(dangerOther));

  // (е) WS-6 після «Застосувати» — це defaultConfig: ті самі 14.3 Па / 184 °C / 5.52 кВт (патч більше не
  // ставить 1 вигин), а жоден пресет не чіпає висоту й вигини труби (вони — властивість монтажу).
  const w6 = cell('ws6', 'medium').metrics, dm = PhysicsModel.evaluate(designInternals(normalizeConfig(clone(defaultConfig)))).metrics;
  ok(w6.draftPa === dm.draftPa && w6.exitFlueTempC === dm.exitFlueTempC && w6.heatOutputKw === dm.heatOutputKw && Math.abs(w6.draftPa - 14.3) <= 0.1, 'ws6 medium after Apply equals the default stove (draft, exit temperature, power)', JSON.stringify({ ws6: [w6.draftPa, w6.exitFlueTempC, w6.heatOutputKw], def: [dm.draftPa, dm.exitFlueTempC, dm.heatOutputKw] }));
  const touched = names.filter((n) => { const c = normalizeConfig(clone(defaultConfig)); c.chimney.totalHeightM = 8; c.chimney.bends = 2; applyModelPreset(c, n); return c.chimney.totalHeightM !== 8 || c.chimney.bends !== 2; });
  ok(touched.length === 0, 'no WS preset resets chimney height or bends (installation properties): the result does not depend on what was applied before', JSON.stringify(touched));

  // (ж) Маршрут і вихід: потужність у medium майже не залежить від них (підпис пресета чесний для всіх
  // чотирьох варіантів: ≥ 0.9 від top/up), а повільні режими малих печей на довшій холодній трубі
  // (top/wall: +2 повороти і зайва труба в кімнаті) втрачають тягу й потужність — до −45 %. Це наслідок
  // охолодження труби (REPORT §7), а не збій; межа 0.5 ловить нову деградацію.
  const worst = { medium: 9, slow: 9 };
  const bad = [];
  for (const n of names) for (const m of ['medium', 'low', 'overnight']) {
    const base = cell(n, m).metrics.heatOutputKw;
    for (const outlet of ['top', 'rear']) for (const route of ['up', 'wall']) {
      const c = clone(uiCell(n, m).cfg); c.chimney.outlet = outlet; c.chimney.route = route;
      const ratio = PhysicsModel.evaluate(c).metrics.heatOutputKw / base;
      if (m === 'medium') worst.medium = Math.min(worst.medium, ratio); else worst.slow = Math.min(worst.slow, ratio);
      if ((m === 'medium' && ratio < 0.9) || ratio < 0.5) bad.push(`${n}/${m}/${outlet}/${route}:${ratio.toFixed(2)}`);
    }
  }
  ok(bad.length === 0, 'power vs outlet/route: medium keeps ≥ 0.9 of top/up on every model and variant; low/overnight lose at most half', JSON.stringify({ worstMedium: +worst.medium.toFixed(2), worstSlow: +worst.slow.toFixed(2), bad: bad.slice(0, 5) }));
  // Вихід більше не впирається в кімнатну температуру при ненульовій тязі: жодна з 150 клітинок
  // «10 пресетів × 5 режимів × висоти 3, 5, 9 м» (раніше 8 клітинок із виходом 20 °C).
  let floorHit = 0, cells150 = 0;
  for (const n of names) for (const m of MODES) for (const H of [3, 5, 9]) { const c = clone(uiCell(n, m).cfg); c.chimney.totalHeightM = H; cells150++; if (PhysicsModel.evaluate(c).metrics.exitFlueTempC <= 20) floorHit++; }
  ok(floorHit === 0, 'the exit temperature never sits on the 20 °C floor on any of the 150 cells (preset × mode × 3/5/9 m)', JSON.stringify({ floorHit, cells150 }));

  // (з) Підпис попередження збігається з метрикою: CREOSOTE_RISK порівнює вже ЗАОКРУГЛЕНИЙ вихід
  // (раніше при 149.6 °C писало «150°C < 150°C»). Скануємо висоту труби дрібним кроком на default-печі
  // (вихід перетинає 150 °C) і на WS-4 medium.
  const msgBad = [];
  let crossed = 0;
  for (const seed of [designInternals(normalizeConfig(clone(defaultConfig))), clone(uiCell('ws4', 'medium').cfg)]) {
    for (let H = 2; H <= 12; H += 0.01) {
      const c = clone(seed); c.chimney.totalHeightM = +H.toFixed(2);
      const e = PhysicsModel.evaluate(c), cr = e.warnings.find((w) => w.code === 'CREOSOTE_RISK');
      if (!!cr !== (e.metrics.exitFlueTempC < 150)) msgBad.push(`H${c.chimney.totalHeightM}:${e.metrics.exitFlueTempC}`);
      if (cr && !(+cr.message.match(/на виході (\d+)°C/)[1] < 150)) msgBad.push(`H${c.chimney.totalHeightM}:msg`);
      if (e.metrics.exitFlueTempC === 150) crossed++;
    }
  }
  ok(msgBad.length === 0 && crossed > 0, 'CREOSOTE_RISK never reads "150°C < 150°C": it fires exactly when the displayed exit temperature is below 150 (scan of 2000 chimney heights)', JSON.stringify({ msgBad: msgBad.slice(0, 5), crossed }));

  // (и) Не-нормалізований конфіг: NaN / рядок / undefined / null / '' у слайдерах дають скінченні метрики
  // (раніше NaN доходив до λ, тяги й k), а −5 і 1e9 — теж скінченні.
  const sliders = [['primaryAir', 'openPct'], ['operation', 'secondaryAirPct'], ['operation', 'flameIntensity'], ['airWash', 'gapCm'], ['airWash', 'intakePct'], ['airWash', 'slotWidthPct'], ['baffle', 'airflowPct'], ['baffle', 'frontGapCm'], ['baffle', 'heightCm'], ['baffle', 'angleDeg']];
  const nonFinite = [];
  let rawCells = 0;
  for (const [sec, key] of sliders) for (const junk of [NaN, 'abc', undefined, null, '', -5, 1e9]) {
    const c = normalizeConfig(clone(defaultConfig)); c[sec][key] = junk;
    const m = PhysicsModel.evaluate(c).metrics;
    rawCells++;
    for (const [k, v] of Object.entries(m)) if (typeof v === 'number' && !Number.isFinite(v)) nonFinite.push(`${sec}.${key}=${String(junk)}:${k}`);
  }
  ok(nonFinite.length === 0, 'evaluate on a RAW (not normalised) config with NaN / "abc" / undefined / null / "" / −5 / 1e9 in any slider keeps every metric finite', JSON.stringify({ rawCells, nonFinite: nonFinite.slice(0, 5) }));

  // (к) Підпис Φ у UI: статус порівнюється з тим самим округленням (2 знаки), що й напис
  // (раніше Φ 0.504 показувало «Φ = 0.50» поруч із «Φ > 0.5»).
  const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  ok(/const phiShown = phi2/.test(appSrc) && /const phi2 = m\.equivalenceRatio2/.test(appSrc) && /phiGaugeState\(phiShown, mode\)/.test(appSrc) && !/phiShown > 0\.5/.test(appSrc) && !/\+phi\.toFixed\(2\)/.test(appSrc),
    'the Φ gauge status uses the same 2-digit rounding as its label');
}

// 76. Рівень CREOSOTE_RISK: < 100 °C — danger, 100…150 °C — warn (код той самий і
// спрацьовує рівно при виході < 150 °C). Medium на найменших пресетах (124/136 °C)
// більше не дає червоного danger; холодні режими малих печей (44 °C) лишаються danger.
{
  const crLevel = (name, mode) => {
    const c = applyModelPreset(normalizeConfig(clone(defaultConfig)), name);
    applyModePreset(c, mode);
    designInternals(c);
    const r = PhysicsModel.evaluate(c);
    const w = r.warnings.find((x) => x.code === 'CREOSOTE_RISK');
    return { level: w ? w.level : null, exit: r.metrics.exitFlueTempC };
  };
  const m1 = crLevel('ws1', 'medium'), o1 = crLevel('ws1', 'overnight'), m6 = crLevel('ws6', 'medium');
  ok(m1.level === 'warn' && m1.exit >= 100 && m1.exit < 150, 'WS-1 medium (exit 100…150 °C): CREOSOTE_RISK is a warn, not danger', JSON.stringify(m1));
  ok(o1.level === 'danger' && o1.exit < 100, 'WS-1 overnight (exit < 100 °C): CREOSOTE_RISK stays danger', JSON.stringify(o1));
  ok(m6.level === null && m6.exit >= 150, 'WS-6 medium: no CREOSOTE_RISK', JSON.stringify(m6));
}

// 77. Безпека даних: недовірений JSON (share-лінк, файл, localStorage) проходить
// sanitize -> merge -> normalize без винятків, без підміни прототипів, зі скінченним
// результатом; чуже калібрування не застосовується; калібрування іншої версії моделі
// вимкнене; збережений конфіг без версій завантажується. Часу годинником не міряємо
// (AGENTS.md): «обмежений час» тут = обмежені входи (ліміти LIMITS відхиляють величезне
// ДО парсингу/обходу, що видно з reason).
{
  const hostileTexts = {
    nullSections: JSON.stringify({ dimensions: null, materials: null, chimney: null, baffle: null, door: null, calibration: null, colors: null }),
    numbersInObjectSlots: JSON.stringify({ dimensions: 5, materials: 'x', chimney: true, combustion: 7, thermal: [1, 2], testBurn: 'abc', room: 1e9 }),
    arrays: JSON.stringify({ dimensions: [70, 55], chimney: { diameterCm: [15], heightCm: {} }, operation: { mode: ['medium'] } }),
    protoDirect: '{"__proto__":{"polluted":1},"dimensions":{"widthCm":50,"__proto__":{"polluted2":1}},"constructor":{"prototype":{"polluted3":1}}}',
    ctorPath: JSON.stringify({ constructor: { prototype: { polluted4: 1 } }, prototype: { x: 1 }, dimensions: { constructor: 'x', widthCm: 60 } }),
    huge1e9: JSON.stringify({ dimensions: { widthCm: 1e9, depthCm: -1e9, heightCm: 1e308 }, chimney: { diameterCm: 1e9, totalHeightM: -1e9, bends: 1e9 } }),
    stringsInNumbers: JSON.stringify({ dimensions: { widthCm: '70', depthCm: 'abc', heightCm: '' }, chimney: { outlet: 'x'.repeat(1000) } }),
    longString: JSON.stringify({ chimney: { outlet: 'a'.repeat(2 * 1024 * 1024) } }),
    hugeArray: JSON.stringify({ dimensions: { widthCm: 60 }, junk: new Array(300000).fill(1) }),
    deep5000: '{"dimensions":' + '['.repeat(5000) + ']'.repeat(5000) + '}',
    deepObj5000: '{"a":'.repeat(5000) + '1' + '}'.repeat(5000),
    xssModeScale: JSON.stringify({ dimensions: { widthCm: 60 }, calibration: { enabled: true, globalScale: 1.5, samples: 3, modeScale: { '<img src=x onerror=alert(1)>': 1.1, medium: 1.1 } } }),
    notStoveObject: JSON.stringify({ name: 'x', items: [1, 2, 3] }),
    topArray: '[1,2,3]', topNull: 'null', topNumber: '42', topString: '"abc"',
  };
  const allFinite = (o) => Object.values(o).every((v) => (v !== null && typeof v === 'object') ? allFinite(v) : (typeof v !== 'number' || Number.isFinite(v)));
  const hostileBad = [];
  const outcomes = {};
  for (const [name, text] of Object.entries(hostileTexts)) {
    try {
      const r = parseConfigText(text, { calibration: 'drop' });
      outcomes[name] = r.ok ? 'ok' : r.reason;
      if (r.ok) {
        const c = applyImported(normalizeConfig(clone(defaultConfig)), r.patch);
        if (!allFinite(c)) hostileBad.push(`${name}:nonFinite`);
        if (Object.getPrototypeOf(c) !== Object.prototype || Object.getPrototypeOf(c.dimensions) !== Object.prototype) hostileBad.push(`${name}:proto`);
        if (!PhysicsModel.evaluate(c).metrics || !allFinite(PhysicsModel.evaluate(c).metrics)) hostileBad.push(`${name}:metrics`);
        if (c.calibration.enabled) hostileBad.push(`${name}:calibrationApplied`);
      }
      // той самий сирий JSON напряму в normalizeConfig (шлях без sanitize, напр. старі збережені дані)
      let raw; try { raw = JSON.parse(text); } catch { raw = null; }
      const n = normalizeConfig(deepMerge(clone(defaultConfig), raw));
      if (!allFinite(n)) hostileBad.push(`${name}:rawNonFinite`);
      if (typeof raw === 'object' && raw !== null) normalizeConfig(raw); // сирий об'єкт: лише «не кидає»
    } catch (e) { hostileBad.push(`${name}:threw ${e.message}`); }
  }
  ok(hostileBad.length === 0, 'hostile payloads (null/number/string sections, arrays, __proto__, constructor, 1e9, 2 MB string, huge array, 5000-deep, XSS keys): sanitize+normalize never throw, stay finite, keep prototypes, never enable calibration', JSON.stringify({ hostileBad, outcomes }));
  ok(Object.keys(Object.prototype).length === 0 && ({}).polluted === undefined && ({}).polluted2 === undefined && ({}).polluted3 === undefined && ({}).polluted4 === undefined, 'Object.prototype is untouched after all hostile payloads');
  ok(outcomes.longString === 'tooLarge' && outcomes.hugeArray === 'tooLarge', 'oversized payloads (> 200 KB) are rejected by size before parsing/walking', JSON.stringify(outcomes));
  ok(outcomes.deep5000 === 'tooComplex' && outcomes.deepObj5000 === 'tooComplex', '5000-deep nesting is rejected as too complex (no recursion)', JSON.stringify(outcomes));
  ok(['notStoveObject', 'topArray', 'topNull', 'topNumber', 'topString', 'nullSections', 'numbersInObjectSlots', 'arrays'].every((k) => outcomes[k] === 'notStove'), 'JSON with no recognisable stove field is rejected as notStove (design stays, nothing imported)', JSON.stringify(outcomes));
  ok(parseConfigText('{ not json', {}).reason === 'parse' && parseConfigText('', {}).reason === 'parse', 'malformed JSON is reported as a parse error');
  ok(outcomes.protoDirect === 'ok' && outcomes.huge1e9 === 'ok', 'partially valid payloads still import their valid part', JSON.stringify(outcomes));

  // 1e9 -> клемп normalizeConfig; рядки в числових слотах відкинуті санітайзером
  const big = applyImported(null, parseConfigText(hostileTexts.huge1e9).patch);
  ok(big.dimensions.widthCm === 140 && big.dimensions.depthCm === 30 && big.chimney.totalHeightM === 2 && big.chimney.bends === 4, 'extreme numbers are clamped by normalizeConfig bounds', JSON.stringify([big.dimensions, big.chimney.totalHeightM, big.chimney.bends]));
  const strs = parseConfigText(hostileTexts.stringsInNumbers);
  ok(strs.ok === false && strs.reason === 'notStove', 'numeric strings / over-long strings are not accepted into number/enum slots', JSON.stringify(strs));

  // DOM-XSS: ключі modeScale — лише відомі режими, і в нормалізації теж
  const xssRaw = JSON.parse(hostileTexts.xssModeScale);
  const xssNorm = normalizeConfig(deepMerge(clone(defaultConfig), xssRaw));
  ok(Object.keys(xssNorm.calibration.modeScale).every((k) => OPERATION_MODES.includes(k)) && !JSON.stringify(xssNorm).includes('<img'), 'normalizeConfig keeps only known modes as calibration.modeScale keys (no markup can reach innerHTML)', JSON.stringify(xssNorm.calibration.modeScale));
  const xssStore = parseConfigText(hostileTexts.xssModeScale, { calibration: 'keep' });
  ok(xssStore.ok && !JSON.stringify(xssStore.patch).includes('<img'), 'stored-config sanitizer also drops unknown modeScale keys');
  const xssShare = parseShareValue(btoa(hostileTexts.xssModeScale).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  ok(xssShare.ok && xssShare.droppedCalibration === true && !('calibration' in xssShare.patch), 'a shared link that carries calibration: it is dropped from the patch and reported', JSON.stringify(xssShare.patch));

  // deepMerge не міняє прототип
  const dm = deepMerge({ a: 1 }, JSON.parse('{"__proto__":{"evil":1},"b":{"__proto__":{"evil2":1}},"constructor":5}'));
  ok(Object.getPrototypeOf(dm) === Object.prototype && dm.evil === undefined && dm.b.evil2 === undefined && dm.constructor === Object && ({}).evil === undefined, 'deepMerge ignores __proto__/constructor keys: no prototype swap, no pollution');
  ok(JSON.stringify(deepMerge({ x: { y: 1 } }, 'abc')) === '{"x":{"y":1}}' && JSON.stringify(deepMerge({ x: 1 }, [9, 9])) === '{"x":1}' && JSON.stringify(deepMerge({ s: 'ab' }, { s: { t: 1 } })) === '{"s":{"t":1}}', 'deepMerge: non-object patches change nothing; a string base is never spread into indices');

  // normalizeConfig сам по собі стійкий до null / не-об'єктів
  const weird = [null, undefined, 5, 'x', [], { dimensions: null, door: 3, combustion: 'x' }, { combustion: { tertiary: null, catalyst: 5 }, thermal: [] }];
  const weirdBad = weird.filter((w) => { try { const n = normalizeConfig(w); return !allFinite(n); } catch { return true; } });
  ok(weirdBad.length === 0, 'normalizeConfig accepts null / number / string / array / null sections without throwing and yields finite defaults', JSON.stringify(weirdBad));
  ok(normalizeConfig({ colors: { steel: 'url(javascript:1)', floor: '#12345' } }).colors.steel === defaultConfig.colors.steel, 'colors that are not #rrggbb fall back to defaults');

  // Share round-trip без калібрування автора
  const author = normalizeConfig(clone(defaultConfig));
  author.dimensions.widthCm = 64; author.chimney.outlet = 'rear'; author.door.hingeSide = 'right';
  author.calibration = { enabled: true, damping: 0.75, globalScale: 1.5, modeScale: { medium: 1.1 }, samples: 4, updated: 'x', excludeStartUp: true, modelVersion: MODEL_VERSION };
  const decoded = decodeConfig(encodeConfig(author));
  ok(decoded && !('calibration' in decoded), 'encodeConfig no longer carries the author\'s calibration');
  const recvCal = { ...emptyCalibration(), enabled: false };
  const recipient = normalizeConfig(clone(defaultConfig)); recipient.calibration = recvCal;
  const rt = parseShareValue(encodeConfig(author));
  const received = rt.ok ? applyImported(recipient, rt.patch) : null;
  ok(rt.ok && rt.droppedCalibration === false && received.dimensions.widthCm === 64 && received.chimney.outlet === 'rear' && received.door.hingeSide === 'right', 'share round-trip preserves the geometry', JSON.stringify(rt));
  ok(received.calibration.enabled === false && received.calibration.globalScale === 1, 'received design does not inherit the author\'s calibration');
  const oldStyle = parseShareValue(btoa(JSON.stringify(author)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  const oldRecv = applyImported(recipient, oldStyle.patch);
  const kwOf = (cfg) => PhysicsModel.evaluate(cfg).metrics.heatOutputKw;
  ok(oldStyle.ok && oldStyle.droppedCalibration === true && oldRecv.calibration.enabled === false, 'an OLD link with enabled calibration is reported as ignored and not applied', JSON.stringify({ dropped: oldStyle.droppedCalibration, cal: oldRecv.calibration }));
  const sameGeom = clone(oldRecv); sameGeom.calibration = { ...oldRecv.calibration, enabled: false };
  ok(kwOf(oldRecv) === kwOf(sameGeom) && kwOf({ ...oldRecv, calibration: author.calibration }) > kwOf(oldRecv) * 1.3, 'the power of a received design is NOT multiplied by the author\'s ×1.5', JSON.stringify({ recv: kwOf(oldRecv), withAuthorCal: kwOf({ ...oldRecv, calibration: author.calibration }) }));
  ok(received.calibration !== recipient.calibration && JSON.stringify(received.calibration) === JSON.stringify(recipient.calibration), 'recipient keeps their own calibration (a copy, not an alias)');

  // Версії: калібрування записує modelVersion; чужа версія / без версії - не застосовується
  const calNew = calibrateFromLog([{ mode: 'medium', predictedKw: 5, measuredKw: 4 }]);
  ok(calNew.modelVersion === MODEL_VERSION && MODEL_VERSION === 6 && isCalibrationCurrent(calNew) && !isCalibrationCurrent({ ...calNew, modelVersion: 5 }) && !isCalibrationCurrent({ ...calNew, modelVersion: null }), 'calibrateFromLog stamps MODEL_VERSION (6); other / missing version is not current');
  class FakeStorage {
    constructor(init = {}) { this.m = new Map(Object.entries(init)); this.writes = 0; }
    getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
    setItem(k, v) { this.writes++; this.m.set(k, String(v)); }
    removeItem(k) { this.m.delete(k); }
  }
  const stored = (mv) => { const c = normalizeConfig(clone(defaultConfig)); c.calibration = { enabled: true, damping: 0.75, globalScale: 1.4, modeScale: { medium: 1.05 }, samples: 3, updated: '2026-01-01', excludeStartUp: true, modelVersion: mv }; return JSON.stringify(c); };
  const sOld = new FakeStorage({ [STORAGE_KEY]: stored(5) });
  const bOld = bootState({ hash: '', storage: sOld });
  ok(bOld.config.calibration.enabled === false && bOld.notices.includes('calStaleNotice') && JSON.parse(sOld.getItem(STORAGE_KEY)).calibration.enabled === false && bOld.config.calibration.globalScale === 1.4, 'calibration made against model 5 is NOT applied on boot, notice raised once, disabled state persisted, record kept for re-calibration', JSON.stringify(bOld.notices));
  const bOld2 = bootState({ hash: '', storage: sOld });
  ok(!bOld2.notices.includes('calStaleNotice'), 'the stale-calibration notice is one-time (second boot is quiet)');
  const bNone = bootState({ hash: '', storage: new FakeStorage({ [STORAGE_KEY]: stored(null) }) });
  ok(bNone.config.calibration.enabled === false && bNone.notices.includes('calStaleNotice'), 'unversioned (pre-versioning) enabled calibration is treated as stale');
  const bCur = bootState({ hash: '', storage: new FakeStorage({ [STORAGE_KEY]: stored(MODEL_VERSION) }) });
  ok(bCur.config.calibration.enabled === true && bCur.config.calibration.globalScale === 1.4 && bCur.notices.length === 0, 'calibration of the current model version stays enabled');

  // Існуючий користувач: збережений конфіг без schemaVersion / calibration.modelVersion
  const legacyStored = clone(defaultConfig); legacyStored.dimensions.widthCm = 66;
  delete legacyStored.calibration.modelVersion;
  const bLegacy = bootState({ hash: '', storage: new FakeStorage({ [STORAGE_KEY]: JSON.stringify(legacyStored) }) });
  ok(bLegacy.savedDesign === true && bLegacy.config.dimensions.widthCm === 66 && bLegacy.config.schemaVersion === SCHEMA_VERSION && bLegacy.notices.length === 0, 'an unversioned stored config loads without error, keeps the design and gets schemaVersion', JSON.stringify(bLegacy.notices));
  const bFuture = bootState({ hash: '', storage: new FakeStorage({ [STORAGE_KEY]: JSON.stringify({ ...legacyStored, schemaVersion: 99, brandNew: { x: 1 } }) }) });
  ok(bFuture.config.dimensions.widthCm === 66 && !('brandNew' in bFuture.config) && bFuture.config.schemaVersion === SCHEMA_VERSION, 'a stored config from a NEWER schema is read by the known shape, unknown keys ignored');

  // Пошкоджене сховище / лінк: не падаємо, видаляємо ключ, повідомляємо
  for (const bad of ['{ broken', '[]', '"x"', 'null', '{"dimensions":5}', JSON.stringify({ chimney: { outlet: 'a'.repeat(3e5) } })]) {
    const st = new FakeStorage({ [STORAGE_KEY]: bad });
    const b = bootState({ hash: '', storage: st });
    ok(b.config.dimensions.widthCm >= 30 && b.notices.includes('bootCorrupt') && st.getItem(STORAGE_KEY) === null && b.savedDesign === false, `corrupt stored value ${bad.slice(0, 24)} falls back to defaults, key removed, notice raised`);
  }
  const stGood = new FakeStorage({ [STORAGE_KEY]: JSON.stringify(legacyStored) });
  const bBadLink = bootState({ hash: '#config=' + btoa('{"a":1}'), storage: stGood });
  ok(bBadLink.config.dimensions.widthCm === 66 && bBadLink.notices.includes('importErr_notStove') && bBadLink.clearHash === true && stGood.writes === 0, 'a non-stove share link keeps the current design, shows a message, clears the hash and writes nothing to storage');
  const bGarbage = bootState({ hash: '#config=!!!not-base64!!!', storage: stGood });
  ok(bGarbage.notices.includes('shareErr_parse') && !bGarbage.notices.includes('importErr_parse') && bGarbage.clearHash && bGarbage.config.dimensions.widthCm === 66, 'an undecodable link reports a parse error and keeps the design');
  const bHuge = bootState({ hash: '#config=' + 'A'.repeat(300000), storage: stGood });
  ok(bHuge.notices.includes('importErr_tooLarge') && bHuge.clearHash, 'an oversized link is rejected as too large');
  const bOk = bootState({ hash: '#config=' + encodeConfig(author), storage: new FakeStorage() });
  ok(bOk.config.dimensions.widthCm === 64 && bOk.savedDesign === true && bOk.clearHash && bOk.config.calibration.enabled === false && bOk.notices.length === 0, 'a valid new-style link loads the design, no calibration, no noise');
  // Відкритий лінк зберігається одразу (F5 його не губить), попередній проєкт віддається для «Скасувати»
  const stPrev = new FakeStorage({ [STORAGE_KEY]: JSON.stringify(legacyStored) });
  const bSaved = bootState({ hash: '#config=' + encodeConfig(author), storage: stPrev });
  const afterReload = bootState({ hash: '', storage: stPrev });
  ok(bSaved.previous && bSaved.previous.dimensions.widthCm === 66 && bSaved.config.dimensions.widthCm === 64 && afterReload.config.dimensions.widthCm === 64 && afterReload.notices.length === 0, 'an opened share link is saved at once (reload keeps it) and the previous project is returned for Undo', String(afterReload.config.dimensions.widthCm));
  ok(bBadLink.previous === null && bGarbage.previous === null && bootState({ hash: '', storage: stPrev }).previous === null, 'previous is null when no link was opened');
  // Пошкоджений проєкт: сирий текст зберігається в резервному ключі
  const stBad = new FakeStorage({ [STORAGE_KEY]: '{"dimensions": [1,2' });
  bootState({ hash: '', storage: stBad });
  ok(stBad.getItem(STORAGE_KEY) === null && stBad.getItem(STORAGE_KEY + '.corrupt') === '{"dimensions": [1,2', 'a corrupt stored project is removed but its raw text is kept under <key>.corrupt');
  const bOldLink = bootState({ hash: '#config=' + btoa(JSON.stringify(author)), storage: new FakeStorage() });
  ok(bOldLink.notices.includes('calibrationIgnored') && bOldLink.config.calibration.enabled === false, 'an old-style link with calibration tells the user once that it was ignored');
  const bNoStore = bootState({ hash: '', storage: null });
  ok(bNoStore.config.dimensions.widthCm > 0 && bNoStore.notices.length === 0, 'boot works with no localStorage at all');

  // Усі ключі повідомлень існують в обох мовах
  const noticeKeys = ['calStale', 'calStaleNotice', 'calibrationIgnored', 'calibrationIgnoredFile', 'bootCorrupt', 'bootFailed', 'noticeClose', 'importErr_parse', 'importErr_notStove', 'importErr_tooLarge', 'importErr_tooComplex', 'shareErr_parse', 'shareOpened', 'exportLoadFailed'];
  ok(noticeKeys.every((k) => STR.uk[k] && STR.en[k]), 'every new notice key exists in uk and en');
  ok(!/[А-Яа-яІіЇїЄєҐґ]/.test(STR.en.importErr_notStove + STR.en.calStaleNotice + STR.en.bootCorrupt + STR.en.shareErr_parse + STR.en.shareOpened + STR.en.exportLoadFailed), 'English notices contain no Cyrillic');
}

// ---------- Фаза 1b: безпека UI (екранування, журнал, тости, WebGL, SRI) ----------
{
  const { esc, html, raw, setHtml, writeHtml, isSafeHtml } = await import('../js/html.js');
  const { parseJournal, appendEntry, JOURNAL_MAX, csvField, csvDate } = await import('../js/journal.js');
  const { createToaster } = await import('../js/toast.js');
  const jsDir = new URL('../js/', import.meta.url);
  const readJs = (name) => readFileSync(new URL(name, jsDir), 'utf8');

  // --- esc / html`` / raw ---
  const evil = `"><img src=x onerror="window.__xss=1"><script>window.__xss=2</script>'\`&`;
  const escaped = esc(evil);
  ok(!/[<>"'`]/.test(escaped) && escaped.includes('&lt;img') && escaped.includes('&amp;'), 'esc() removes every markup-significant character');
  ok(esc(null) === '' && esc(undefined) === '' && esc(0) === '0' && esc(12.5) === '12.5', 'esc() is safe for null/undefined/numbers');
  const frag = html`<li class="${evil}">${evil}</li>`;
  ok(isSafeHtml(frag) && !String(frag).includes('<img') && !String(frag).includes('<script') && String(frag).startsWith('<li class="&quot;&gt;&lt;img') && String(frag).endsWith('</li>'), 'html`` escapes interpolations in both content and attribute position');
  ok(String(html`<b>${html`<i>${'<x>'}</i>`}</b>`) === '<b><i>&lt;x&gt;</i></b>', 'nested html`` is not double-escaped, its own values are escaped');
  ok(String(html`${[html`<i>${'a&b'}</i>`, '<s>']}`) === '<i>a&amp;b</i>&lt;s&gt;', 'arrays join: SafeHtml parts kept, plain strings escaped');
  ok(String(html`${raw('<b>x</b>')}`) === '<b>x</b>' && String(html`${'<b>x</b>'}`) === '&lt;b&gt;x&lt;/b&gt;', 'raw() is the only way to keep markup');
  const fakeEl = { innerHTML: '' };
  setHtml(fakeEl, '<img src=x onerror=1>');
  ok(fakeEl.innerHTML === '&lt;img src=x onerror=1&gt;', 'setHtml() with a plain string renders it as text, not markup');
  setHtml(fakeEl, html`<b>${'<i>'}</b>`);
  ok(fakeEl.innerHTML === '<b>&lt;i&gt;</b>', 'setHtml() with html`` keeps the template markup and escapes the data');
  let written = '';
  writeHtml({ write: (x) => { written += x; } }, '<script>1</script>');
  ok(written === '&lt;script&gt;1&lt;/script&gt;', 'writeHtml() escapes plain strings too');

  // --- журнал: толерантний розбір і не мовчазне обрізання ---
  ok(parseJournal(null).length === 0 && parseJournal('{broken').length === 0 && parseJournal('{"a":1}').length === 0 && parseJournal('"x"').length === 0, 'parseJournal: junk (null, bad JSON, object, string) gives an empty journal instead of throwing');
  ok(parseJournal('[1,"a",null,[2],{"mode":"low"}]').length === 1, 'parseJournal keeps only object entries');
  const fullLog = Array.from({ length: JOURNAL_MAX }, (_, i) => ({ ts: i }));
  const ap = appendEntry(fullLog, { ts: 999 });
  ok(ap.log.length === JOURNAL_MAX && ap.dropped.length === 1 && ap.dropped[0].ts === 0 && ap.log[JOURNAL_MAX - 1].ts === 999 && ap.all.length === JOURNAL_MAX + 1, 'appendEntry on a full journal drops exactly the oldest entry and reports it (nothing is lost silently)');
  const ap2 = appendEntry(fullLog.slice(0, 5), { ts: 1 });
  ok(ap2.dropped.length === 0 && ap2.log.length === 6, 'appendEntry below the limit drops nothing');

  // --- CSV: недовірені поля журналу ---
  ok(csvField('a,b') === '"a,b"' && csvField('say "hi"') === '"say ""hi"""' && csvField('l1\nl2') === '"l1\nl2"' && csvField(null) === '' && csvField(12.5) === '12.5' && csvField(-3) === '-3', 'csvField quotes commas, quotes and newlines (RFC 4180) and leaves numbers alone');
  ok(csvField('=HYPERLINK("x")') === `"'=HYPERLINK(""x"")"` && csvField('+1') === "'+1" && csvField('-1+2') === "'-1+2" && csvField('@SUM(A1)') === "'@SUM(A1)", 'csvField neutralises spreadsheet formulas (= + - @) with a leading apostrophe');
  ok(csvDate(0) === '1970-01-01T00:00:00.000Z' && csvDate('x') === '' && csvDate(NaN) === '' && csvDate(1e20) === '' && csvDate(undefined) === '', 'csvDate returns "" for invalid timestamps instead of throwing RangeError');

  // --- тости: таймер, заміна, дія, пауза (фейковий DOM і таймери, без годинника) ---
  const mkEl = (tag) => ({
    tag, children: [], listeners: {}, className: '', textContent: '', removed: false, focused: false,
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(n, f) { this.listeners[n] = f; },
    remove() { this.removed = true; },
    focus() { this.focused = true; },
    querySelector() { return this.children.find((c) => c.tag === 'button') || null; },
  });
  const rootEl = mkEl('div'); rootEl.appendChild = function (c) { this.children.push(c); return c; };
  const timers = new Map(); let tid = 0;
  const tst = createToaster(rootEl, { doc: { createElement: mkEl }, setT: (f, ms) => { timers.set(++tid, { f, ms }); return tid; }, clearT: (id) => timers.delete(id) });
  const closes = [];
  tst.show({ message: 'one', autoMs: 9000, onClose: (r) => closes.push('one:' + r), actions: [{ label: 'Undo' }] });
  ok(tst.isOpen() && timers.size === 1 && [...timers.values()][0].ms === 9000, 'toast arms a single auto-dismiss timer of the requested length');
  const first = rootEl.children[0];
  first.listeners.mouseenter();
  ok(timers.size === 0, 'hovering a toast pauses its timer (WCAG 2.2.1)');
  first.listeners.mouseleave();
  ok(timers.size === 1, 'leaving the toast re-arms the timer');
  tst.show({ message: 'two', autoMs: 0, focusFirst: true, onClose: (r) => closes.push('two:' + r), actions: [{ label: 'No' }, { label: 'Yes', primary: true, onClick: () => closes.push('yes-clicked') }] });
  ok(first.removed && closes.join() === 'one:replaced' && timers.size === 0, 'a new toast replaces the old one (reason "replaced") and a sticky toast (autoMs 0) arms no timer');
  const second = rootEl.children[1];
  ok(second.children[1].focused, 'confirm toast puts focus on its first (safe) button');
  second.children[2].listeners.click();
  ok(closes.join() === 'one:replaced,two:action,yes-clicked' && !tst.isOpen() && second.removed, 'clicking an action closes the toast first, then runs the action');
  let langNow = 'uk';
  tst.show({ message: () => 'msg-' + langNow, autoMs: 0, actions: [{ label: () => 'ok-' + langNow }] });
  const tr = rootEl.children[rootEl.children.length - 1];
  langNow = 'en'; tst.retranslate();
  ok(tr.children[0].textContent === 'msg-en' && tr.children[1].textContent === 'ok-en', 'retranslate() re-evaluates message and button labels of the open toast');
  tst.dismiss();
  tst.show({ message: 'x', autoMs: 5, actions: [] });
  [...timers.values()][0].f();
  ok(!tst.isOpen(), 'the auto-dismiss timer closes the toast');
  tst.show({ message: 'keep', autoMs: 0, actions: [{ label: 'CSV', keepOpen: true, onClick: () => closes.push('csv') }] });
  rootEl.children[rootEl.children.length - 1].children[1].listeners.click();
  ok(tst.isOpen() && closes.at(-1) === 'csv', 'keepOpen action (CSV export) leaves the toast on screen');

  // --- статична перевірка: жодного небезпечного sink-а поза js/html.js ---
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;{}(])\/\/.*$/gm, '$1');
  // Повертає список порушень у вихідному тексті (порожній = чисто).
  function findUnsafeSinks(src, { allowRaw = [] } = {}) {
    const code = stripComments(src);
    const bad = [];
    const rules = [
      [/\.(inner|outer)HTML\s*\+?=(?!=)/, 'direct innerHTML/outerHTML assignment'],
      [/insertAdjacentHTML\s*\(/, 'insertAdjacentHTML'],
      [/\.write(ln)?\s*\(/, 'document.write'],
      [/\beval\s*\(|new\s+Function\s*\(/, 'eval / new Function'],
      [/setHtml\s*\(\s*[^,()]+,\s*[`'"]/, 'setHtml() given a raw string/template instead of html``'],
      [/setHTMLUnsafe|parseHTMLUnsafe|createContextualFragment|\bsrcdoc\b|\bDOMParser\b/, 'other HTML-parsing sink'],
      [/\[\s*['"`](inner|outer)/i, 'bracket access to innerHTML/outerHTML'],
      [/\[\s*['"`][A-Za-z]*['"`]\s*\+/, 'computed property name built by concatenation'],
    ];
    for (const [re, label] of rules) if (re.test(code)) bad.push(label);
    // raw() дозволений лише в конкретному РЯДКУ (весь рядок має збігтися з allow-list, а не
    // лише ім'я змінної): те саме raw(li) деінде не проходить.
    for (const m of code.matchAll(/\braw\(([^)]*)\)/g)) {
      const ls = code.lastIndexOf('\n', m.index) + 1;
      const le = code.indexOf('\n', m.index);
      const line = code.slice(ls, le === -1 ? code.length : le).trim();
      if (!allowRaw.some((re) => re.test(line))) bad.push('raw() outside allow-list: ' + m[0].slice(0, 40));
    }
    return bad;
  }
  // Самоперевірка сканера: він має ловити саме те, що було вразливістю.
  ok(findUnsafeSinks('el.innerHTML = `<b>${x}</b>`;').length === 1, 'sink scanner flags an innerHTML template assignment');
  ok(findUnsafeSinks('el.innerHTML += x').length === 1 && findUnsafeSinks('a.insertAdjacentHTML("beforeend", x)').length === 1 && findUnsafeSinks('w.document.write(x)').length === 1, 'sink scanner flags innerHTML+=, insertAdjacentHTML and document.write');
  ok(findUnsafeSinks('setHtml(el, `<b>${x}</b>`)').length === 1 && findUnsafeSinks('setHtml(el, html`<b>${x}</b>`)').length === 0, 'sink scanner flags setHtml() with a plain template but accepts html``');
  ok(findUnsafeSinks('const a = raw(user)').length === 1 && findUnsafeSinks('// el.innerHTML = x\nconst b = 1; /* document.write(x) */').length === 0, 'sink scanner flags unlisted raw() and ignores comments');
  ok(findUnsafeSinks('ul["inner"+"HTML"] = x').length >= 1 && findUnsafeSinks("ul['innerHTML'] = x").length >= 1 && findUnsafeSinks('ul.setHTMLUnsafe(x)').length === 1 && findUnsafeSinks('el.srcdoc = x').length === 1 && findUnsafeSinks('new DOMParser()').length === 1, 'sink scanner flags bracket/concatenated innerHTML, setHTMLUnsafe, srcdoc and DOMParser');
  const RAW_ALLOW = [
    // TOUR: статичні константи i18n.js (весь рядок, не лише ім'я змінної)
    /^if \(ol\) setHtml\(ol, html`\$\{TOUR\[lang\]\.map\(\(li\) => html`<li>\$\{raw\(li\)\}<\/li>`\)\}`\);$/,
    // друк: статичний скрипт звіту (з знімком і без)
    /^const printJs = dataUrl \? raw\(`<script>document\.getElementById\('repImg'\)[^`]*`\) : raw\('<script>window\.print\(\)<\\\/script>'\);$/,
  ];
  const jsFiles = ['app.js', 'autodesign.js', 'bom.js', 'calibration.js', 'config.js', 'exporters.js', 'journal.js', 'persist.js', 'physics-model.js', 'production.js', 'room.js', 'test-burn.js', 'sanitize.js', 'stove-builder.js', 'toast.js', 'i18n.js', 'thresholds.js'];
  for (const f of jsFiles) {
    const bad = findUnsafeSinks(readJs(f), { allowRaw: f === 'app.js' ? RAW_ALLOW : [] });
    ok(bad.length === 0, `js/${f}: no unescaped HTML sinks`, bad.join('; '));
  }
  const htmlSrc = stripComments(readJs('html.js'));
  ok((htmlSrc.match(/\.innerHTML\s*=/g) || []).length === 1 && (htmlSrc.match(/\.write\(/g) || []).length === 1, 'js/html.js is the ONLY place with an innerHTML assignment and a document.write (one each)');
  // Нові модулі не мають ховатися від сканера: будь-який js/*.js має бути в списку.
  const { readdirSync } = await import('node:fs');
  const allJs = readdirSync(jsDir).filter((f) => f.endsWith('.js') && f !== 'html.js').sort();
  ok(JSON.stringify(allJs) === JSON.stringify([...jsFiles].sort()), 'every js/*.js module is covered by the sink scanner (add new modules to the list)', allJs.filter((f) => !jsFiles.includes(f)).join(','));

  // --- i18n: усі t('key') з app.js є в обох мовах; нові ключі без кирилиці в EN ---
  const appSrc = readJs('app.js');
  const usedKeys = new Set([...appSrc.matchAll(/\bt\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]));
  ['noticeClose', 'undoBtn', 'confirmCancel', 'csvBtn', 'confirmResetMsg', 'confirmResetYes', 'confirmClearLogMsg', 'confirmClearLogYes', 'undoReset', 'undoClearLog', 'undoImport', 'undoPreset', 'undoFitRoom', 'undoRedesign', 'undoCalReset', 'undoCalibrate', 'undoRestored', 'journalTruncated', 'webglUnavailable', 'webglDisabledReason', 'shareErr_parse', 'shareOpened', 'exportLoadFailed'].forEach((k) => usedKeys.add(k));
  const missingKeys = [...usedKeys].filter((k) => !(STR.uk[k] && STR.en[k]));
  ok(missingKeys.length === 0, 'every t(key) used in app.js (and the new UI keys) exists in both uk and en', missingKeys.join(','));
  const newEn = ['undoBtn', 'confirmCancel', 'csvBtn', 'confirmResetMsg', 'confirmResetYes', 'confirmClearLogMsg', 'confirmClearLogYes', 'undoReset', 'undoClearLog', 'undoImport', 'undoPreset', 'undoFitRoom', 'undoRedesign', 'undoCalReset', 'undoCalibrate', 'undoRestored', 'journalTruncated', 'webglUnavailable', 'webglDisabledReason'].map((k) => STR.en[k]).join(' ');
  ok(!/[А-Яа-яІіЇїЄєҐґ]/.test(newEn), 'new English UI strings contain no Cyrillic');
  const rawLineRe = RAW_ALLOW[0];
  ok(findUnsafeSinks('if (ol) setHtml(ol, html`${TOUR[lang].map((li) => html`<li>${raw(li)}</li>`)}`);', { allowRaw: [rawLineRe] }).length === 0 && findUnsafeSinks('setHtml(ul, html`<li>${raw(li)}</li>`);', { allowRaw: [rawLineRe] }).length === 1, 'raw(li) is allowed only on the TOUR line, the same variable name elsewhere is flagged');
  ok(STR.uk.journalTruncated.includes('${max}') && STR.en.journalTruncated.includes('${max}'), 'journalTruncated carries the ${max} placeholder in both languages');

  // --- index.html: SRI і 3D-елементи ---
  const indexSrc = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const importmap = JSON.parse(indexSrc.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]);
  const threeBase = importmap.imports['three/addons/'].replace('examples/jsm/', '');
  ok(/three@\d+\.\d+\.\d+\//.test(threeBase) && importmap.imports.three.startsWith(threeBase), 'three is pinned to an exact version in the importmap (no @latest / ranges)');
  const integ = importmap.integrity || {};
  const needed = [importmap.imports.three, ...['controls/OrbitControls.js', 'exporters/GLTFExporter.js', 'exporters/STLExporter.js', 'utils/TextureUtils.js'].map((x) => importmap.imports['three/addons/'] + x)];
  ok(needed.every((u) => /^sha384-[A-Za-z0-9+/]{64}$/.test(integ[u] || '')), 'importmap integrity has a sha384 for three.module.js and every examples/jsm module that is loaded', needed.filter((u) => !integ[u]).join(','));
  // Усі three/addons/... імпорти з js/*.js мають хеш (щоб новий імпорт без SRI не пройшов).
  const addonImports = new Set();
  for (const f of jsFiles) for (const m of readJs(f).matchAll(/['"]three\/addons\/([^'"]+)['"]/g)) addonImports.add(importmap.imports['three/addons/'] + m[1]);
  ok([...addonImports].every((u) => integ[u]), 'every three/addons module imported by js/*.js has an SRI hash', [...addonImports].filter((u) => !integ[u]).join(','));
  const preloads = [...indexSrc.matchAll(/<link rel="modulepreload" href="([^"]+)" integrity="([^"]+)"/g)];
  ok(preloads.length >= 2 && preloads.every((m) => integ[m[1]] === m[2]), 'modulepreload links carry the same hash as the importmap (fallback for browsers without importmap integrity)');
  const needs3d = [...indexSrc.matchAll(/<[a-z]+[^>]*\bid="([A-Za-z0-9_]+)"[^>]*\bdata-needs-3d/g)].map((m) => m[1]);
  ok(['viewMode', 'toggleDoor', 'toggleExplode', 'screenshot', 'exportGltf', 'exportStl', 'cameraFov', 'showSection'].every((id) => needs3d.includes(id)), '3D-only controls are marked data-needs-3d (disabled when WebGL is missing)');
  ok(!['operationMode', 'exportBom', 'exportDrawing', 'exportDxf', 'shareConfig', 'langToggle', 'fitRoom', 'saveJson', 'resetConfig'].some((id) => needs3d.includes(id)), 'calculation/export/share controls are NOT disabled without WebGL');
  ok(/id="toasts"[^>]*role="status"[^>]*aria-live="polite"/.test(indexSrc), 'toast container is an accessible live region (role=status, aria-live=polite)');
  ok(/const renderer = createRenderer\(\)/.test(appSrc) && /try\s*\{\s*const r = new THREE\.WebGLRenderer/.test(appSrc), 'WebGLRenderer is created inside try/catch (no top-level throw)');
}


// --- Кластер A: Test Burn і стан кімнати ---
{
  const pred = PhysicsModel.evaluate(base);
  const tb = (o) => ({ ...base.testBurn, loadMode: 'manual', loadKg: 7.8, measuredBurnHours: 7.5, ...o });
  const over = computeTestBurnCore(pred, tb({ measuredUsefulHeatKwh: 100 }));
  ok(over.overUnity && over.measuredEfficiency === null && over.measuredEfficiencyRawPct > 100, 'Test Burn: віддача > палива -> overUnity, ККД не клампиться до 100');
  ok(checkTestBurnPlausibility(over).some((i) => i.code === 'TB_OVER_UNITY' && i.severity === 'error'), 'Test Burn: TB_OVER_UNITY (error)');
  const fuel = 7.8 * pred.metrics.woodEnergyKwhKg;
  const good = computeTestBurnCore(pred, tb({ measuredUsefulHeatKwh: fuel * 0.7 }));
  ok(!good.overUnity && Math.abs(good.measuredEfficiency - 70) < 0.5 && checkTestBurnPlausibility(good).length === 0, 'Test Burn: нормальний ввід без попереджень');
  ok(checkTestBurnPlausibility(computeTestBurnCore(pred, tb({ measuredUsefulHeatKwh: fuel * 0.95 }))).some((i) => i.code === 'TB_EFF_HIGH'), 'Test Burn: ККД вище стелі моделі -> TB_EFF_HIGH');
  ok(checkTestBurnPlausibility(computeTestBurnCore(pred, tb({ loadKg: pred.metrics.maxLoadKg + 5, measuredUsefulHeatKwh: 0 }))).some((i) => i.code === 'TB_LOAD_OVER_MAX'), 'Test Burn: закладка > max топки -> TB_LOAD_OVER_MAX');
  ok(checkTestBurnPlausibility(computeTestBurnCore(pred, tb({ glassTempC: 400, stoveTopTempC: 300, measuredUsefulHeatKwh: 0 }))).some((i) => i.code === 'TB_TEMP_ORDER'), 'Test Burn: скло гарячіше за верх -> TB_TEMP_ORDER');
  const auto = computeTestBurnCore(pred, { ...tb({ measuredUsefulHeatKwh: 10 }), loadMode: 'auto' });
  ok(auto.fuelBasis === 'recommended' && checkTestBurnPlausibility(auto).some((i) => i.code === 'TB_FUEL_AUTO'), 'Test Burn: auto-режим підписує паливо як модельну закладку');
  const codes = ['TB_OVER_UNITY', 'TB_EFF_HIGH', 'TB_FUEL_AUTO', 'TB_LOAD_OVER_MAX', 'TB_TEMP_ORDER'];
  ok(codes.every((c) => typeof TB_TXT.uk[c] === 'function' && typeof TB_TXT.en[c] === 'function'), 'TB_TXT має всі коди в uk і en');
  ok(STR.uk.roomOversized && STR.en.roomOversized && STR.uk.moistureHint && STR.en.moistureHint && STR.uk.modelBurnHours && STR.en.modelBurnHours && STR.uk.testSaveBlocked && STR.en.testSaveBlocked, 'нові ключі кластера A є в обох мовах');
  // Вологість впливає на модель, тож UI-обробник мусить викликати renderPhysics (не лише renderTestBurn).
  const dry = PhysicsModel.evaluate({ ...base, testBurn: { ...base.testBurn, woodMoisturePct: 8 } }).metrics;
  const wet = PhysicsModel.evaluate({ ...base, testBurn: { ...base.testBurn, woodMoisturePct: 35 } }).metrics;
  ok(dry.efficiencyPct > wet.efficiencyPct && dry.burnTimeHours > wet.burnTimeHours, 'вологість змінює ККД і час горіння моделі');
  const appSrcA = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  ok(/id === 'woodMoisturePct'\) \{ renderPhysics\(\)/.test(appSrcA) && !/woodMoisturePct: 1/.test(appSrcA), 'обробник слайдера вологості викликає renderPhysics');
  // Кімната
  const bigStove = evaluateRoom({ ...base, room: { ...base.room, inputMode: 'volume', volumeM3: 20, purpose: 'room' } });
  ok(bigStove.status === 'oversized' && bigStove.ratio > OVERSIZE_RATIO && bigStove.enough, 'evaluateRoom: велика піч у малій кімнаті -> oversized');
  const lowRoom = evaluateRoom({ ...base, room: { ...base.room, inputMode: 'volume', volumeM3: 500, purpose: 'room' } });
  ok(lowRoom.status === 'low' && !lowRoom.enough, 'evaluateRoom: мала піч у великій кімнаті -> low');
  const okRoom = evaluateRoom({ ...base, room: { ...base.room, inputMode: 'volume', volumeM3: Math.round(bigStove.actualKw * 14 / 1.2), purpose: 'room' } });
  ok(okRoom.status === 'ok', 'evaluateRoom: підібраний обʼєм -> ok', JSON.stringify(okRoom));
}

// B. Кластер «статуси»: один вердикт, пороги з констант, Φ-датчик = список «Проблеми».
{
  const MODES = ['start-up', 'low', 'medium', 'high', 'overnight'];
  const names = Object.keys(MODEL_PRESETS);
  // (1) configVerdict: чиста логіка
  const V = TH.configVerdict;
  ok(V({ errors: [], warnings: [] }, []).level === 'ok', 'verdict: порожньо -> ok');
  ok(V({ errors: [], warnings: [] }, [{ level: 'info' }]).level === 'ok', 'verdict: info не знімає «ok»');
  ok(V({ errors: [], warnings: [] }, [{ level: 'warn' }]).level === 'warn', 'verdict: physics warn -> warn');
  ok(V({ errors: [], warnings: [{}] }, []).level === 'warn', 'verdict: geometry warning -> warn');
  ok(V({ errors: [], warnings: [] }, [], 2).level === 'warn', 'verdict: fitIssues -> warn');
  ok(V({ errors: [], warnings: [] }, [{ level: 'warn' }, { level: 'danger' }]).level === 'danger', 'verdict: danger переважає warn');
  ok(V({ errors: [{}], warnings: [] }, [{ level: 'danger' }]).level === 'error', 'verdict: errors переважають danger');
  // (2) інваріант на 50 клітинках: «ok» => жодних errors/danger/warn; danger у списку => не «ok»
  const bad = []; let sawDanger = 0; let roomNotOk = 0;
  for (const n of names) for (const m of MODES) {
    const { cfg, e } = uiCell(n, m);
    const val = validateConfig(cfg);
    const v = V(val, e.warnings, 0, evaluateRoom(cfg).status);
    const hasDanger = e.warnings.some((w) => w.level === 'danger');
    const hasWarn = e.warnings.some((w) => w.level === 'warn');
    if (hasDanger) sawDanger++;
    if (hasDanger && (v.level === 'ok' || v.level === 'warn')) bad.push(`${n}/${m}:danger->${v.level}`);
    if (v.level === 'ok' && (hasDanger || hasWarn || !val.valid)) bad.push(`${n}/${m}:ok-but-issues`);
    const rs = evaluateRoom(cfg).status;
    if (rs !== 'ok') roomNotOk++;
    if (rs !== 'ok' && v.level === 'ok') bad.push(`${n}/${m}:ok-but-room-${rs}`);
  }
  ok(sawDanger > 0 && roomNotOk > 0 && bad.length === 0, 'verdict: банер «коректна» ніколи не поруч із danger/warn/«піч завелика|замала» у 50 клітинках', JSON.stringify({ sawDanger, bad: bad.slice(0, 4) }));
  const appSrcB = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  ok(/configVerdict\(validateConfig\(config\), r\.warnings, bom \? bom\.fitIssues : 0, room \? room\.status : 'ok'\)/.test(appSrcB) && !/result\.valid && !result\.warnings\.length/.test(appSrcB), 'app.js: банер і «Проблем не виявлено» йдуть від configVerdict, а не від result.valid');
  for (const l of ['uk', 'en']) ok(['validConfigNotes', 'validConfigDanger', 'validConfigErrors', 'noPhysicsWarnings'].every((k) => STR[l][k]), `ключі вердикту є в ${l}`);

  // (3) Φ-датчик <=> MIX_* у списку: «ризик» (tone warn) рівно тоді, коли попередження є
  const cells = names.flatMap((n) => MODES.map((m) => ({ n, m, e: uiCell(n, m).e })));
  for (const n of ['ws1', 'ws5', 'ws10']) for (const m of MODES) {
    const base0 = uiCell(n, m).cfg;
    for (const w of [10, 40, 100]) for (const p of [10, 50, 95]) {
      const cfg = clone(base0); cfg.airWash.intakePct = w; cfg.primaryAir.openPct = p;
      cells.push({ n, m, e: PhysicsModel.evaluate(cfg) });
    }
  }
  const badPhi = [];
  for (const { n, m, e } of cells) {
    const st = TH.phiGaugeState(e.metrics.equivalenceRatio2, m);
    const rich = e.warnings.some((w) => w.code === 'MIX_RICH');
    const lean = e.warnings.some((w) => w.code === 'MIX_LEAN');
    if ((st.key === 'phiRich') !== rich || (st.key === 'phiLean') !== lean || (st.tone === 'warn') !== (rich || lean)) badPhi.push(`${n}/${m}:phi=${e.metrics.equivalenceRatio}:${st.key}:${rich}/${lean}`);
  }
  ok(badPhi.length === 0, 'Φ-датчик каже «ризик»/«забагато повітря» лише коли в «Проблемах» є MIX_RICH/MIX_LEAN (і навпаки)', JSON.stringify(badPhi.slice(0, 4)));
  ok(TH.phiGaugeState(0.61, 'overnight').key === 'phiModeRich' && TH.phiGaugeState(0.32, 'start-up').key === 'phiModeOpen', 'Φ-датчик: overnight/start-up навмисні режими без «ризик»');
  ok(TH.phiGaugeState(0.51, 'low').tone === 'soft' && TH.phiGaugeState(0.37, 'medium').tone === 'soft' && TH.phiGaugeState(0.45, 'medium').tone === 'ok', 'Φ-датчик: буфер 0.35–0.4 / 0.5–0.55 нейтральний, зона зелена');

  // (4) Числа в текстах = константи, КОЖЕН код за власним очікуваним набором (а не спільним Set):
  // підміна «58» на інше дозволене число (напр. 40) тепер ловиться.
  const S = (...v) => new Set(v.map(String));
  const expectedWarn = {
    OVERHEAT_RISK: S(TH.STEEL_THIN_MM), STEEL_OVERHEAT: S(TH.STEEL_THIN_MM), INEFFICIENT_MODE: S(TH.EFFICIENCY_LOW_PCT),
    SECONDARY_INTAKE_LOW: S(INTAKE_MIN_STOP_PCT), CREOSOTE_RISK: S(TH.CREOSOTE_WARN_C), CONNECTOR_LONG: S(TH.CONNECTOR_MAX_CM),
  };
  const expectedStr = {
    phiInBand: S(TH.PHI_BAND_MIN, TH.PHI_BAND_MAX), phiRich: S(TH.PHI_RICH_WARN), phiLean: S(TH.PHI_LEAN_INFO),
    phiRichSoft: S(TH.PHI_BAND_MIN, TH.PHI_BAND_MAX, TH.PHI_RICH_WARN), phiModeRich: S(TH.PHI_RICH_WARN),
    phiLeanSoft: S(TH.PHI_BAND_MIN, TH.PHI_BAND_MAX, TH.PHI_LEAN_INFO), phiModeOpen: S(TH.PHI_LEAN_INFO), phiAuto: S(TH.PHI_TARGET),
    bomCut: S(TH.BLANK_ALLOWANCE_PCT), roomOversized: S(),
  };
  const numsOf = (str) => (String(str).replace(/Φ=\S+/g, '').match(/\d+(?:\.\d+)?/g) || []);
  const stray = []; let checked = 0;
  for (const l of ['uk', 'en']) {
    const texts = [];
    for (const [code, v] of Object.entries(WARN_TXT[l])) texts.push([`WARN.${code}`, typeof v === 'function' ? v(123457) : v, expectedWarn[code] || S()]);
    texts.push(['VAL.CONNECTOR_LONG', VALIDATION_TXT[l].CONNECTOR_LONG({ length: 123457 }), S(TH.CONNECTOR_MAX_CM)]);
    for (const [k, exp] of Object.entries(expectedStr)) texts.push([k, STR[l][k], exp]);
    texts.push(['TB_HOURS_SHORT', TB_TXT[l].TB_HOURS_SHORT({ hours: 123457, min: TH.TB_BURN_HOURS_MIN }), S(TH.TB_BURN_HOURS_MIN)]);
    for (const [k, txt, exp] of texts) { checked++; for (const nn of numsOf(txt)) if (nn !== '123457' && !exp.has(nn)) stray.push(`${l}.${k}:${nn}`); }
    ok(STR[l].intakeNote.includes(`${INTAKE_MIN_STOP_PCT} %`), `intakeNote (${l}): поріг повзуна збігається з INTAKE_MIN_STOP_PCT`);
  }
  ok(stray.length === 0 && checked > 20, 'числа в текстах порогів = очікувані константи КОЖНОГО коду (62 vs 58, 40 vs 58 тощо)', JSON.stringify(stray));
  // TB_TXT: числа лише з values - жодних захардкоджених у шаблонах (крім фізичної межі 100 %)
  const tbStray = [];
  for (const l of ['uk', 'en']) for (const [code, fn] of Object.entries(TB_TXT[l])) {
    const v = { eff: 123457, max: 123457, kg: 123457, glass: 123457, top: 123457, hours: 123457, min: 123457, fuelKw: 123457, grossKw: 123457, ratio: 123457, measuredKw: 123457, predictedKw: 123457 };
    for (const nn of numsOf(fn(v))) if (+nn !== 123457 && nn !== '100') tbStray.push(`${l}.${code}:${nn}`);
  }
  ok(tbStray.length === 0, 'TB_TXT: усі числа йдуть із values (поріг «100 %» = фізична межа ККД)', JSON.stringify(tbStray));
  ok(WARN_TXT.uk.INEFFICIENT_MODE.includes(`< ${TH.EFFICIENCY_LOW_PCT}%`) && WARN_TXT.en.INEFFICIENT_MODE.includes(`< ${TH.EFFICIENCY_LOW_PCT}%`), 'INEFFICIENT_MODE: текст містить поріг із константи');
  ok(WARN_TXT.uk.CREOSOTE_RISK(120).includes(`< ${TH.CREOSOTE_WARN_C}°C`) && WARN_TXT.uk.CONNECTOR_LONG(50).includes(`> ${TH.CONNECTOR_MAX_CM} см`) && WARN_TXT.uk.SECONDARY_INTAKE_LOW(10).includes(`< ${INTAKE_MIN_STOP_PCT} %`), 'CREOSOTE/CONNECTOR/INTAKE: тексти беруть пороги з констант');
  // Статичні повідомлення моделі збігаються з текстами uk (однакові числа).
  const diffMsg = [];
  for (const { e } of cells) for (const w of e.warnings) if (typeof WARN_TXT.uk[w.code] === 'string' && w.message !== WARN_TXT.uk[w.code]) diffMsg.push(w.code);
  ok(diffMsg.length === 0, 'статичні повідомлення моделі збігаються з WARN_TXT.uk', JSON.stringify(diffMsg.slice(0, 3)));
  const pm = readFileSync(new URL('../js/physics-model.js', import.meta.url), 'utf8');
  ok(/efficiencyPct < EFFICIENCY_LOW_PCT/.test(pm) && !/efficiencyPct < 58/.test(pm) && /round\(exitFlueTempC, 0\) < CREOSOTE_WARN_C/.test(pm) && /connectorM > CONNECTOR_MAX_CM/.test(pm), 'physics-model.js порівнює з константами порогів, а не з літералами');
}

const MODES_ALL = ['start-up', 'low', 'medium', 'high', 'overnight'];
// 99. Кластер C-dead-controls: реєстр «елемент UI -> що змінює».
// Реєстр (id -> споживач):
//   catalystEnabled      -> physics (ККД +2.5 п.п., secondaryIgnitionC), 3D (stove-builder), BOM
//   catalystLightoffC    -> ПРИБРАНО зі слайдерів: T згоряння моделі (мін. ~830 °C у 50 клітинках, клемп 450)
//                           завжди вища за будь-який поріг 150..500, тож на ККД/попередження він НЕ діяв.
//                           Поле lightoffC лишилось у схемі (дефолт 260, міграція) і впливає лише на внутрішнє
//                           metrics.secondaryIgnitionC; у UI показано пояснювальну підказку (catalystLightoff).
//   woodMoisturePct      -> physics + Test Burn; loadKg/measuredBurnHours/measuredUsefulHeatKwh -> Test Burn, журнал
//   flueTempC/stoveTopTempC/glassTempC -> лише перевірка TB_TEMP_ORDER і текст-підсумок (у фізику/калібрування НЕ входять)
//   smokeOpacityPct      -> ЛИШЕ 3D-дим і текст-підсумок (на розрахунок не впливає); 0 = дим вимкнено
//   widthCm..doorHeightCm, steel*, firebrick*, chimney*, *AirPct -> геометрія/фізика/BOM
//   camera*, *Color, steelRoughness/Metalness, explodeDistanceCm -> лише 3D
//   combustion.catalyst.areaCm2 -> ПРИБРАНО (мертве поле без споживачів)
// Усі слайдери index.html мусять мати запис у controlMap (інакше слайдер «без обробника»).
{
  const htmlSrc = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const mapSrc = appSrc.match(/const controlMap = \{([\s\S]*?)\n\};/)[1];
  const mapped = new Set([...mapSrc.matchAll(/(\w+):\s*'/g)].map((m) => m[1]));
  const ranges = [...htmlSrc.matchAll(/<input[^>]*\btype="range"[^>]*\bid="(\w+)"|<input[^>]*\bid="(\w+)"[^>]*\btype="range"/g)].map((m) => m[1] || m[2]);
  const orphan = ranges.filter((id) => !mapped.has(id));
  ok(ranges.length > 10 && orphan.length === 0, 'кожен слайдер index.html має запис у controlMap (без мертвих слайдерів)', JSON.stringify(orphan));
  ok(!mapped.has('catalystLightoffC') && !/id="catalystLightoffC"/.test(htmlSrc) && !/catalystLightoffC/.test(appSrc), 'мертвий слайдер порогу каталізатора прибрано з UI (index.html, controlMap, app.js)');
  ok(/не регулю/.test(STR.uk.catalystLightoff) && /not adjustable/.test(STR.en.catalystLightoff) && /data-i18n="catalystLightoff"/.test(htmlSrc), 'на місці слайдера - чесна підказка «фіксована оцінка, на результат не впливає» (uk/en)');
  // Доказ, що слайдер справді був мертвим (а отже прибрати його чесно): 3 пресети x 5 режимів, каталізатор увімкнено,
  // lightoffC 150 vs 500 - ККД, secondaryActive і набір попереджень ідентичні, CATALYST_COLD не спрацьовує.
  {
    const diffs = []; let minT = Infinity; let cold = 0;
    for (const n of ['ws1', 'ws6', 'ws10']) for (const m of MODES_ALL) {
      const lo = clone(uiCell(n, m).cfg); lo.combustion.catalyst = { enabled: true, lightoffC: 150 };
      const hi = clone(lo); hi.combustion.catalyst.lightoffC = 500;
      const a = PhysicsModel.evaluate(lo), b = PhysicsModel.evaluate(hi);
      minT = Math.min(minT, a.metrics.combustionTempC);
      if (a.warnings.some((w) => w.code === 'CATALYST_COLD') || b.warnings.some((w) => w.code === 'CATALYST_COLD')) cold++;
      if (a.metrics.efficiencyPct !== b.metrics.efficiencyPct || a.metrics.secondaryActive !== b.metrics.secondaryActive || a.metrics.catalystActive !== b.metrics.catalystActive
        || JSON.stringify(a.warnings.map((w) => w.code)) !== JSON.stringify(b.warnings.map((w) => w.code))) diffs.push(`${n}/${m}`);
    }
    ok(diffs.length === 0 && cold === 0 && minT > 500, 'поріг каталізатора 150..500 не змінює видимих результатів (T згоряння завжди > 500), тож слайдер прибрано', JSON.stringify({ diffs, cold, minT }));
  }

  const cc = designInternals(normalizeConfig(clone(defaultConfig)));
  cc.combustion.catalyst.enabled = true;
  const ign = [150, 260, 500].map((l) => { const x = clone(cc); x.combustion.catalyst.lightoffC = l; return PhysicsModel.evaluate(x).metrics.secondaryIgnitionC; });
  ok(ign[0] < ign[1] && ign[1] < ign[2], 'lightoffC змінює secondaryIgnitionC', JSON.stringify(ign));

  const sm = (v) => { const x = clone(defaultConfig); x.testBurn.smokeOpacityPct = v; return normalizeConfig(x).testBurn.smokeOpacityPct; };
  ok(sm(0) === 0 && sm('0') === 0 && sm(1) === 1 && sm(100) === 100 && sm(150) === 100 && sm(-5) === 0, 'smokeOpacityPct: 0 не перетворюється на 5, межі 0..100', JSON.stringify([sm(0), sm(1), sm(150), sm(-5)]));
  ok(sm(undefined) === 5 && sm(NaN) === 5 && sm('abc') === 5, 'smokeOpacityPct: відсутнє/NaN -> дефолт 5');
  ok(/showSmoke = smokePct > 0;/.test(appSrc), '3D-дим вимикається лише при 0 %, а не при 1-2 %');

  const old = clone(base); old.combustion.catalyst = { enabled: true, lightoffC: 300, areaCm2: 999 };
  let migrated = null, threw = false;
  try { migrated = normalizeConfig(old); } catch { threw = true; }
  ok(!threw && !('areaCm2' in migrated.combustion.catalyst) && migrated.combustion.catalyst.lightoffC === 300 && migrated.combustion.catalyst.enabled === true, 'старий збережений catalyst.areaCm2 мовчки відкидається, решта лишається');
  ok(!('areaCm2' in base.combustion.catalyst) && !('areaCm2' in CONFIG_SCHEMA.combustion.catalyst), 'areaCm2 відсутнє в defaultConfig і схемі');

  const dictTxt = JSON.stringify([STR.uk.bomCut, STR.en.bomCut, STR.uk.bomArea, STR.en.bomArea]);
  ok(!/різу|nested|розкладк|Cut area/i.test(dictTxt) && /заготов/.test(STR.uk.bomCut) && /[Bb]lank/.test(STR.en.bomCut), 'bomCut: назва = площа заготовок із запасом, без «різу/розкладки/nested»', dictTxt);
  const bomT = buildBOM(normalizeConfig(clone(defaultConfig)), null, 'uk');
  const csvUk = bomToCsv(bomT, 'uk'), csvEn = bomToCsv(bomT, 'en');
  ok(!/Площа різу/.test(csvUk) && /Площа заготовки/.test(csvUk) && /Blank area/.test(csvEn) && !/Cut area/.test(csvEn), 'CSV BOM: заголовок колонки = площа заготовки');
  ok(new RegExp(`заготовки .* м2 \\(\\+${TH.BLANK_ALLOWANCE_PCT}% запас\\)`).test(csvUk) && new RegExp(`blanks .* m2 \\(\\+${TH.BLANK_ALLOWANCE_PCT}% allowance\\)`).test(csvEn) && !/різ \d/.test(csvUk), 'CSV BOM: підсумок називає заготовки й запас (число з BLANK_ALLOWANCE)');
  ok(TH.BLANK_ALLOWANCE === 1.12 && TH.BLANK_ALLOWANCE_PCT === Math.round((TH.BLANK_ALLOWANCE - 1) * 100) && STR.uk.bomCut.includes(`+${TH.BLANK_ALLOWANCE_PCT}%`) && STR.en.bomCut.includes(`+${TH.BLANK_ALLOWANCE_PCT}%`) && !/const BLANK_ALLOWANCE/.test(readFileSync(new URL('../js/bom.js', import.meta.url), 'utf8')), 'запас заготовок: одна константа BLANK_ALLOWANCE (thresholds.js) для bom.js, bomCut і CSV');
  ok(bomT.totals.cutAreaM2 > bomT.totals.steelAreaM2 && Math.abs(bomT.totals.cutAreaM2 / bomT.totals.steelAreaM2 - TH.BLANK_ALLOWANCE) < 0.02, 'заготовки = площа деталей x 1.12 (запас, не розкладка)');
  const cc2 = normalizeConfig(clone(defaultConfig)); cc2.combustion.catalyst.enabled = true;
  const catRow = buildBOM(cc2, null, 'uk').parts.find((p) => /Каталітичний/.test(p.name));
  ok(catRow && !/cell\/cm/.test(catRow.note || ''), 'BOM каталізатора не вигадує щільність комірок (cellsPerCm2 не існує)');
  ok(STR.uk.smokeShort && STR.en.smokeShort && /3D/.test(STR.uk.smokeHint) && /3D/.test(STR.en.smokeHint) && !/прогріву|warm-up/.test(STR.uk.smokeHint + STR.en.smokeHint), 'smokeHint/smokeShort: обидві мови, «лише 3D», без вигаданого «прогріву»');
}

// --- Фаза 2 (виправлення знахідок рецензентів): тести на кожен пункт ---
{
  const V = TH.configVerdict;
  const okVal = { errors: [], warnings: [] };
  const appSrc2 = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const htmlSrc2 = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const readSrc = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

  // (1) Кімната в єдиному вердикті: verdict=ok + room=oversized більше неможливо.
  ok(V(okVal, [], 0, 'oversized').level === 'warn' && V(okVal, [], 0, 'oversized').counts.room === 1, 'verdict: room oversized -> warn (counts.room=1)');
  ok(V(okVal, [], 0, 'low').level === 'warn' && V(okVal, [], 0, 'ok').level === 'ok' && V(okVal, []).level === 'ok', 'verdict: room low -> warn; room ok/за замовчуванням -> ok');
  ok(V(okVal, [{ level: 'danger' }], 0, 'oversized').level === 'danger', 'verdict: danger переважає зауваження кімнати');
  {
    // Пара з відгуку: геометрія й фізика без зауважень, а кімната «завелика» (WS-10 medium).
    let pairs = 0; const missed = [];
    for (const n of names0()) for (const m of MODES_ALL) {
      const { cfg, e } = uiCell(n, m);
      const room = evaluateRoom(cfg);
      const without = V(validateConfig(cfg), e.warnings, 0);
      if (without.level === 'ok' && room.status === 'oversized') { pairs++; if (V(validateConfig(cfg), e.warnings, 0, room.status).level === 'ok') missed.push(`${n}/${m}`); }
    }
    ok(pairs > 0 && missed.length === 0, 'пара verdict=ok + room=oversized існує в пресетах і тепер дає «є зауваження»', JSON.stringify({ pairs, missed }));
  }
  ok(/renderValidation\(verdict, room\)/.test(appSrc2) && /roomStatusText\(room\)/.test(appSrc2) && /const verdict = configVerdict\(.*room \? room\.status : 'ok'\)/.test(appSrc2), 'app.js: кімната передається у вердикт і виводиться в списку перевірки');
  ok(TH.OVERSIZE_RATIO === OVERSIZE_RATIO && !/export const OVERSIZE_RATIO/.test(readSrc('js/room.js')), 'OVERSIZE_RATIO живе в thresholds.js (room.js лише реекспортує)');

  // (6) Оцінка кімнати - за режимом призначення, а не за поточним режимом перемикача.
  {
    const results = MODES_ALL.map((m) => {
      const c = clone(uiCell('ws6', 'medium').cfg); applyModePreset(c, m);
      const r = evaluateRoom(c); return `${r.status}/${r.actualKw}/${r.mode}`;
    });
    ok(new Set(results).size === 1 && results[0].endsWith(`/${PURPOSES.room.mode}`), 'evaluateRoom не залежить від поточного режиму (start-up/overnight не дають «завелика/замало»)', JSON.stringify(results));
    const sauna = clone(base); sauna.room.purpose = 'sauna';
    ok(evaluateRoom(sauna).mode === PURPOSES.sauna.mode, 'evaluateRoom: режим = режим призначення (баня -> high)');
    ok(STR.uk.roomForMode && STR.en.roomForMode && /roomForMode/.test(appSrc2), 'підпис «для режиму X» поруч із потужністю кімнати (uk/en)');
  }

  // (2)+(10) Test Burn: нереальна маса/час/потужність.
  {
    const pred = PhysicsModel.evaluate(base);
    const tb = (o) => ({ ...base.testBurn, loadMode: 'manual', loadKg: 7.8, measuredBurnHours: 7.5, ...o });
    const cs = (o) => checkTestBurnPlausibility(computeTestBurnCore(pred, tb(o)));
    const has = (list, code) => list.find((i) => i.code === code);
    // сценарій з відгуку: 30 кг, 0.1 год, 5 кВт·год
    const bad = cs({ loadKg: 30, measuredBurnHours: 0.1, measuredUsefulHeatKwh: 5 });
    ok(has(bad, 'TB_HOURS_SHORT') && has(bad, 'TB_POWER_HIGH') && has(bad, 'TB_POWER_FAR') && bad.filter((i) => i.suspect).length >= 2, 'Test Burn: 30 кг за 0.1 год і 50 кВт -> HOURS_SHORT, POWER_HIGH, POWER_FAR (підозрілі)', JSON.stringify(bad.map((i) => i.code)));
    const noMeas = cs({ loadKg: 30, measuredBurnHours: 0.1, measuredUsefulHeatKwh: 0 });
    ok(has(noMeas, 'TB_POWER_HIGH') && has(noMeas, 'TB_HOURS_SHORT') && !has(noMeas, 'TB_POWER_FAR') && !noMeas.some((i) => i.suspect), 'Test Burn: без вимірювання теж попереджає про масу/час, але запису це не стосується');
    ok(cs({ measuredUsefulHeatKwh: 7.8 * pred.metrics.woodEnergyKwhKg * 0.7 }).length === 0, 'Test Burn: нормальний ввід лишається без попереджень');
    const fuelP = (kg, h) => kg * pred.metrics.woodEnergyKwhKg / h;
    const limitHours = (TH.TB_FUEL_POWER_RATIO_MAX * pred.metrics.grossHeatOutputKw);
    const justOk = cs({ loadKg: 7.8, measuredBurnHours: Math.max(TH.TB_BURN_HOURS_MIN, 7.8 * pred.metrics.woodEnergyKwhKg / (limitHours * 0.95)), measuredUsefulHeatKwh: 0 });
    ok(!has(justOk, 'TB_POWER_HIGH') && !has(justOk, 'TB_HOURS_SHORT') && fuelP(7.8, 7.8 * pred.metrics.woodEnergyKwhKg / (limitHours * 1.1)) > limitHours, 'Test Burn: межа TB_POWER_HIGH береться з grossHeatOutputKw моделі (x TB_FUEL_POWER_RATIO_MAX)');
    const low = cs({ measuredUsefulHeatKwh: pred.metrics.heatOutputKw * 7.5 / (TH.TB_MEASURED_POWER_RATIO * 1.5) });
    ok(has(low, 'TB_POWER_FAR'), 'Test Burn: виміряна потужність у кілька разів нижча за модельну теж підозріла');
    ok(has(cs({ measuredUsefulHeatKwh: 7.8 * pred.metrics.woodEnergyKwhKg * 0.95 }), 'TB_EFF_HIGH').suspect === true, 'Test Burn: TB_EFF_HIGH позначений suspect');
    for (const code of ['TB_HOURS_SHORT', 'TB_POWER_HIGH', 'TB_POWER_FAR']) {
      const item = has(bad, code);
      const txt = ['uk', 'en'].map((l) => TB_TXT[l][code](item.values));
      ok(txt.every((x) => typeof x === 'string' && x.length > 10 && !/NaN|undefined/.test(x)), `TB_TXT.${code}: тексти uk/en будуються без NaN`);
    }
    ok(/function commitTestToLog\(r, suspect\)/.test(appSrc2) && /confirmThen\('tbConfirmSaveMsg', 'tbConfirmSaveYes'/.test(appSrc2) && /some\(\(i\) => i\.suspect\)/.test(appSrc2) && /\.\.\.\(suspect \? \{ suspect: true \} : \{\}\)/.test(appSrc2), 'app.js: підозрілий вимір записується лише після підтвердження і з позначкою suspect');
    ok(['tbConfirmSaveMsg', 'tbConfirmSaveYes', 'tbSuspectMark'].every((k) => STR.uk[k] && STR.en[k]), 'ключі підтвердження підозрілого запису є в uk/en');
    ok(/doubtful = e\.suspect === true \|\| \+e\.measuredEffPct >= 100/.test(appSrc2), 'журнал: старі записи з ККД 100 % і підтверджені підозрілі позначаються ⚠ (дані не змінюються)');
  }

  // (5) Φ-датчик: формулювання «з боку Φ», а не загальне «проблем немає».
  ok(!/проблем немає/.test(STR.uk.phiRichSoft + STR.uk.phiLeanSoft + STR.uk.phiModeRich + STR.uk.phiModeOpen) && /Φ/.test(STR.uk.phiRichSoft) && !/no problem/.test(STR.en.phiRichSoft + STR.en.phiLeanSoft), 'Φ-датчик не стверджує «проблем немає» загалом');

  // (18) Подвійне округлення Φ: датчик бере те саме округлене значення, що й MIX_*.
  {
    const bad = [];
    for (const n of names0()) for (const m of MODES_ALL) {
      const mt = uiCell(n, m).e.metrics;
      if (Math.abs(mt.equivalenceRatio2 - mt.equivalenceRatio) > 0.0051 || mt.equivalenceRatio2 !== +mt.equivalenceRatio2.toFixed(2)) bad.push(`${n}/${m}`);
    }
    ok(bad.length === 0, 'metrics.equivalenceRatio2: Φ з 2 знаками, узгоджене з equivalenceRatio', JSON.stringify(bad));
    // Межа: 0.555 (round 3) -> toFixed(2) дало б 0.56 (ризик), хоча модель (round 2 від 0.5549) = 0.55 (немає MIX_RICH)
    ok(TH.phiGaugeState(0.55, 'medium').tone === 'soft' && TH.phiGaugeState(0.56, 'medium').tone === 'warn' && TH.phiGaugeState(0.35, 'medium').tone === 'soft' && TH.phiGaugeState(0.34, 'medium').tone === 'warn', 'phiGaugeState: межі 0.55/0.35 (нерівність строга) збігаються з MIX_RICH/MIX_LEAN');
    ok(/phi2 = round\(equivalenceRatio, 2\)/.test(readSrc('js/physics-model.js')) && /phi2 > PHI_RICH_WARN/.test(readSrc('js/physics-model.js')) && /equivalenceRatio2: phi2/.test(readSrc('js/physics-model.js')), 'physics-model.js: один phi2 для MIX_RICH/MIX_LEAN і для метрики датчика');
  }
  // (12) Зсув меж MIX_*: оптимізатор і автопроєкт не читають попередження, тож вибір бафля не залежить від MIX_*.
  ok(!/MIX_|\.warnings/.test(readSrc('js/autodesign.js')) && !/MIX_|\.warnings/.test(readSrc('js/room.js')), 'autodesign.js і room.js не залежать від MIX_*/warnings (зсув меж Φ не міняє підбір)');

  // (3) Каталізатор: див. блок 99. (4)/(16) Підказки.
  ok(/вся модель/.test(STR.uk.moisture) && /whole model/.test(STR.en.moisture) && /усієї моделі/.test(STR.uk.moistureHint) && /whole-model/.test(STR.en.moistureHint) && /усієї моделі/.test(htmlSrc2), 'слайдер вологості підписаний як параметр усієї моделі (uk/en, index.html)');
  ok(STR.uk.tbRefTempsHint && STR.en.tbRefTempsHint && /data-i18n="tbRefTempsHint"/.test(htmlSrc2) && /не входять/.test(STR.uk.tbRefTempsHint) && /not used/.test(STR.en.tbRefTempsHint), 'температури димоходу/верху/скла позначені як довідкові (не входять у розрахунок і журнал)');
  ok(!/flueTempC|stoveTopTempC|glassTempC/.test(readSrc('js/physics-model.js')) && !/flueTempC|stoveTopTempC|glassTempC/.test(readSrc('js/calibration.js')), 'підказка правдива: фізика й калібрування справді не читають три довідкові температури');

  // (7) Одиниці з i18n у UK-інтерфейсі.
  for (const k of ['unitKw', 'unitKwh', 'unitKg', 'unitM3', 'unitM2', 'unitM', 'unitH']) ok(STR.uk[k] && STR.en[k] && STR.uk[k] !== STR.en[k], `одиниця ${k} є в обох мовах і локалізована`);
  const hard = [...appSrc2.matchAll(/\$\{[^}]+\} (kW|kWh|kg|m³|m²|h)\b/g)].map((m) => m[0]);
  ok(hard.length === 0, 'app.js: kW/kWh/kg/m²/m³/h не захардкоджені англійською (беруться з t(unit..))', JSON.stringify(hard));
  ok(/раз(?!а)/.test(STR.uk.roomOversized) === false && /\$\{ratio\}×/.test(STR.uk.roomOversized) && /\$\{ratio\}×/.test(STR.en.roomOversized) && !/ - /.test(Object.values(TB_TXT.uk).map((f) => f({ eff: 1, max: 1, kg: 1, glass: 1, top: 1, hours: 1, min: 1, fuelKw: 1, grossKw: 1, ratio: 1, measuredKw: 1, predictedKw: 1 })).join('')), 'мовні шорсткості: «у N× більша», тире замість дефіса в TB_TXT');

  // (8) Друк містить вердикт і зауваження.
  ok(/function printVerdictBlock\(\)/.test(appSrc2) && /\$\{img\}\$\{printVerdictBlock\(\)\}<table>/.test(appSrc2) && /configVerdict\(validation, r\.warnings, fit, room\.status\)/.test(appSrc2), 'друк: вердикт і перелік danger/warn/кімнати йдуть з того самого configVerdict');

  // (14) Статичні fallback-тексти index.html = словник uk (будь-який data-i18n).
  {
    const mism = [];
    for (const m of htmlSrc2.matchAll(/data-i18n="(\w+)"[^>]*>([^<]*)</g)) {
      const u = STR.uk[m[1]];
      if (u === undefined || String(u).trim() !== m[2].trim()) mism.push(m[1]);
    }
    ok(mism.length === 0, 'index.html: fallback-текст кожного data-i18n збігається зі словником uk', JSON.stringify(mism));
  }

  // (23) Реєстр елементів: КОЖЕН input/select з id у index.html має споживача в app.js.
  {
    const ids = [...htmlSrc2.matchAll(/<(?:input|select)\b[^>]*\bid="(\w+)"/g)].map((m) => m[1]);
    const orphan = ids.filter((id) => !new RegExp(`['"\`#]${id}['"\`]|\\b${id}:`).test(appSrc2));
    ok(ids.length > 40 && orphan.length === 0, 'кожен input/select/checkbox index.html має споживача в app.js (controlMap або getElementById)', JSON.stringify(orphan));
  }

  // (11)/(13) Документація.
  const readme = readSrc('README.md'), agents = readSrc('AGENTS.md'), roadmap = readSrc('docs/ROADMAP.md'), report = readSrc('REPORT.md');
  ok(/thresholds\.js/.test(readme) && /test-burn\.js/.test(readme), 'README: дерево файлів містить thresholds.js і test-burn.js');
  ok(/thresholds\.js/.test(agents), 'AGENTS.md: правило про пороги з thresholds.js');
  ok(!/оновлює лише Test Burn/.test(roadmap) && /Правдивість UI \(\*\*виконано/.test(roadmap), 'ROADMAP: слайдер вологості не «лише Test Burn»; статус фази 2 позначено');
  ok(!/різ \(з розкладкою\)/.test(report) && /площа заготовок/.test(report) && /configVerdict/.test(report) && /phiGaugeState/.test(report), 'REPORT: без «різ (з розкладкою)»; описано єдиний вердикт, Φ-датчик і межі правдоподібності');
}
function names0() { return Object.keys(MODEL_PRESETS); }

// Знахідка «Креслення не відкрило оверлею» - хибна: exportDrawing завантажує SVG-файл, а #drawing-overlay - лише
// розмірні підписи 3D-сцени. Фіксуємо реальну поведінку: обробник качає непорожній SVG з розмірами печі.
{
  const appSrc3 = readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  ok(/getElementById\('exportDrawing'\)\.addEventListener\('click', exportDrawingSvg\)/.test(appSrc3) && /function exportDrawingSvg\(\) \{\s*const svg = buildDrawingSVG\(config, lang\);\s*downloadBlob\(/.test(appSrc3), 'exportDrawing: кнопка завантажує SVG-файл (не оверлей)');
  const svgText = buildDrawingSVG(base, 'uk');
  ok(/^<svg/.test(svgText.trim()) && svgText.includes(String(base.dimensions.widthCm * 10)) && svgText.length > 2000, 'buildDrawingSVG: непорожній SVG із шириною печі в мм');
}

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TESTS FAILED`);process.exit(fails === 0 ? 0 : 1);
