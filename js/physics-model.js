// PhysicsModel v5 — оціночна airflow/thermal модель, не CFD і не сертифікація.
import { OPERATION_PRESETS, rearOutletLayout, bottomIntakeGeometry, INTAKE_MIN_STOP_PCT } from './config.js';

const MODE_COEFF = {
  'start-up':  { effBias: -4, powerFactor: 1.05, burnFactor: 0.72, fillFactor: 0.5 },
  'low':       { effBias: +2, powerFactor: 0.58, burnFactor: 1.38, fillFactor: 0.6 },
  'medium':    { effBias: +4, powerFactor: 0.82, burnFactor: 1.0,  fillFactor: 0.7 },
  'high':      { effBias: -2, powerFactor: 1.18, burnFactor: 0.74, fillFactor: 0.85 },
  'overnight': { effBias: -6, powerFactor: 0.42, burnFactor: 1.75, fillFactor: 0.7 },
};
const WOOD_SPECIES = {
  birch: { lhvKwhKg: 4.2, bulkKgM3: 620 },
  oak: { lhvKwhKg: 4.3, bulkKgM3: 680 },
  pine: { lhvKwhKg: 4.0, bulkKgM3: 480 },
  spruce: { lhvKwhKg: 3.9, bulkKgM3: 430 },
  alder: { lhvKwhKg: 4.0, bulkKgM3: 520 },
};
const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const safeMode = (m) => (MODE_COEFF[m] ? m : 'medium');
const circleArea = (diameterCm) => PI * (diameterCm / 2) ** 2;
// Втрати з димом за Зігертом: q ≈ ΔT·(A/CO2 + B), для деревини CO2 ≈ 20.3%/λ,
// A ≈ 0.65, B ≈ 0.008 → q ∝ 0.032·λ + 0.008. Базова формула втрат у трубі
// відкалібрована при λ ≈ 2.2 (medium), тож масштабуємо її відносно цієї точки.
const siegertAirTerm = (lambda) => 0.032 * lambda + 0.008;
const LAMBDA_REF = 2.2;
// Нижче λ = 2.0 (Φ > 0.5, верхня межа цільового діапазону Φ 0.4–0.5) повітря
// вже не вистачає, щоб допалити всі гази: частина енергії йде в трубу як CO і дим.
// Так пік ККД припадає на межу цільового діапазону, а не в зону MIX_RICH (Φ > 0.55).
const LAMBDA_RICH = 2.0;
// Межі потужності — лише захист від нісенітниці (NaN/Infinity з пошкодженого
// конфігу), а НЕ «робочий діапазон». Колишні clamp(1.5…24) для gross і
// clamp(1.0…20) для net були штучні: кожна мала піч показувала фальшиві
// ~1.15 кВт (реально ~0.17), а великі зрізались — майстерня давала 18.05 кВт
// замість ~26, і її режим high (16.88) виходив СЛАБШИМ за medium (18.05).
// 500 кВт недосяжні в межах UI (найбільша піч 140×120×180 ≈ 200 кВт gross),
// тож ця межа ніколи не спрацьовує на реальному конфізі.
const MAX_SANE_KW = 500;
const saneKw = (v) => (Number.isFinite(v) ? clamp(v, 0, MAX_SANE_KW) : 0);

// ---- Вихід труби: власні повороти на 90°, яких немає у слайдері «Вигинів» ----
// Слайдер chimney.bends описує вигини ВИЩЕ печі; ці — невідʼємні від способу
// підключення. Маршрут «над піччю»: верхній виходить прямо (0), задній платить
// одним коліном. Маршрут «у стінний димохід позаду»: верхньому потрібні два
// повороти (вгору→назад→вгору), задньому — один.
// ЗАСТЕРЕЖЕННЯ: штраф 1/(1+0.12·n) за поворот — це модельна УМОВНІСТЬ,
// відкалібрована разом із рештою формули тяги, а не виміряний опір. За балансом
// мас швидкість у трубі Ø17.5 на сталому режимі — 0.46–0.67 м/с, тобто реальний
// трійник коштує ζ·ρv²/2 ≈ 0.03–0.16 Па, а не ~2 Па. Чесна частка дефіциту
// тяги заднього виходу — охолодження патрубка (≈ −5% і ≈ −25 °C на 30 см
// для defaultConfig, bends 0), решта −10% — ця умовність. 0.12 не чіпаємо,
// щоб не зсувати наявне калібрування; на виборі виходу воно не позначається.
const OUTLET_TURNS = { up: { top: 0, rear: 1 }, wall: { top: 2, rear: 1 } };
// Одностінна труба в кімнаті охолоджує гази: NTU ≈ 0.2 (газ 300 °C) …
// 0.39 (557 °C) на метр при U ≈ 2.7–5.3 Вт/м²К. Беремо 0.3/м — ОЦІНКА,
// яку варто відкалібрувати Test Burn-ом (T газу до і після патрубка).
// Для порівняння: увесь димохід модель охолоджує на 0.12/м (flueCoolingFactor),
// і вертикальна одностінна труба верхнього виходу врахована саме там.
const ROOM_PIPE_COOLING_PER_M = 0.3;
// Маршрут «у стінний димохід» для ВЕРХНЬОГО виходу: підйом над кришкою перед
// поворотом назад (м). Разом із проходом над піччю (0.3·глибини) це та зайва
// труба в кімнаті, якої задній вихід не має.
const TOP_WALL_RISE_M = 0.4;
const AMBIENT_C = 20;

