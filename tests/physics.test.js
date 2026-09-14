// Швидкі тести PhysicsModel v5 — запуск: node tests/physics.test.js
import { PhysicsModel, optimizeConfig } from '../js/physics-model.js';
import { defaultConfig, normalizeConfig, applyModePreset, applyModelPreset, validateConfig, deepMerge, encodeConfig, decodeConfig, MODEL_PRESETS } from '../js/config.js';
import { calibrateFromLog, evaluateCalibration, detectJournalDesync } from '../js/calibration.js';
import { buildBOM, bomToCsv, buildDrawingSVG, buildDXF } from '../js/bom.js';
import { designInternals } from '../js/autodesign.js';
import { requiredPowerKw, sizeStoveForPower, evaluateRoom, PURPOSES } from '../js/room.js';

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
// (обидва шляхи мають викликати designInternals після applyModePreset).
{
  for (const m of ['low', 'high', 'overnight']) {
    const live = designInternals(normalizeConfig(clone(defaultConfig)));
    applyModePreset(live, m); designInternals(live); // те, що робить app.js у обробнику зміни режиму
    const reloaded = designInternals(normalizeConfig(deepMerge(clone(defaultConfig), clone(live)))); // те, що робить app.js при завантаженні
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

console.log(fails === 0 ? '\nALL TESTS PASSED' : `\n${fails} TESTS FAILED`);process.exit(fails === 0 ? 0 : 1);
