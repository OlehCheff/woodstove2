// Швидкі тести PhysicsModel v2 — запуск: node tests/physics.test.js
import { PhysicsModel, optimizeConfig } from '../js/physics-model.js';
import { defaultConfig, normalizeConfig, applyModePreset, applyModelPreset, validateConfig, MODEL_PRESETS } from '../js/config.js';

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

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TESTS FAILED`);
process.exit(fails === 0 ? 0 : 1);