export const PhysicsModel = {
  evaluate(config) {
    const mode = safeMode(config?.operation?.mode);
    const mc = { ...MODE_COEFF[mode], ...(OPERATION_PRESETS[mode] || {}) };
    const w = +config?.dimensions?.widthCm || 70;
    const d = +config?.dimensions?.depthCm || 55;
    const h = +config?.dimensions?.heightCm || 95;
    const steelMm = +config?.materials?.steelThicknessMm || 5;
    const brickCm = +config?.materials?.firebrickThicknessCm || 4;
    const chimD = +config?.chimney?.diameterCm || 15;
    const flueH = +config?.chimney?.totalHeightM || 5;
    const flueBends = +config?.chimney?.bends || 0;
    const outlet = config?.chimney?.outlet === 'rear' ? 'rear' : 'top';
    const route = config?.chimney?.route === 'wall' ? 'wall' : 'up';
    const connectorM = clamp(+config?.chimney?.connectorLengthCm || 30, 15, 150) / 100;
    const outletTurns = OUTLET_TURNS[route][outlet];
    // Довжина ВІДКРИТОЇ горизонтальної/зайвої труби в кімнаті, якої немає у
    // базового варіанта (верхній + «над піччю»): вона віддає тепло в кімнату
    // й водночас охолоджує гази перед вертикаллю.
    const roomPipeM = route === 'wall'
      ? connectorM + (outlet === 'top' ? d * 0.3 / 100 + TOP_WALL_RISE_M : 0)
      : (outlet === 'rear' ? connectorM : 0);
    // Охорона `roomPipeM > 0`: для top/up множник рівно 1 (без exp(0)), тож
    // метрики й журнали калібрування не зсуваються навіть на 1 ulp.
    const roomPipeCooling = roomPipeM > 0 ? Math.exp(-ROOM_PIPE_COOLING_PER_M * roomPipeM) : 1;
    const routeBends = flueBends + outletTurns;
    const washAsSecondary = config?.combustion?.washAsSecondary !== false;
    const tertiaryCfg = config?.combustion?.tertiary || {};
    const catalystCfg = config?.combustion?.catalyst || {};

    const primaryPct = +config?.primaryAir?.openPct ?? 52;
    const secondaryPct = +config?.operation?.secondaryAirPct ?? 55;
    const washGap = +config?.airWash?.gapCm ?? 1.4;
    const washIntake = +config?.airWash?.intakePct ?? 60;
    const washWidthPct = +config?.airWash?.slotWidthPct ?? 94;
    const baffleFlow = +config?.baffle?.airflowPct ?? 55;
    const baffleGap = +config?.baffle?.frontGapCm ?? 6;
    const baffleHeight = +config?.baffle?.heightCm ?? 58;
    const baffleAngle = +config?.baffle?.angleDeg ?? 6;
    const flame = +config?.operation?.flameIntensity ?? 0.62;
    const thermal = config?.thermal || {};
    const insulationCm = thermal.insulationThicknessCm == null ? 3 : +thermal.insulationThicknessCm;
    const baffleRefractoryCm = thermal.baffleRefractoryThicknessCm == null ? 3 : +thermal.baffleRefractoryThicknessCm;
    const targetCombustionTempC = +thermal.targetCombustionTempC || 850;
    const heatExchangePasses = Math.max(1, Math.round(+thermal.heatExchangePasses || 2));
    const speciesKey = config?.testBurn?.woodSpecies;
    const species = WOOD_SPECIES[speciesKey] || WOOD_SPECIES.birch;
    const moisturePct = clamp(+config?.testBurn?.woodMoisturePct || 15, 8, 35);
    const woodEnergyKwhKg = species.lhvKwhKg * (1 - moisturePct * 0.007);
    const moistureTempPenaltyC = Math.max(0, moisturePct - 12) * 6;
    const moistureEffPenalty = Math.max(0, moisturePct - 12) * 0.15;
    // Волога, що википає з палива, іде з димом і забирає приховану теплоту
    // пароутворення — це прямі втрати через димохід, а не лише нижча температура.
    const moistureFlueLossPenalty = Math.max(0, moisturePct - 12) * 0.25;
    // Калібрування за реальними тестами (якщо увімкнено): глобальний масштаб + поправка режиму.
    const calibration = config?.calibration || {};
    const calibrationFactor = (calibration.enabled && calibration.globalScale)
      ? calibration.globalScale * ((calibration.modeScale && calibration.modeScale[mode]) || 1)
      : 1;

    const secondary = config?.secondaryAir || {};
    const airWash = config?.airWash || {};
    const steelCm = steelMm / 10;
    const linerCm = brickCm + insulationCm;
    const innerW = Math.max(10, w - steelCm * 2 - linerCm * 2);
    const innerD = Math.max(10, d - steelCm * 2 - linerCm * 2);
    const innerH = Math.max(10, baffleHeight - steelCm - linerCm);
    const fireboxLiters = (innerW * innerD * innerH) / 1000;

    // Фізичні площі проходів, а не тільки UI-відсотки.
    const primaryOpeningAreaCm2 = circleArea(+config?.primaryAir?.holeDiameterCm || 1.2) * (+config?.primaryAir?.holeCount || 8) * primaryPct / 100;
    const secondaryOpeningAreaCm2 = circleArea(+secondary.holeDiameterCm || 0.7) * (+secondary.holeCount || 10) * (baffleFlow / 100);
    const doorWidth = Math.max(20, Math.min(+config?.door?.widthCm || 42, w - steelCm * 4));
    const slotWidthCm = doorWidth * washWidthPct / 100;
    const airWashOpeningAreaCm2 = slotWidthCm * washGap * washIntake / 100;
    // Tertiary: окремі дрібні отвори у найгарячішій зоні (фінальне догорання CO).
    const tertiaryAreaCm2 = tertiaryCfg.enabled ? circleArea(+tertiaryCfg.holeDiameterCm || 0.5) * (+tertiaryCfg.holeCount || 8) : 0;
    // Air-wash науково бере участь у вторинному горінні (завіса = потік окислювача).
    const washSecondaryShare = washAsSecondary ? 0.5 : 0;
    const secondaryTotalAreaCm2 = secondaryOpeningAreaCm2 + airWashOpeningAreaCm2 * washSecondaryShare + tertiaryAreaCm2 * 0.6;
    const chimneyAreaCm2 = circleArea(chimD);
    const effectiveIntakeAreaCm2 = primaryOpeningAreaCm2 + secondaryOpeningAreaCm2 + airWashOpeningAreaCm2 + tertiaryAreaCm2;
    // ---- Нижній вхід secondary (канал під днищем + повзун спереду) ----
    // Повзун — це фізичний привід ТОГО САМОГО operation.secondaryAirPct, який
    // уже був у моделі. λ, ККД і потужність від самої появи каналу не
    // змінюються: нових коефіцієнтів тут немає НАВМИСНО.
    // Підігрів повітря в каналі (оцінка +20…90 °C) НЕ моделюється: свого
    // коефіцієнта для нього немає, а на стелі combustionEff = 92 він лише
    // підняв би втрати в трубі. Це записано і в REPORT §7.
    const intake = bottomIntakeGeometry(config);
    const secondaryIntakeFullCm2 = intake.slotAreaCm2;
    const secondaryIntakeOpenCm2 = secondaryIntakeFullCm2 * clamp(secondaryPct, 0, 100) / 100;
    // Щілина й отвори стоять ПОСЛІДОВНО, тож опори додаються як 1/A²
    // (стандартне складання отворів, не новий коефіцієнт). Ця площа —
    // ДОВІДКОВА: у λ вона не входить, бо airMix бере відсоток повзуна, а не
    // площу. Саме тут модель приписує повзуну більше влади, ніж має залізо
    // (вага 0.35 в airMix проти ~9 % площі входів із внутрішньою заслінкою, ~19 % повністю відкрито) — див. REPORT §7.
    // Незмінна частина шляху (канал, колектор, вікна в днищі, стояки) — теж послідовно.
    const fixedTerm = intake.fixedPathCm2 > 0 ? 1 / intake.fixedPathCm2 ** 2 : 0;
    const secondaryPathAreaCm2 = secondaryIntakeOpenCm2 > 0
      ? 1 / Math.sqrt(1 / secondaryOpeningAreaCm2 ** 2 + 1 / secondaryIntakeOpenCm2 ** 2 + fixedTerm)
      : (intake.buildable ? 0 : secondaryOpeningAreaCm2);

    // Тяга: двигун системи — ПОВНИЙ димохід (плавучисть гарячих газів).
    // Δp ≈ g·H·(ρ_повітря − ρ_газів); вигини й опір зменшують тягу.
    const baffleHeightNorm = clamp((baffleHeight - 20) / 60, 0, 1);
    const baffleAngleNorm = clamp(baffleAngle / 15, -1, 1);
    const baffleDraftPenalty = baffleHeightNorm * 1.2;
    const stackTempC = clamp(120 + flame * 320 + (mode === 'high' ? 50 : 0), 120, 650);
    // Гази входять у вертикаль уже охолодженими на горизонтальному патрубку —
    // саме це, а не коліно, є фізично чесною частиною дефіциту тяги заднього
    // виходу (на defaultConfig з L = 30 см: 30.5 → 29.1 Па, тобто −4.6%).
    const stackGasC = roomPipeM > 0 ? AMBIENT_C + (stackTempC - AMBIENT_C) * roomPipeCooling : stackTempC;
    const rhoAir = 1.2;
    const rhoGas = rhoAir * 293 / (stackGasC + 273);
    const buoyancyPa = 9.81 * flueH * (rhoAir - rhoGas);
    const bendPenalty = 1 / (1 + 0.12 * routeBends);
    const diaFactor = clamp((chimD / 15) ** 0.3, 0.8, 1.2);
    const draftPa = clamp(buoyancyPa * bendPenalty * diaFactor - baffleDraftPenalty, 3, 40);
    const stackVelocityMs = clamp(0.75 * Math.sqrt(Math.max(draftPa, 0.1)), 1, 7);
    const draftFlowM3s = clamp((chimneyAreaCm2 / 10000) * stackVelocityMs, 0.003, 0.2);
    const secondaryVelocityMs = clamp((draftPa * 0.12) / Math.max(secondaryOpeningAreaCm2, 0.4), 0.05, 8);
    const airWashVelocityMs = clamp((draftPa * 0.04) / Math.max(airWashOpeningAreaCm2 / 10, 0.6), 0.05, 5);

    const secondaryDemandCm2 = clamp(fireboxLiters * 0.006, 0.4, 2.0);
    const secondaryCoverage = clamp(secondaryTotalAreaCm2 / secondaryDemandCm2, 0, 1.5);
    const airWashCoverage = clamp(airWashOpeningAreaCm2 / Math.max(doorWidth * 0.9, 1), 0, 1.5);
    const bafflePreheatBonus = baffleHeightNorm * 25 + baffleAngleNorm * 15;
    const secondaryPreheatC = clamp(20 + (+secondary.preheatLengthCm || 55) * 1.9 + flame * 95 + bafflePreheatBonus, 60, 420);
    const airWashPreheatC = clamp(20 + (+airWash.preheatLengthCm || 45) * 1.7 + flame * 65, 50, 340);
    const washEffPct = clamp((washGap / 3) * (washIntake / 100) * 100, 0, 100);
    const airMix = (primaryPct * 0.55 + secondaryPct * 0.35 + washEffPct * 0.10) / 100;
    // Коефіцієнт надлишку повітря λ та Φ=1/λ (ціль Φ 0.4–0.5).
    const lambda = clamp(1.4 + airMix * 1.6, 1.1, 4);
    const equivalenceRatio = 1 / lambda;
    const staging = clamp((secondaryPct - 20) * 0.06 + (baffleFlow - 50) * 0.04, -4, +5);
    const draftBonus = (clamp(flueH / 5, 0.7, 1.4) - 1) * 6;

    // Thermal architecture: a hotter insulated firebox, a defined gas path,
    // and heat extraction after secondary combustion. This remains an estimate,
    // not CFD or a certification calculation.
    const thermalRetention = clamp(0.58 + insulationCm * 0.055 + baffleRefractoryCm * 0.035, 0.58, 0.94);
    const gasPathCm = Math.max(20, baffleHeight * 0.55 + Math.max(8, innerD - baffleGap) * 0.65 + heatExchangePasses * innerD * 0.8) * (1 / Math.max(Math.cos(baffleAngle * Math.PI / 180), 0.75));
    const gasResidenceSeconds = clamp((gasPathCm / 100) / Math.max(stackVelocityMs, 0.2), 0.15, 8);
    const combustionTempC = clamp(480 + flame * 260 + secondaryPreheatC * 0.55 + thermalRetention * 160 + gasResidenceSeconds * 12 - moistureTempPenaltyC, 450, 1100);
    const targetTemperatureFit = clamp(2 - Math.abs(combustionTempC - targetCombustionTempC) / 180, -2, 2);
    const secondaryQuality = clamp((secondaryCoverage - 0.75) * 4 + (secondaryPreheatC - 160) / 120, -3, 4);
    // Каталізатор знижує поріг займання диму; без нього вторинне горіння потребує ~600 °C.
    const catalystEnabled = Boolean(catalystCfg.enabled);
    const catalystLightoffC = +catalystCfg.lightoffC || 260;
    const secondaryIgnitionC = catalystEnabled ? Math.min(600, catalystLightoffC) : 600;
    const secondaryActive = combustionTempC >= secondaryIgnitionC;
    const catalystActive = catalystEnabled && combustionTempC >= catalystLightoffC;
    // Каталізатор — окремий, прямий ефект (допалює CO/дим у власному стільнику),
    // тому рахуємо його ПОСЛЕ стелі комбустійного ККД: інакше на добре спроєктованій
    // печі (яка й так впирається у стелю 92) бонус каталізатора ніколи не видно.
    const catalystBonus = catalystActive ? 2.5 : 0;
    const secondaryGateBonus = secondaryActive ? 3 : -8;
    const combustionEfficiencyPct = clamp(
      68 + (combustionTempC - 600) * 0.04 + secondaryQuality * 1.2 + thermalRetention * 5 + gasResidenceSeconds
        + airMix * 5 + staging + draftBonus * 0.3 + targetTemperatureFit - moistureEffPenalty + secondaryGateBonus + mc.effBias,
      48, 92
    );
    const modeledFlueTempC = clamp(combustionTempC - heatExchangePasses * 110 - insulationCm * 18 - baffleRefractoryCm * 12, 120, 650);
    const baffleExitTempC = clamp(modeledFlueTempC + (combustionTempC - modeledFlueTempC) * 0.55, 130, 900);
    // Зайве повітря нагрівається й несе тепло в трубу: відчутні втрати ∝ λ (Зігерт).
    // Прихована теплота вологи від λ не залежить, тому додається окремо.
    const excessAirLossFactor = siegertAirTerm(lambda) / siegertAirTerm(LAMBDA_REF);
    const sensibleFlueLossPct = Math.max(0, 7 + (modeledFlueTempC - 150) * 0.025 + (1 - thermalRetention) * 8 - heatExchangePasses * 1.5);
    const flueLossPct = clamp(sensibleFlueLossPct * excessAirLossFactor + moistureFlueLossPenalty, 8, 28);
    // Недопал при нестачі повітря рахуємо ПІСЛЯ стелі 92, як і каталізатор:
    // «сирий» ККД згоряння в робочих режимах ~100, і стеля поглинула б поправку.
    const incompleteCombustionLossPct = clamp((LAMBDA_RICH - lambda) * 15, 0, 8);
    const efficiencyPct = clamp(combustionEfficiencyPct - incompleteCombustionLossPct - flueLossPct + catalystBonus, 35, 88);
    // Температура димових газів на ВИХОДІ з труби: експоненційне охолодження вздовж
    // каналу (наближення до температури довкілля), а не лінійне — лінійна форма
    // перетинала нуль і давала однакові 40°C для будь-якої печі на довгих трубах.
    const ambientC = AMBIENT_C;
    const flueCoolingFactor = Math.exp(-0.12 * flueH);
    const exitFlueTempC = clamp(ambientC + (modeledFlueTempC - ambientC) * flueCoolingFactor * roomPipeCooling - routeBends * 6, 40, 600);
    // Тепло, яке віддає в кімнату ДОДАТКОВА одностінна труба цього маршруту
    // (горизонтальний патрубок заднього виходу або підйом+горизонталь
    // верхнього у стінний димохід). Це властивість МОНТАЖУ, а не печі, тому
    // в efficiencyPct і heatOutputKw воно НЕ входить — окрема метрика.
    // База відліку — верхній вихід із маршрутом «над піччю» (roomPipeM = 0):
    // його власна вертикальна труба вже врахована в загальному охолодженні
    // 0.12/м, тож це саме ПРИРІСТ відносно нього, а не «системний ККД».
    const roomPipeGainPct = sensibleFlueLossPct * excessAirLossFactor * (1 - roomPipeCooling);
    const bodyTempC = clamp(110 + (1 - thermalRetention) * 520 + flame * 120 - (steelMm - 5) * 9, 40, 480);
    const bodyHeatSharePct = clamp((1 - thermalRetention) * 26 + 8, 8, 30);

    const draftFactor = clamp(draftPa / 12, 0.7, 1.3);
    const geometryFactor = clamp((w * d * h) / 1e6 / 0.36, 0.75, 1.25);
    const grossHeatOutputKw = saneKw(
      fireboxLiters * 0.105 * (0.35 + 0.65 * airMix) * mc.powerFactor * draftFactor * geometryFactor
    );
    const heatOutputKw = saneKw(grossHeatOutputKw * efficiencyPct / 100 * calibrationFactor);
    // Орієнтир: ~120 кг/м³ насипної маси сухих полін, не щільність деревини.
    // Безпечна максимальна закладка залишає місце для полум'я та вторинного повітря.
    const maxLoadKg = fireboxLiters * 0.12 * 0.9;
    const recommendedLoadKg = maxLoadKg * (mc.fillFactor ?? 0.7);
    const loadKg = recommendedLoadKg;
    const inputEnergyKwh = loadKg * woodEnergyKwhKg;
    const usefulEnergyKwh = inputEnergyKwh * efficiencyPct / 100;
    const burnTimeHours = clamp(
      (usefulEnergyKwh / Math.max(heatOutputKw, 0.1)) * mc.burnFactor * (1 + steelMm * 0.015),
      2.0, 14.0
    );

    const warnings = [];
    if (primaryPct < 18 && secondaryPct < 20)
      warnings.push({ level: 'warn', code: 'SMOKE_RISK', message: 'Ризик димлення: замало первинного і вторинного повітря.' });
    if (heatOutputKw > 9.0 && steelMm <= 4)
      warnings.push({ level: 'danger', code: 'OVERHEAT_RISK', message: 'Перегрів: висока потужність при сталі ≤4 мм.' });
    if (efficiencyPct < 58 && mode !== 'overnight')
      warnings.push({ level: 'warn', code: 'INEFFICIENT_MODE', message: 'Неефективний режим: ККД < 58%.' });
    if (washGap < 0.9 && flame > 0.75)
      warnings.push({ level: 'warn', code: 'DIRTY_GLASS', message: 'Закопчення скла: вузький air-wash при сильному полум’ї.' });
    if (draftPa < 9 && mode !== 'overnight')
      warnings.push({ level: 'warn', code: 'DRAFT_WEAK', message: `Слабка тяга (${round(draftPa, 1)} Па): збільшіть висоту/Ø димоходу або інтенсивність.` });
    if (baffleGap > 12)
      warnings.push({ level: 'info', code: 'BAFFLE_GAP', message: 'Великий передній зазор бафля — гази йдуть повз догорання.' });
    if (secondaryCoverage < 0.62 && mode !== 'overnight')
      warnings.push({ level: 'warn', code: 'SECONDARY_RESTRICTED', message: 'Замала площа secondary-отворів для обʼєму топки.' });
    if (secondaryPreheatC < 130)
      warnings.push({ level: 'warn', code: 'SECONDARY_COLD', message: 'Secondary air недостатньо підігрівається перед догоранням.' });
    if (airWashVelocityMs > 2.0 && washWidthPct < 80)
      warnings.push({ level: 'warn', code: 'AIRWASH_JETS', message: 'Air-wash може працювати струменями: розширте slot або зменште intake.' });
    if (airWashCoverage < 0.55 && mode !== 'overnight')
      warnings.push({ level: 'warn', code: 'AIRWASH_LOW', message: 'Недостатнє покриття скла повітряною завісою.' });
    if (mode === 'start-up' && burnTimeHours > 6)
      warnings.push({ level: 'info', code: 'STARTUP_LONG', message: 'Start-up з довгим горінням — перевірте подачу повітря.' });
    if (bodyTempC > 420 && steelMm <= 4)
      warnings.push({ level: 'danger', code: 'STEEL_OVERHEAT', message: `Корпус ~${round(bodyTempC, 0)}°C при сталі ≤4 мм: збільшіть ізоляцію або товщину сталі.` });
    if (moisturePct > 22)
      warnings.push({ level: 'warn', code: 'WET_WOOD', message: `Вологість ${round(moisturePct, 0)}% знижує температуру допалювання та ККД.` });
    if (!secondaryActive)
      warnings.push({ level: 'warn', code: 'SECONDARY_INACTIVE', message: `Вторинне горіння не запалюється: зона ${round(combustionTempC, 0)}°C < ${round(secondaryIgnitionC, 0)}°C.` });
    if (equivalenceRatio > 0.55 && mode !== 'overnight')
      warnings.push({ level: 'warn', code: 'MIX_RICH', message: `Замало повітря (Φ=${round(equivalenceRatio, 2)}): дим і CO. Додайте вторинне/третинне повітря.` });
    if (equivalenceRatio < 0.33)
      warnings.push({ level: 'info', code: 'MIX_LEAN', message: `Багато повітря (Φ=${round(equivalenceRatio, 2)}): зона охолоджується, зайві втрати.` });
    if (exitFlueTempC < 150)
      warnings.push({ level: 'danger', code: 'CREOSOTE_RISK', message: `Димові гази на виході ${round(exitFlueTempC, 0)}°C < 150°C: конденсат і креозот.` });
    // Примітка: це стаціонарна модель без часової осі, тож "не прогрітий" тут
    // означає "зона на сталому режимі холодніша за поріг", а не "перші хвилини
    // після розпалу". Мінімальна досяжна зона в межах UI ~590°C, тож поріг
    // потрібно підняти вище цього значення, щоб побачити попередження.
    // Механічний упор повзуна нижнього входу: нижче 20 % вторинне горіння
    // задихається навіть тоді, коли модель ще показує прийнятний λ.
    if (intake.buildable && secondaryPct < INTAKE_MIN_STOP_PCT)
      warnings.push({ level: 'warn', code: 'SECONDARY_INTAKE_LOW', message: `Повзун нижнього входу secondary ${round(secondaryPct, 0)} % < ${INTAKE_MIN_STOP_PCT} %: вторинне горіння задихається (дим, креозот). На печі поставте механічний упор ${INTAKE_MIN_STOP_PCT} %.` });
    if (catalystEnabled && !catalystActive)
      warnings.push({ level: 'info', code: 'CATALYST_COLD', message: `Каталізатор не прогрітий (${round(combustionTempC, 0)}°C < ${round(catalystLightoffC, 0)}°C) — байпас відкрито.` });
    // Норма патрубка печі ~0.4 м; довша горизонталь збирає сажу, гасить тягу
    // й вимагає більших відступів до горючих (NFPA 211 — 457 мм).
    if (roomPipeM > 0 && connectorM > 0.4)
      warnings.push({ level: 'warn', code: 'CONNECTOR_LONG', message: `Горизонтальний патрубок ${round(connectorM * 100, 0)} см > 40 см: сажа, втрата тяги, більший відступ до горючих.` });

    return {
      version: 5,
      mode,
      metrics: {
        efficiencyPct: round(efficiencyPct, 1), heatOutputKw: round(heatOutputKw, 2), burnTimeHours: round(burnTimeHours, 1),
        draftPa: round(draftPa, 1), fireboxLiters: round(fireboxLiters, 1),
        primaryOpeningAreaCm2: round(primaryOpeningAreaCm2, 2), secondaryOpeningAreaCm2: round(secondaryOpeningAreaCm2, 2),
        airWashOpeningAreaCm2: round(airWashOpeningAreaCm2, 2), chimneyAreaCm2: round(chimneyAreaCm2, 2),
        stackVelocityMs: round(stackVelocityMs, 2), secondaryVelocityMs: round(secondaryVelocityMs, 2), airWashVelocityMs: round(airWashVelocityMs, 2),
        secondaryPreheatC: round(secondaryPreheatC, 0), airWashPreheatC: round(airWashPreheatC, 0), draftFlowM3s: round(draftFlowM3s, 3),
        combustionTempC: round(combustionTempC, 0), modeledFlueTempC: round(modeledFlueTempC, 0),
        baffleExitTempC: round(baffleExitTempC, 0), bodyTempC: round(bodyTempC, 0), bodyHeatSharePct: round(bodyHeatSharePct, 1),
        woodEnergyKwhKg: round(woodEnergyKwhKg, 2), moisturePenaltyC: round(moistureTempPenaltyC, 0), moisturePct,
        combustionEfficiencyPct: round(combustionEfficiencyPct, 1), flueLossPct: round(flueLossPct, 1),
        incompleteCombustionLossPct: round(incompleteCombustionLossPct, 1), excessAirLossFactor: round(excessAirLossFactor, 3),
        thermalRetentionPct: round(thermalRetention * 100, 1), gasPathCm: round(gasPathCm, 1),
        gasResidenceSeconds: round(gasResidenceSeconds, 2), grossHeatOutputKw: round(grossHeatOutputKw, 2),
        inputEnergyKwh: round(inputEnergyKwh, 1), usefulEnergyKwh: round(usefulEnergyKwh, 1),
        recommendedLoadKg: round(recommendedLoadKg, 1), maxLoadKg: round(maxLoadKg, 1), loadingVolumePct: round((mc.fillFactor ?? 0.7) * 100, 0),
        calibrationFactor: round(calibrationFactor, 3),
        secondaryActive, catalystActive,
        equivalenceRatio: round(equivalenceRatio, 3), lambda: round(lambda, 2),
        exitFlueTempC: round(exitFlueTempC, 0),
        secondaryTotalAreaCm2: round(secondaryTotalAreaCm2, 2), tertiaryAreaCm2: round(tertiaryAreaCm2, 2),
        secondaryAirPct: round(secondaryPct, 0),
        secondaryIntakeFullCm2: round(secondaryIntakeFullCm2, 2), secondaryIntakeOpenCm2: round(secondaryIntakeOpenCm2, 2),
        secondaryPathAreaCm2: round(secondaryPathAreaCm2, 2), bottomIntakeBuildable: intake.buildable,
        secondaryIgnitionC: round(secondaryIgnitionC, 0),
        flueH, flueBends,
        outlet, route, routeBends,
        connectorCm: Math.round(connectorM * 100),
        roomPipeM: round(roomPipeM, 2),
        roomPipeGainPct: round(roomPipeGainPct, 1),
        // ККД печі + тепло додаткової труби в кімнату. Окрема довідкова
        // величина: це НЕ ККД печі і не «системний ККД» — верхній вихід у
        // реальному монтажі теж має відкриту трубу в кімнаті, просто вона
        // врахована в загальному охолодженні димоходу, а не тут.
        efficiencyWithPipePct: round(efficiencyPct + roomPipeGainPct, 1),
        stackGasC: round(stackGasC, 0),
      },
      breakdown: {
        airMix: round(airMix, 3), staging: round(staging, 2), loadKg: round(loadKg, 1),
        secondaryCoverage: round(secondaryCoverage, 2), airWashCoverage: round(airWashCoverage, 2),
        effectiveIntakeAreaCm2: round(effectiveIntakeAreaCm2, 2),
      },
      warnings,
    };
  },
};

