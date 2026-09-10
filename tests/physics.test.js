// Швидкі тести PhysicsModel v2 — запуск: node tests/physics.test.js
import { PhysicsModel, optimizeConfig } from '../js/physics-model.js';
import { defaultConfig, normalizeConfig, applyModePreset, applyModelPreset, validateConfig, MODEL_PRESETS } from '../js/config.js';
import { calibrateFromLog, evaluateCalibration } from '../js/calibration.js';
import { buildBOM, bomToCsv, buildDrawingSVG, buildDXF } from '../js/bom.js';
import { designInternals } from '../js/autodesign.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
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
lowStack.chimney.heightCm = 100; lowStack.chimney.diameterCm = 10; lowStack.operation.flameIntensity = 0.2;
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
for (const [name, preset] of Object.entries(MODEL_PRESETS)) {
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

// 12. BOM: стабільні числа, маса/різ/шви, без NaN на всіх пресетах
for (const [name, preset] of Object.entries(MODEL_PRESETS)) {
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

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TESTS FAILED`);process.exit(fails === 0 ? 0 : 1);