// Порівняння верхнього й заднього виходу для ПОТОЧНОЇ печі.
// Переможця визначає МАРШРУТ, а не дерево правил: у маршруті «над піччю»
// верхній виходить прямо, а задній платить коліном і охолодженням патрубка;
// у маршруті «у стінний димохід позаду» все дзеркально (верхньому потрібні
// два повороти й довша труба в кімнаті). Крок «виграш за ККД печі» зі
// специфікації прибрано: у свипі на 960 випадках він не спрацював жодного
// разу — ККД печі задає ВНУТРІШНІЙ шлях газів (бафль, полиця, перепускна
// стінка), а не місце виходу, тож обидва варіанти дають ту саму цифру.
// values — чесні порівняльні числа для UI, не аргументи рішення.
export function compareOutlets(config) {
  const at = (outlet) => PhysicsModel.evaluate({ ...config, chimney: { ...(config?.chimney || {}), outlet } }).metrics;
  const top = at('top');
  const rear = at('rear');
  const route = config?.chimney?.route === 'wall' ? 'wall' : 'up';
  // Комір перевіряємо не лише над ПОТОЧНИМ бафлем (його підібрано під верхній
  // вихід), а й над найкращим досяжним для заднього: інакше вердикт залежав
  // від порядку дій користувача.
  let fits = rearOutletLayout(config).fits;
  let rearNeedsRedesign = false;
  if (!fits && config?.dimensions) {
    const alt = optimizeConfig({ ...structuredClone(config), chimney: { ...(config.chimney || {}), outlet: 'rear' } });
    fits = Boolean(alt && rearOutletLayout(alt.config).fits);
    rearNeedsRedesign = fits;
  }
  const winner = !fits ? 'top' : (route === 'wall' ? 'rear' : 'top');
  const code = !fits ? 'REAR_NO_ROOM' : (route === 'wall' ? 'ROUTE_WALL' : 'ROUTE_UP');
  const pct = (a, b) => (b > 0 ? round((a - b) / b * 100, 1) : 0);
  return {
    winner, code, route, fits, rearNeedsRedesign,
    values: {
      dEff: round(rear.efficiencyPct - top.efficiencyPct, 1),
      draftTop: top.draftPa, draftRear: rear.draftPa, dDraftPct: pct(rear.draftPa, top.draftPa),
      exitTop: top.exitFlueTempC, exitRear: rear.exitFlueTempC, dExitC: round(rear.exitFlueTempC - top.exitFlueTempC, 0),
      pipeGainPct: round(rear.roomPipeGainPct - top.roomPipeGainPct, 1),
      pipeCm: Math.round(clamp(+config?.chimney?.connectorLengthCm || 30, 15, 150)),
      dKwPct: pct(rear.heatOutputKw, top.heatOutputKw),
      // Лише повороти, які додає сам вихід (без слайдера «Вигинів димоходу»).
      turnsTop: OUTLET_TURNS[route].top, turnsRear: OUTLET_TURNS[route].rear,
    },
    top, rear,
  };
}

// prepare(candidate) — необовʼязковий хук, що доводить залежні від бафла поля
// (напр. діаметр труби в autodesign) до узгодженого стану перед оцінкою.
export function optimizeConfig(config, prepare) {
  let best = null;
  // Окремо тримаємо найкращого кандидата, у якого задній комір ФІЗИЧНО влазить
  // між бафлем і кришкою. Фільтрувати можна лише ПІСЛЯ prepare(): комір
  // залежить від діаметра труби, який prepare і рахує (варіант із обмеженням
  // висоти бафля від вхідного конфігу дав 10/1800 неідемпотентних випадків).
  let bestFit = null;
  const wantRear = config?.chimney?.outlet === 'rear';
  // Пошкоджений конфіг (NaN у висоті) не має зупиняти перебір: без числа
  // список кандидатів виходив порожнім і функція поверталася з null.
  const h = Number.isFinite(+config?.dimensions?.heightCm) ? +config.dimensions.heightCm : 95;
  const heightStart = Math.max(24, Math.round(h * 0.55));
  // 120 — межа baffle.heightCm у normalizeConfig: бафль вище оцінювати не можна,
  // інакше Ø труби рахувався від бафля, якого після нормалізації вже немає.
  const heightEnd = Math.min(h - 12, Math.round(h * 0.78), 120);
  const heights = [];
  for (let value = heightStart; value <= heightEnd; value += 6) heights.push(value);
  // Корпус нижче 36 см дає порожній список (heightStart 24 > heightEnd h−12).
  // Тоді беремо одну безпечну висоту, щоб оптимізатор ЗАВЖДИ повертав кандидата:
  // раніше він віддавав null, designInternals мовчки лишав бафль від попередньої
  // печі (58 см усередині 40-см корпусу → BAFFLE_TOO_HIGH і хибний обʼєм топки).
  if (!heights.length) heights.push(clamp(Math.round(h * 0.6), 20, Math.max(20, Math.round(h - 6))));
  // P7 (рішення власника, ДОСЛІДЖЕНО, НЕ ЗАСТОСОВАНО): дверцята прив'язані до
  // поду (config.js:doorOpening), а бафль оптимізатор підбирає незалежно від
  // цього — звідси перетин верху прорізу з низом бафля (5.8–20.6 см на
  // пресетах). Пробний жорсткий нижній поріг minBaffleY = openingTop +
  // shroudH + 1 і його м'якший варіант (штраф у score) обидва зрушують
  // baffleY настільки, що фактичний fireboxLiters після оптимізації
  // розходиться з ОЦІНКОЮ litersEst у autodesign.js (та рахує обʼєм топки як
  // h·0.6, не знаючи про новий поріг) — ламає інваріант «площа вторинних
  // отворів ~ обʼєму топки» на compact/wide (tests/physics.test.js:975) і
  // прибирає можливість заднього виходу для 12 з 20 пар пресет×режим
  // (комір бафля-криволінійної секції вже не влазить під кришку). Це не
  // косметичний зсув цифр, а узгоджена зміна в autodesign.js (оцінка обʼєму
  // топки) і, можливо, у rearOutletLayout — тому дефолт НЕ увімкнено, а
  // виміряні числа лишились у звіті агента. Залишено як довідка: minBaffleY
  // = doorOpening(config, steelCm).openingTop + clamp(airWash.gapCm·4,5,12) + 1.
  const angles = [-2, 2, 6, 10];
  const gaps = [4, 6, 8, 10];
  const airflows = [45, 55, 65];

  for (const heightCm of heights) for (const angleDeg of angles) for (const frontGapCm of gaps) for (const airflowPct of airflows) {
    const candidate = structuredClone(config);
    candidate.baffle.heightCm = heightCm;
    candidate.baffle.angleDeg = angleDeg;
    candidate.baffle.frontGapCm = frontGapCm;
    candidate.baffle.airflowPct = airflowPct;
    if (prepare) prepare(candidate);
    const result = PhysicsModel.evaluate(candidate);
    const penalty = result.warnings.reduce((total, warning) => total + (warning.level === 'danger' ? 20 : warning.level === 'warn' ? 6 : 1), 0);
    // Бонус «за комфортну потужність» (+2 за 2.5…12 кВт) прибрано: він був
    // сходинкою, а не фізикою — на межах діапазону перемикав бафль і робив
    // смугу ≈1.8–2.5 кВт недосяжною для серії моделей. Оцінка тепер залежить
    // лише від ККД, покриття вторинним повітрям і завісою та від попереджень.
    const score = result.metrics.efficiencyPct + result.breakdown.secondaryCoverage * 2 + result.breakdown.airWashCoverage - penalty;
    if (!best || score > best.score) best = { score, config: candidate, result };
    if (wantRear && rearOutletLayout(candidate).fits && (!bestFit || score > bestFit.score)) bestFit = { score, config: candidate, result };
  }
  // Якщо задній комір не влазить у ЖОДНОГО кандидата (на сітці 1800 печей це
  // 204 випадки: h = 40 — усі, h = 50 — 70/120), повертаємо найкращого БЕЗ
  // фільтра. Повернути null не можна: designInternals тоді лишив би бафль від
  // попередньої печі (58 см у корпусі 40 см) — BAFFLE_TOO_HIGH, топка 10 л
  // замість 3.7 л. Геометрія лишається валідною, а про неможливість заднього
  // виходу користувачу каже помилка REAR_OUTLET_NO_ROOM у validateConfig.
  return bestFit || best;
}

