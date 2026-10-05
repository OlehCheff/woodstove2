// PhysicsModel v5 — оціночна airflow/thermal модель, не CFD і не сертифікація.
import { OPERATION_PRESETS, rearOutletLayout, bottomIntakeGeometry, INTAKE_MIN_STOP_PCT, INTAKE_SLOT_RATIO } from './config.js';

// Розмір закладки (fillFactor) лежить в OPERATION_PRESETS (config.js), а не тут:
// її звідти і так перекриває spread, тож колишній дубль був мертвим. burnFactor
// прибрано зовсім — час горіння тепер рахується з енергії й потужності (див. burnRaw).
// powerFactor режиму ПРИБРАНО: суворість режиму в ВАЛОВІЙ потужності береться з положень
// слайдерів режиму (OPERATION_PRESETS) через fuelBedAir (див. нижче). Раніше вона
// кодувалась двічі — слайдерами (через airMix) і цим множником (разом ×2.9 для overnight).
// Лишилась поправка ККД режиму (effBias): вона не чіпає валову потужність і час горіння,
// але входить у ККД, а отже й у ЧИСТУ потужність heatOutputKw — там, де її не поглинає
// стеля combustionEff 92 (low/overnight; для overnight це ≈ −8 % до чистої потужності).
// Є й другий, слабкий канал: flameIntensity режиму задає T газу на патрубку (stackTempC) →
// тяга → draftFactor; він працює лише на слабкій тязі (draftFactor < 1.3 — повільні
// режими найменших печей на холодній трубі), на плато тяги його немає (REPORT §4, §7).
const MODE_COEFF = {
  'start-up':  { effBias: -4 },
  'low':       { effBias: +2 },
  'medium':    { effBias: +4 },
  'high':      { effBias: -2 },
  'overnight': { effBias: -6 },
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
// Сире значення зі слайдера → число. NaN, undefined, null, '' і рядок-не-число дають запасне
// значення: колишнє `+x ?? d` пропускало NaN (запасне бралось лише для undefined, а +undefined
// — це NaN), і той доходив до λ, тяги й k. Так evaluate скінченний і на ненормалізованому конфігу.
const numOr = (v, d) => (v == null || v === '' || !Number.isFinite(+v) ? d : +v);
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
// ---- λ із ПЛОЩ проходів, а не з відсотків слайдерів ----
// Усі входи відкриті в ту саму топку, тож за спільного перепаду тиску витрата
// крізь кожен ∝ його ВІДКРИТІЙ площі (Q = Cd·A·√(2Δp/ρ)); Cd і Δp спільні й
// входять в єдину константу AIR_OPEN_REF. airMix — частка площі, відкритої
// зараз, від площі ТІЄЇ САМОЇ печі при повністю відкритих входах (тому від
// розміру печі не залежить), поділена на AIR_OPEN_REF.
// Абсолютний баланс «витрата крізь отвори / стехіометрія палива» НЕ беремо:
// площі входів на кВт у серії WS-1…WS-10 відрізняються ≈5.5× (автопроєкт не
// масштабує primary/air-wash від потужності), тож такий λ виходить ≈13 на WS-1
// і ≈2.3 на WS-10 (Δp 12 Па) — одна константа цього не виправить.
// ОЦІНКА, не вимір: AIR_OPEN_REF підібрано так, щоб режими лишились приблизно
// там, де були (medium Φ ≈ 0.45–0.47, пік ККД біля Φ 0.5); 1/AIR_OPEN_REF = 1.5.
const AIR_OPEN_REF = 2 / 3;
// Верхня межа airWash.gapCm у normalizeConfig: «повністю відкрита» щілина завіси.
const WASH_GAP_MAX_CM = 3;
// ---- ПОТУЖНІСТЬ (швидкість горіння) задає повітря, що доходить до ложа палива ----
// λ (ККД, Φ) лишається площовою: ВЕСЬ відкритий прохід, бо надлишок повітря —
// це все повітря в топці. Швидкість же горіння палива визначає лише та частка, що
// омиває ложе: primary (отвори в передній плиті під дверцятами, на рівні ложа),
// частково air-wash (завіса біля скла входить у топку на рівні ложа) і нещільності
// (двері, шви; у цій печі глухе дно, колосника й зольника немає). Secondary
// заходить НАД ложем і лише допалює гази, тож у швидкість горіння не входить
// (вага 0; на ККД воно впливає через λ і staging, а не тут).
// fuelBedAir = 0.65·primaryOpen + 0.30·washOpen + 0.05 — «частка повітря ложа»
// 0…1 (1 = primary і air-wash повністю відкриті). primaryOpen, washOpen —
// ВІДКРИТІ частки власних площ (primary: openPct/100; air-wash: щілина/3 см ×
// intake/100), як і в airMix, тому від розміру печі вони не залежать.
// ВАГИ — ОЦІНКИ, не виміри (власник не надав даних про швидкість горіння за
// положеннями заслінок); підібрані так, щоб одночасно: primary чітко керував
// потужністю (10→95 % ≈ ×3.7), air-wash давав помірний вплив (≈ ×1.3), secondary
// ≈ нуль, п'ять режимів лежали в смугах часу горіння, overnight/medium на
// однаковій топці був 0.25–0.40, а high/medium — 1.4–1.9 (REPORT §7).
// leak — завжди відкрита частка (нещільності), як tertiary в λ; вона не дає
// повністю закритій печі нульової потужності й тримає overnight/medium ≈ 0.31.
const FUEL_BED_AIR_W = { primary: 0.65, wash: 0.30, leak: 0.05 };
// кВт на літр топки при fuelBedAir = 1 і draftFactor = 1 (ОЦІНКА, переякорено так,
// щоб default medium лишився ≈ 5.5 кВт). Плато draftFactor 1.3 вже всередині:
// на плато тяги це ≈ 0.157 кВт/л при primary і air-wash навстіж. Потужність
// ∝ об'єму топки без обрізання, і закладка теж ∝ об'єму — тому час горіння повної
// закладки від розміру печі НЕ залежить (колишній geometryFactor 0.75…1.25
// на краях серії давав розкид 1.67×).
const POWER_KW_PER_L = 0.1205;
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
// трійник коштує ζ·ρv²/2 ≈ 0.03–0.16 Па, а не ≈1.5 Па (12 % від ≈13 Па).
// Чесна частка дефіциту тяги заднього виходу — охолодження патрубка (≈ −5% і
// ≈ −25 °C на 30 см для defaultConfig, bends 0), решта −10% — ця умовність.
// 0.12 не чіпаємо, щоб не зсувати наявне калібрування; на виборі виходу воно
// не позначається.
const OUTLET_TURNS = { up: { top: 0, rear: 1 }, wall: { top: 2, rear: 1 } };
// Одностінна труба в кімнаті охолоджує гази: NTU ≈ 0.2 (газ 300 °C) …
// 0.39 (557 °C) на метр при U ≈ 2.7–5.3 Вт/м²К. Беремо 0.3/м — ОЦІНКА,
// яку варто відкалібрувати Test Burn-ом (T газу до і після патрубка).
// Це значення для ЕТАЛОННОЇ печі (default medium); для іншої печі його множимо
// на той самий coolingScale (витрата газу, Ø), що й охолодження димоходу
// (FLUE_COOLING_REF_PER_M = 0.12/м): патрубок — той самий газ і той самий Ø.
// Вертикальна труба верхнього виходу врахована в охолодженні димоходу.
const ROOM_PIPE_COOLING_PER_M = 0.3;
// Маршрут «у стінний димохід» для ВЕРХНЬОГО виходу: підйом над кришкою перед
// поворотом назад (м). Разом із проходом над піччю (0.3·глибини) це та зайва
// труба в кімнаті, якої задній вихід не має.
const TOP_WALL_RISE_M = 0.4;
const AMBIENT_C = 20;

// ---- Тяга: усі числа нижче — ОЦІНКИ зі стандартних інженерних значень ----
// Власник не надав виміряних тяги/температур (манометр на патрубку, термопара),
// тож нічого тут не відкалібровано за його піччю; див. REPORT §7.
// Охолодження газу вздовж труби: T(z) = T_довк + (T_вх − T_довк)·e^(−k·z).
// ОДИН профіль T(z) для тяги, температури на ВИХОДІ (exitFlueTempC) і
// CREOSOTE_RISK. k — NTU на метр: k ∝ U·π·D/(ṁ·cp), де ṁ — масова витрата
// димових газів, D — Ø труби, U — ефективна тепловіддача стінки в кімнату.
// Тому мала піч (ṁ у ≈15 разів менша за WS-10 на medium) остигає швидше, велика повільніше,
// а ширша труба при тій самій витраті — швидше (більший периметр).
// U і cp не вимірювали: їх «зашито» в ЕТАЛОН — default medium після designInternals
// (Ø 17.5 см, ṁ ≈ 0.0057 кг/с) має k = 0.12/м, тобто тяга 14.3 Па і вихід 184 °C.
// Це відповідає U ≈ 1.4 Вт/м²К при cp 1.1 кДж/кгК (змішана ділянка «утеплений
// сендвіч + голий патрубок»). Усі константи нижче — ОЦІНКИ (REPORT §7).
// Якщо зміниться потужність еталона (POWER_KW_PER_L, FUEL_BED_AIR_W, λ-блок), FLUE_REF_GAS_KG_S
// треба перепідігнати так, щоб default medium знову давав k = 0.12 (тест 73 це перевіряє).
const FLUE_COOLING_REF_PER_M = 0.12;
const FLUE_REF_DIAMETER_CM = 17.5;
const FLUE_REF_GAS_KG_S = 0.00569;
// Показник витрати газу в k: k = k_ет·(Ø/Ø_ет)·(ṁ_ет/ṁ)^FLUE_COOLING_FLOW_EXP. Чистий NTU зі
// сталим U дає показник 1 — це ВЕРХНЯ межа: так охолоджується ламінарна течія з опором
// зсередини (Re ≈ 450–1650 на WS-1…WS-6 у medium), у турбулентній k ∝ ṁ^-0.2, а реальна труба
// (шви, коліна, випромінювання газу, змішана конвекція) лежить між ними. 0.5 — середина
// діапазону 0.2…1, ОЦІНКА, не вимір. Показник 1 давав слабку тягу й горіння 15–20 год у
// overnight WS-1…WS-6, danger CREOSOTE_RISK у medium на WS-1…WS-4 (вихід WS-1 52 °C) і
// падіння потужності малих печей на 23–46 % від самого маршруту труби; з 0.5 danger у medium
// лишається тільки на WS-1/WS-2 (REPORT §7). Еталон показник не зсуває (ṁ_ет → множник 1).
const FLUE_COOLING_FLOW_EXP = 0.5;
// Стехіометричне повітря ≈ 4.5 кг на кг дров (ОЦІНКА): ṁ_газу = ṁ_дров·(1 + 4.5·λ).
const GAS_AIR_KG_PER_KG_WOOD = 4.5;
// Нижня межа потужності для витрати газу (кВт): запобігає діленню на нуль, на
// межі UI (піч <0.05 кВт) k стає величезним, але скінченним.
const FLUE_MIN_POWER_KW = 0.05;
// Відношення робочої тяги до теоретичної. Інтеграл плавучості для профілю T(z)
// вище дає ≈25 Па (medium, 5 м), а типова експлуатаційна тяга печі —
// 10–20 Па на 4–5 м (паспорти: 0.04–0.08 in wc = 10–20 Па; випробування за
// EN 13240 ведуть при 12 Па). Літературний діапазон відношення 0.5–0.9.
// 0.55 збирає все, чого модель не розкладає: нещільності, ковпак і вітер,
// відхилення реального профілю T від експоненти, невизначеність T на патрубку
// (120+320·flame — теж оцінка). Тертя Дарсі + місцеві опори при швидкості з
// балансу мас дають ≈0.1–1.7 Па для печей до WS-8 (0.4–1.3 м/с), але для WS-9/10
// у high/start-up вже ≈2–4 Па (до ≈13 % теоретичної тяги; оцінка при Дарсі
// f = 0.035 і сумарному ζ ≈ 1 на вході й ковпаку; при ζ ≈ 2 — до ≈7 Па).
// Окремого члена тертя немає: залежність від Ø — diaFactor (він відображає
// лише бік тертя: ширша труба тягне краще) і охолодження k ∝ D (ширша труба
// остигає швидше й тягне гірше, див. FLUE_COOLING_REF_PER_M); від вигинів —
// bendPenalty.
const DRAFT_PRACTICAL_RATIO = 0.55;
// Опорна тяга для draftFactor. Було 12 Па на СТАРІЙ шкалі тяги, що завищувала
// ≈2.1×; 6 Па — те саме відносне положення на новій шкалі, а плато 1.3 тепер
// починається від 1.3·6 ≈ 7.8 Па (≈ DRAFT_WEAK_PA), як і раніше для слабких труб.
const DRAFT_REF_PA = 6;
// Верхня межа draftFactor (плато тяги). Множник 1.3 вбудований у POWER_KW_PER_L,
// а також задає «номінальну» потужність на плато для витрати газу (ṁ нижче).
const DRAFT_FACTOR_MAX = 1.3;
// Поріг DRAFT_WEAK ≈ 0.03 in wc — нижня межа, яку ще вказують у паспортах печей.
const DRAFT_WEAK_PA = 8;
// Для overnight (повільний режим: газ остигає, тяга природно ≈6–10 Па на 5 м) 8 Па не
// попереджає, але тяга нижче 4 Па там уже справді слабка. Інакше найслабша тяга серії лишалась
// би без жодного попередження про тягу (раніше виняток для overnight нічого не ховав, бо тяга
// була вище 8 Па). ОЦІНКА, не вимір.
const DRAFT_WEAK_OVERNIGHT_PA = 4;
// Евристики швидкості (stackVelocityMs, secondaryVelocityMs, airWashVelocityMs)
// підігнані під ЗАВИЩЕНУ шкалу тяги: з них рахуються час перебування газу,
// T зони горіння, ККД і поріг AIRWASH_JETS. Щоб вони не зсунулись, переводимо
// нову тягу на стару шкалу, а не підганяємо їх заново. Це умовні евристики, а
// не баланс мас (stackVelocityMs ≈3–10× вища за нього) — REPORT §7.
const DRAFT_LEGACY_SCALE = 2.1;
// Межі draftPa — лише захист від нісенітниці (як MAX_SANE_KW), а не «робочий
// діапазон»: стару стелю 40 Па знято; в межах UI максимум ≈40 Па.
const MIN_DRAFT_PA = 1;
const MAX_SANE_DRAFT_PA = 100;

// ---- Час горіння: ці числа — ОЦІНКИ, не виміри (REPORT §7) ----
// Запасна частка максимальної закладки, якщо для режиму її немає в OPERATION_PRESETS.
const DEFAULT_FILL_FACTOR = 0.65;
// Закладка start-up — це розпалювання (≈0.3 від максимальної), і в нормі вона
// горить ≈0.7–1.2 год (у серії WS-1…WS-10 до ≈1.1). Поріг 1.8 год = 1.5× верх
// цієї смуги: довше — вогонь ледь тягне (задушене повітря, слабка тяга).
// Колишній поріг 6 год не спрацьовував би ніколи.
const STARTUP_LONG_H = 1.8;

export const PhysicsModel = {
  evaluate(config) {
    const mode = safeMode(config?.operation?.mode);
    const mc = { ...MODE_COEFF[mode], ...(OPERATION_PRESETS[mode] || {}) };
    const w = +config?.dimensions?.widthCm || 70;
    const d = +config?.dimensions?.depthCm || 55;
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
    const routeBends = flueBends + outletTurns;
    const washAsSecondary = config?.combustion?.washAsSecondary !== false;
    const tertiaryCfg = config?.combustion?.tertiary || {};
    const catalystCfg = config?.combustion?.catalyst || {};

    const primaryPct = numOr(config?.primaryAir?.openPct, 52);
    const secondaryPct = numOr(config?.operation?.secondaryAirPct, 55);
    const washGap = numOr(config?.airWash?.gapCm, 1.4);
    const washIntake = numOr(config?.airWash?.intakePct, 60);
    const washWidthPct = numOr(config?.airWash?.slotWidthPct, 94);
    const baffleFlow = numOr(config?.baffle?.airflowPct, 55);
    const baffleGap = numOr(config?.baffle?.frontGapCm, 6);
    const baffleHeight = numOr(config?.baffle?.heightCm, 58);
    const baffleAngle = numOr(config?.baffle?.angleDeg, 6);
    const flame = numOr(config?.operation?.flameIntensity, 0.62);
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
    // змінюються (фіксована частина шляху в λ не входить): нових коефіцієнтів
    // тут немає НАВМИСНО.
    // Підігрів повітря в каналі (оцінка +20…90 °C) НЕ моделюється: свого
    // коефіцієнта для нього немає, а на стелі combustionEff = 92 він лише
    // підняв би втрати в трубі. Це записано і в REPORT §7.
    const intake = bottomIntakeGeometry(config);
    const secondaryIntakeFullCm2 = intake.slotAreaCm2;
    const secondaryIntakeOpenCm2 = secondaryIntakeFullCm2 * clamp(secondaryPct, 0, 100) / 100;
    // Щілина й отвори стоять ПОСЛІДОВНО, тож опори додаються як 1/A²
    // (стандартне складання отворів, не новий коефіцієнт). Ця площа —
    // ДОВІДКОВА (реальний шлях разом із каналом): λ рахується з тієї ж
    // послідовності отворів і щілини, але без фіксованої частини каналу
    // (secondaryAirAreaCm2 нижче, біля airMix) — див. REPORT §4 і §7.
    // Незмінна частина шляху (канал, колектор, вікна в днищі, стояки) — теж послідовно.
    const fixedTerm = intake.fixedPathCm2 > 0 ? 1 / intake.fixedPathCm2 ** 2 : 0;
    const secondaryPathAreaCm2 = secondaryIntakeOpenCm2 > 0
      ? 1 / Math.sqrt(1 / secondaryOpeningAreaCm2 ** 2 + 1 / secondaryIntakeOpenCm2 ** 2 + fixedTerm)
      : (intake.buildable ? 0 : secondaryOpeningAreaCm2);

    // λ із площ (див. AIR_OPEN_REF). Вторинний шлях: отвори (× заслінка
    // baffle.airflowPct) і щілина повзуна (INTAKE_SLOT_RATIO × площі отворів ×
    // положення повзуна) стоять ПОСЛІДОВНО, тож опори 1/A² додаються — так само,
    // як у secondaryPathAreaCm2, але без каналу під днищем (його фіксована
    // частина на λ не впливає: тест на нейтральність каналу лишається чинним).
    // Вага слайдера в λ — його реальна частка площі (≈9 % відкритої площі
    // medium, ≈5 % при всьому навстіж з щілиною 3 см), а не умовні 0.35. Tertiary завжди
    // відкритий, тож входить і в відкриту, і в повну площу.
    // Блок стоїть ПЕРЕД тягою: λ і потужність потрібні для витрати газу (ṁ), від
    // якої залежить охолодження труби (k), а отже й тяга. Сама λ від тяги не залежить.
    const secondaryHolesCm2 = circleArea(+secondary.holeDiameterCm || 0.7) * (+secondary.holeCount || 10);
    const secondarySeriesCm2 = (damper, slider) => (damper > 0 && slider > 0)
      ? secondaryHolesCm2 / Math.sqrt(1 / damper ** 2 + 1 / (INTAKE_SLOT_RATIO * slider) ** 2) : 0;
    const secondaryAirAreaCm2 = secondarySeriesCm2(baffleFlow / 100, clamp(secondaryPct, 0, 100) / 100);
    const primaryFullCm2 = circleArea(+config?.primaryAir?.holeDiameterCm || 1.2) * (+config?.primaryAir?.holeCount || 8);
    const airOpenCm2 = primaryOpeningAreaCm2 + secondaryAirAreaCm2 + airWashOpeningAreaCm2 + tertiaryAreaCm2;
    const airFullCm2 = primaryFullCm2 + secondarySeriesCm2(1, 1) + slotWidthCm * WASH_GAP_MAX_CM + tertiaryAreaCm2;
    const airMix = airOpenCm2 / airFullCm2 / AIR_OPEN_REF;
    // Коефіцієнт надлишку повітря λ та Φ=1/λ (ціль Φ 0.4–0.5).
    const lambda = clamp(1.4 + airMix * 1.6, 1.1, 4);

    // Потужність без обмеження тягою: об'єм топки × питома швидкість × повітря ложа
    // (див. FUEL_BED_AIR_W). Режим впливає на неї ЛИШЕ через положення слайдерів →
    // fuelBedAir. Відкриті частки власних площ — ті самі, що в airMix для λ.
    // Тягу (draftFactor) множимо нижче: вона залежить від k, а k — від витрати газу;
    // на слабкій тязі (draftFactor < 1.3) режим додатково діє ще й через T на патрубку.
    const primaryOpen = clamp(primaryPct, 0, 100) / 100;
    const washOpen = clamp(washGap / WASH_GAP_MAX_CM, 0, 1) * clamp(washIntake, 0, 100) / 100;
    const fuelBedAir = FUEL_BED_AIR_W.primary * primaryOpen + FUEL_BED_AIR_W.wash * washOpen + FUEL_BED_AIR_W.leak;
    const burnRateKw = fireboxLiters * POWER_KW_PER_L * fuelBedAir;

    // ---- Охолодження труби: k = NTU на метр, залежить від витрати газу й Ø ----
    // Витрату рахуємо від НОМІНАЛЬНОЇ потужності на плато тяги (burnRateKw·1.3), а
    // не від фактичної: фактична множиться на draftFactor, тобто залежить від тяги,
    // а тяга — від k, тобто від витрати (замкнене коло потужність → ṁ → k → тяга →
    // потужність). На слабкій тязі це трохи завищує витрату (≤ 1/0.54), тобто
    // охолодження виходить м'якшим. Калібрування (Test Burn) на ṁ не діє.
    // ṁ_дров = P/(LHV·3600); ṁ_газу = ṁ_дров·(1 + 4.5·λ) — ОЦІНКА (стехіометрія 4.5).
    const nominalGrossKw = saneKw(burnRateKw * DRAFT_FACTOR_MAX);
    const flueGasKgS = Math.max(nominalGrossKw, FLUE_MIN_POWER_KW) / (woodEnergyKwhKg * 3600) * (1 + GAS_AIR_KG_PER_KG_WOOD * lambda);
    // Спільний множник NTU для труби й патрубка: той самий газ, той самий Ø
    // (патрубок = Ø димоходу); еталон (Ø 17.5, ṁ 0.0057 кг/с) дає рівно 1.
    // Витрата — у степені FLUE_COOLING_FLOW_EXP (0.5, ОЦІНКА; чистий NTU дав би 1).
    const coolingScale = (chimD / FLUE_REF_DIAMETER_CM) * (FLUE_REF_GAS_KG_S / flueGasKgS) ** FLUE_COOLING_FLOW_EXP;
    const flueCoolingPerM = FLUE_COOLING_REF_PER_M * coolingScale;
    // Охорона `roomPipeM > 0`: для top/up множник рівно 1 (без exp(0)), тож
    // метрики й журнали калібрування не зсуваються навіть на 1 ulp.
    const roomPipeCooling = roomPipeM > 0 ? Math.exp(-ROOM_PIPE_COOLING_PER_M * coolingScale * roomPipeM) : 1;

    // Тяга: двигун системи — ПОВНИЙ димохід (плавучисть гарячих газів).
    // Δp = g·∫(ρ_повітря − ρ_газів)dz; вигини й опір зменшують тягу.
    const baffleHeightNorm = clamp((baffleHeight - 20) / 60, 0, 1);
    const baffleAngleNorm = clamp(baffleAngle / 15, -1, 1);
    // 0.5 Па на повну висоту бафля — ОЦІНКА (було 1.2 на старій шкалі ×2.1).
    const baffleDraftPenalty = baffleHeightNorm * 0.5;
    // ВАЖЛИВО: stackTempC — температура газу НА ПАТРУБКУ (вхід у вертикаль,
    // оцінка 120 + 320·flame, +50 у high), а не середня по трубі. Раніше її брали
    // як середню на всю висоту, звідси завищена тяга; тепер середню по висоті дає
    // експоненційний профіль охолодження (інтеграл береться точно, див. нижче).
    // flame — з пресета РЕЖИМУ (0.22 overnight … 1.0 start-up), тож це другий, слабкий канал
    // суворості режиму: холодніший газ → менша тяга; на плато тяги він потужності не міняє.
    const stackTempC = clamp(120 + flame * 320 + (mode === 'high' ? 50 : 0), 120, 650);
    // Гази входять у вертикаль уже охолодженими на горизонтальному патрубку —
    // саме це, а не коліно, є фізично чесною частиною дефіциту тяги заднього
    // виходу (на defaultConfig з L = 30 см: 14.3 → 13.6 Па, тобто −5%).
    const stackGasC = roomPipeM > 0 ? AMBIENT_C + (stackTempC - AMBIENT_C) * roomPipeCooling : stackTempC;
    const rhoAir = 1.2;
    // Для ρ_газу(z) = ρ_пов·293/T(z) і T(z) = T_довк + ΔT·e^(−k·z) інтеграл
    // плавучості точний: Δp = (g·ρ_пов/k)·ln(T_вх/T_вих) у кельвінах, де
    // T_вих — температура на ВИХОДІ з труби. Підсумок множимо на DRAFT_PRACTICAL_RATIO.
    const stackOutC = AMBIENT_C + (stackGasC - AMBIENT_C) * Math.exp(-flueCoolingPerM * flueH);
    const buoyancyPa = (9.81 * rhoAir / flueCoolingPerM) * Math.log((stackGasC + 273) / (stackOutC + 273)) * DRAFT_PRACTICAL_RATIO;
    const bendPenalty = 1 / (1 + 0.12 * routeBends);
    const diaFactor = clamp((chimD / 15) ** 0.3, 0.8, 1.2);
    const draftPa = clamp(buoyancyPa * bendPenalty * diaFactor - baffleDraftPenalty, MIN_DRAFT_PA, MAX_SANE_DRAFT_PA);
    // Швидкісні евристики — на старій шкалі тяги (див. DRAFT_LEGACY_SCALE).
    const draftFitPa = draftPa * DRAFT_LEGACY_SCALE;
    const stackVelocityMs = clamp(0.75 * Math.sqrt(Math.max(draftFitPa, 0.1)), 1, 7);
    const draftFlowM3s = clamp((chimneyAreaCm2 / 10000) * stackVelocityMs, 0.003, 0.2);
    const secondaryVelocityMs = clamp((draftFitPa * 0.12) / Math.max(secondaryOpeningAreaCm2, 0.4), 0.05, 8);
    const airWashVelocityMs = clamp((draftFitPa * 0.04) / Math.max(airWashOpeningAreaCm2 / 10, 0.6), 0.05, 5);

    const secondaryDemandCm2 = clamp(fireboxLiters * 0.006, 0.4, 2.0);
    const secondaryCoverage = clamp(secondaryTotalAreaCm2 / secondaryDemandCm2, 0, 1.5);
    const airWashCoverage = clamp(airWashOpeningAreaCm2 / Math.max(doorWidth * 0.9, 1), 0, 1.5);
    const bafflePreheatBonus = baffleHeightNorm * 25 + baffleAngleNorm * 15;
    const secondaryPreheatC = clamp(20 + (+secondary.preheatLengthCm || 55) * 1.9 + flame * 95 + bafflePreheatBonus, 60, 420);
    const airWashPreheatC = clamp(20 + (+airWash.preheatLengthCm || 45) * 1.7 + flame * 65, 50, 340);
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
    // Береться з ТОГО САМОГО профілю T(z), що й тяга (stackOutC вище: від T на
    // патрубку 120+320·flame, а не від modeledFlueTempC ≈ 430–650 °C) і з тією самою
    // k, що залежить від витрати газу й Ø: мала піч або повільний режим дає
    // холодніший вихід (WS-1 medium на 5 м ≈ 124 °C, WS-10 ≈ 224 °C; default 184 °C).
    // Раніше exit рахувався від modeledFlueTempC і на low/overnight виходив
    // ГАРЯЧІШИМ за газ, що увійшов у трубу, тож CREOSOTE_RISK мовчав на кожній
    // типовій 5-метровій трубі. Тепер CREOSOTE_RISK (< 150 °C) спрацьовує там, де
    // це випливає з профілю, — ОЦІНКА (U, ṁ і T на патрубку не виміряні); REPORT §7.
    // Нижня межа — температура довкілля: газ не може вийти холоднішим за кімнату
    // (колишні 40 °C були штучними й для ≈10 % клітинок упирались у підлогу).
    const exitFlueTempC = clamp(stackOutC - routeBends * 6, AMBIENT_C, 600);
    // Тепло, яке віддає в кімнату ДОДАТКОВА одностінна труба цього маршруту
    // (горизонтальний патрубок заднього виходу або підйом+горизонталь
    // верхнього у стінний димохід). Це властивість МОНТАЖУ, а не печі, тому
    // в efficiencyPct і heatOutputKw воно НЕ входить — окрема метрика.
    // База відліку — верхній вихід із маршрутом «над піччю» (roomPipeM = 0):
    // його власна вертикальна труба вже врахована в загальному охолодженні
    // охолодженні труби (k), тож це саме ПРИРІСТ відносно нього, а не «системний ККД».
    const roomPipeGainPct = sensibleFlueLossPct * excessAirLossFactor * (1 - roomPipeCooling);
    const bodyTempC = clamp(110 + (1 - thermalRetention) * 520 + flame * 120 - (steelMm - 5) * 9, 40, 480);
    const bodyHeatSharePct = clamp((1 - thermalRetention) * 26 + 8, 8, 30);

    // Тяга обмежує потужність лише нижче DRAFT_FACTOR_MAX·DRAFT_REF_PA ≈ 8 Па
    // (слабкий димохід); вища тяга потужності не додає. Множник 1.3 — калібрувальний,
    // вбудований у POWER_KW_PER_L: так було й до переякорення (стара
    // шкала впиралась у 1.3 на всіх пресетах), тож потужність типових печей
    // не змінилась. Мала піч або повільний режим тепер остигає швидше (k), тож
    // тяга там нижча й може опуститись нижче колінки — це і є зв'язок
    // «потужність → витрата газу → охолодження → тяга → потужність».
    const draftFactor = clamp(draftPa / DRAFT_REF_PA, 0.7, DRAFT_FACTOR_MAX);
    // Потужність = burnRateKw (об'єм топки × питома швидкість × повітря ложа, див.
    // вище) × тяга.
    const grossHeatOutputKw = saneKw(burnRateKw * draftFactor);
    const heatOutputKw = saneKw(grossHeatOutputKw * efficiencyPct / 100 * calibrationFactor);
    // Орієнтир: ~120 кг/м³ насипної маси сухих полін, не щільність деревини.
    // Безпечна максимальна закладка залишає місце для полум'я та вторинного повітря.
    const maxLoadKg = fireboxLiters * 0.12 * 0.9;
    // Розмір закладки за режимом (OPERATION_PRESETS.fillFactor) — частка максимальної.
    const fillFactor = mc.fillFactor ?? DEFAULT_FILL_FACTOR;
    const recommendedLoadKg = maxLoadKg * fillFactor;
    const loadKg = recommendedLoadKg;
    const inputEnergyKwh = loadKg * woodEnergyKwhKg;
    const usefulEnergyKwh = inputEnergyKwh * efficiencyPct / 100;
    // Час горіння = енергія закладки / швидкість її віддачі: useful/heat ≡
    // input/(gross·calibration), тож ККД скорочується, а режими розрізняє лише
    // розмір закладки (fillFactor) і потужність (fuelBedAir). І закладка, і
    // потужність ∝ об'єму топки, тому на плато тяги burn ≈ 2.6·fillFactor/fuelBedAir
    // год для березових дров 15 % і від розміру печі не залежить. На слабкій тязі
    // (мала піч або повільний режим на холодній трубі, draftFactor < 1.3) потужність
    // нижча, а час горіння довший за це значення (REPORT §7). Без множників: раніше тут стояли
    // burnFactor режиму (0.72…1.75) і (1+0.015·сталь), підігнані під стару стелю
    // 14 год, і вони рахували ДВІЧІ — повільний режим уже довший через меншу
    // потужність, а множник додавав ще 38–75 % зверху (heat·burn виходило
    // 74–196 % корисної енергії дров, overnight 16–26 год). Тепломасу сталі
    // не моделюємо: вона зсуває віддачу тепла, а не час вигорання палива.
    // heatOutputKw — середня за закладку (як номінальна за EN 13240), тож
    // догорання вугілля вже всередині; окремого «хвоста» та розгону розпалу
    // стаціонарна модель не має. ОЦІНКА, не вимір (REPORT §7).
    // Межу 2…14 год знято: вона була штучною. Лишився лише запобіжник від NaN/∞
    // (і від нульової потужності) — як saneKw для потужності. Знаменник 1e-3 кВт
    // (а не 0.1): на топках <≈3 л потужність < 0.1 кВт, і більший нижній поріг
    // ламав баланс «heat·burn = корисна енергія» (час занижувався); від ∞ тут
    // захищає clamp до 200 год.
    const burnRaw = usefulEnergyKwh / Math.max(heatOutputKw, 1e-3);
    const burnTimeHours = Number.isFinite(burnRaw) ? clamp(burnRaw, 0, 200) : 0;

    const warnings = [];
    if (primaryPct < 18 && secondaryPct < 20)
      warnings.push({ level: 'warn', code: 'SMOKE_RISK', message: 'Ризик димлення: замало первинного і вторинного повітря.' });
    if (heatOutputKw > 9.0 && steelMm <= 4)
      warnings.push({ level: 'danger', code: 'OVERHEAT_RISK', message: 'Перегрів: висока потужність при сталі ≤4 мм.' });
    if (efficiencyPct < 58 && mode !== 'overnight')
      warnings.push({ level: 'warn', code: 'INEFFICIENT_MODE', message: 'Неефективний режим: ККД < 58%.' });
    if (washGap < 0.9 && flame > 0.75)
      warnings.push({ level: 'warn', code: 'DIRTY_GLASS', message: 'Закопчення скла: вузький air-wash при сильному полум’ї.' });
    // Порівнюємо з тим самим округленням, що показує повідомлення (1 знак): інакше при 7.96 Па
    // воно писало б «Слабка тяга (8 Па)». Для overnight поріг нижчий (DRAFT_WEAK_OVERNIGHT_PA).
    if (round(draftPa, 1) < (mode === 'overnight' ? DRAFT_WEAK_OVERNIGHT_PA : DRAFT_WEAK_PA))
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
    if (mode === 'start-up' && burnTimeHours > STARTUP_LONG_H)
      warnings.push({ level: 'info', code: 'STARTUP_LONG', message: 'Start-up з довгим горінням — перевірте подачу повітря.' });
    if (bodyTempC > 420 && steelMm <= 4)
      warnings.push({ level: 'danger', code: 'STEEL_OVERHEAT', message: `Корпус ~${round(bodyTempC, 0)}°C при сталі ≤4 мм: збільшіть ізоляцію або товщину сталі.` });
    if (moisturePct > 22)
      warnings.push({ level: 'warn', code: 'WET_WOOD', message: `Вологість ${round(moisturePct, 0)}% знижує температуру допалювання та ККД.` });
    if (!secondaryActive)
      warnings.push({ level: 'warn', code: 'SECONDARY_INACTIVE', message: `Вторинне горіння не запалюється: зона ${round(combustionTempC, 0)}°C < ${round(secondaryIgnitionC, 0)}°C.` });
    if (equivalenceRatio > 0.55 && mode !== 'overnight')
      warnings.push({ level: 'warn', code: 'MIX_RICH', message: `Замало повітря (Φ=${round(equivalenceRatio, 2)}): дим і CO. Додайте вторинне/третинне повітря.` });
    // Поріг 0.35, а не 0.33: Φ = 1/λ, а λ = 1.4 + 1.6·airMix; повністю відкрита
    // піч дає airMix = 1.5 (1/AIR_OPEN_REF), тобто λ = 3.8 і Φ ≈ 0.26.
    // Start-up навмисно гонить усі входи навстіж (розпал, тяга), тож Φ ≈ 0.32 там
    // норма, а не помилка — як MIX_RICH для overnight.
    if (equivalenceRatio < 0.35 && mode !== 'start-up')
      warnings.push({ level: 'info', code: 'MIX_LEAN', message: `Багато повітря (Φ=${round(equivalenceRatio, 2)}): зона охолоджується, зайві втрати.` });
    // Порівняння з тим самим округленням (до °C), що в повідомленні, інакше при 149.6 °C
    // писало б «Димові гази на виході 150°C < 150°C».
    // Рівень: < 100 °C — danger (поверхня труби стабільно нижче точки роси кислих
    // конденсатів), 100…150 °C — лише warn (межа ризику, а не аварія: так міряє й
    // практика — 150 °C це рекомендований мінімум на виході з печі, не поріг
    // поломки). Код той самий, тож усе, що спрацьовує «рівно коли вихід < 150 °C»,
    // лишилось незмінним.
    if (round(exitFlueTempC, 0) < 150)
      warnings.push({ level: round(exitFlueTempC, 0) < CREOSOTE_DANGER_C ? 'danger' : 'warn', code: 'CREOSOTE_RISK', message: `Димові гази на виході ${round(exitFlueTempC, 0)}°C < 150°C: конденсат і креозот.` });
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
        recommendedLoadKg: round(recommendedLoadKg, 1), maxLoadKg: round(maxLoadKg, 1), loadingVolumePct: round(fillFactor * 100, 0),
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
        // Охолодження труби (NTU на метр) і витрата газу, з яких воно рахується.
        flueCoolingPerM: round(flueCoolingPerM, 4), flueGasKgS: round(flueGasKgS, 5),
      },
      breakdown: {
        airMix: round(airMix, 3), fuelBedAir: round(fuelBedAir, 3), draftFactor: round(draftFactor, 3), staging: round(staging, 2), loadKg: round(loadKg, 1),
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

// ---- Вибір бафля: нічиї в оцінці реальні, тож розв'язуємо їх за правилом ----
// Оцінка кандидата майже не залежить від висоти бафля: «сирий» combustionEff
// у робочих режимах впирається у стелю 92, а ККД у метриці округлено до 0.1 п.п.
// (на 50 клітинках пресет × режим у 48 є ≥ 2 кандидати з однаковою максимальною
// оцінкою, у 35 — різної висоти). Раніше брали першого за порядком перебору
// (найнижчого), і вибір «клацав» від округлень та від порядку: потужність
// ∝ об'єму топки, тож один і той самий режим міг отримати бафль на 10–20 см
// вищий (топка на 40–50 % більша) лише через 0.1 п.п. оцінки.
// Тепер усі кандидати в межах SCORE_INDIFFERENCE від найкращого вважаються
// РІВНИМИ (різницю менше за точність моделі оцінкою не розрізняємо), а серед рівних
// беремо того, у кого найбільше secondaryCoverage — найкраще забезпечена
// вторинним повітрям топка (потреба ∝ об'єму, тож це найнижчий бафль і найменша
// топка з тих, що не гірші за ККД); далі найнижчий бафль; далі порядок перебору.
// Результат не залежить ні від порядку нічиїх, ні від попереднього бафля в конфігу
// (ідемпотентність designInternals, сесія = перезавантаження). ОЦІНКА, не вимір:
// 0.5 бала = 5 кроків округлення ККД (ціна — до −0.5 п.п. ККД проти найкращого кандидата).
// Було 0.25, але в повільних режимах ККД ще росте з бафлем (≈ +0.1 п.п. на 6 см, стеля 92
// туди не дотягує), оцінка іде похилою сходинкою, і смуга 0.25 «ловила» то нижчий, то вищий
// бафль залежно від дрібниць (охолодження труби, Ø): overnight WS-3/6/7 отримували бафль на
// 6–12 см вищий за medium (топка +13…+40 %, а потужність ∝ об'єму), а крок висоти корпусу на
// 1 см міг подвоїти потужність. 0.5 охоплює всю таку похилу ділянку на 50 клітинках.
export const SCORE_INDIFFERENCE = 0.5;
// Попередження про ДИМОХІД і РЕЖИМ, а не про внутрішню геометрію: після того, як
// охолодження труби залежить від витрати газу, вони залежать від потужності
// (тобто від об'єму топки), і оптимізатор «рятував» би піч від креозоту або слабкої
// тяги збільшенням топки (ws4 medium +33 % кВт). Те саме з SECONDARY_COLD: підігрів
// secondary задає переважно flame режиму (overnight 0.22) і фіксована довжина каналу, а
// бафль додає лише до ≈40 °C, тож штраф у 6 балів перемикав бафль на 6–12 см вище (топка
// +40 %) тільки заради зникнення цього попередження. Користувач бачить їх як є; у оцінці
// кандидата вони не штрафуються.
// Поріг рівня danger для CREOSOTE_RISK (ОЦІНКА, не вимір): нижче — danger, між ним і 150 °C — warn.
const CREOSOTE_DANGER_C = 100;
const MODE_FLUE_WARNINGS = new Set(['CREOSOTE_RISK', 'DRAFT_WEAK', 'SECONDARY_COLD']);
// pool — масив { score, coverage, config, result }; експортовано для тестів правила.
export function pickBaffleCandidate(pool) {
  if (!pool.length) return null;
  const top = Math.max(...pool.map((c) => c.score));
  let win = null;
  for (const c of pool) {
    if (c.score < top - SCORE_INDIFFERENCE - 1e-9) continue;
    if (!win || c.coverage > win.coverage || (c.coverage === win.coverage && c.config.baffle.heightCm < win.config.baffle.heightCm)) win = c;
  }
  return { score: win.score, config: win.config, result: win.result };
}

// prepare(candidate) — необовʼязковий хук, що доводить залежні від бафла поля
// (напр. діаметр труби в autodesign) до узгодженого стану перед оцінкою.
export function optimizeConfig(config, prepare) {
  // Окремо тримаємо кандидатів, у яких задній комір ФІЗИЧНО влазить
  // між бафлем і кришкою. Фільтрувати можна лише ПІСЛЯ prepare(): комір
  // залежить від діаметра труби, який prepare і рахує (варіант із обмеженням
  // висоти бафля від вхідного конфігу дав 10/1800 неідемпотентних випадків).
  const pool = [];
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
    const penalty = result.warnings.reduce((total, warning) => total + (MODE_FLUE_WARNINGS.has(warning.code) ? 0 : warning.level === 'danger' ? 20 : warning.level === 'warn' ? 6 : 1), 0);
    // Бонус «за комфортну потужність» (+2 за 2.5…12 кВт) прибрано: він був
    // сходинкою, а не фізикою — на межах діапазону перемикав бафль і робив
    // смугу ≈1.8–2.5 кВт недосяжною для серії моделей. Оцінка тепер залежить
    // лише від ККД, покриття вторинним повітрям і завісою та від попереджень
    // про геометрію (без MODE_FLUE_WARNINGS).
    const score = result.metrics.efficiencyPct + result.breakdown.secondaryCoverage * 2 + result.breakdown.airWashCoverage - penalty;
    pool.push({ score, coverage: result.breakdown.secondaryCoverage, fits: wantRear && rearOutletLayout(candidate).fits, config: candidate, result });
  }
  const best = pickBaffleCandidate(pool);
  const bestFit = pickBaffleCandidate(pool.filter((c) => c.fits));
  // Якщо задній комір не влазить у ЖОДНОГО кандидата (на сітці 1800 печей це
  // 204 випадки: h = 40 — усі, h = 50 — 70/120), повертаємо найкращого БЕЗ
  // фільтра. Повернути null не можна: designInternals тоді лишив би бафль від
  // попередньої печі (58 см у корпусі 40 см) — BAFFLE_TOO_HIGH, топка 10 л
  // замість 3.7 л. Геометрія лишається валідною, а про неможливість заднього
  // виходу користувачу каже помилка REAR_OUTLET_NO_ROOM у validateConfig.
  return bestFit || best;
}

// Φ-тюнер: підбір трьох важелів повітря (primary, secondary, air-wash intake),
// щоб Φ вийшло найближче до цілі. Air-wash — третій важіль, бо λ тепер із ПЛОЩ,
// а щілина завіси (≈78 % відкритої площі medium) домінує: без неї два слайдери
// primary/secondary рухають Φ лише в вікні ≈0.45–0.49 і не доходять до зони
// 0.4–0.5 у start-up/high/overnight. Щілина gapCm — це габарит, а не регулювання,
// тож не чіпаємо її. Межі — межі слайдерів (secondary ≥ INTAKE_MIN_STOP_PCT).
// Тюнер ТРИМАЄ ШВИДКІСТЬ ГОРІННЯ: з Φ у цільовій зоні комбінацій (p, s, w) багато,
// а primary тепер головний важіль потужності (fuelBedAir), тож без цього кроку
// «Авто в зону» міняв би потужність у ×0.35…×4.8. Тому до оцінки додано
// HOLD_BURN_RATE_W·|fuelBedAir_проби − fuelBedAir_до|: при рівній Φ беремо
// комбінацію з тим самим повітрям ложа (тобто крутимо переважно air-wash і
// secondary). ОЦІНКА, не вимір: 0.1 (на 50 клітинках пресет × режим усі Φ у
// 0.435–0.496, потужність start-up/low/medium/high ×0.93…1.07). ВИНЯТОК — overnight:
// режим задуманий багатим (Φ ≈ 0.6, MIX_RICH для нього вимкнено), тож щоб потрапити в зону
// 0.4–0.5, тюнер відкриває повітря, і потужність overnight зростає ×1.44…1.69 (на шляху
// keepBaffle; на повному шляху UI ×1.48…1.72: WS-6 1.73 → 2.57 кВт, 10.6 → 8.0 год), а Φ лягає
// у верхню частину зони (0.493–0.496 на keepBaffle, 0.467–0.491 на UI); довести її до 0.45 на
// keepBaffle коштувало б ×4.7…5.9. Тобто в overnight «Авто в зону» НЕ тримає швидкість
// горіння, а міняє її (про це сказано в підказці intakeNote). Результат однаковий для ваги
// 0.1…0.4; при 0.05 і нижче overnight знову стрибає (keepBaffle ×4.6…5.9, UI ×3.4…6.3).
const HOLD_BURN_RATE_W = 0.1;
// Нічию розв'язуємо меншим зсувом від поточних положень: 1e-5 на 1 % ходу — це
// не зсуває мету більш ніж на ≈0.003, але не дає тюнеру без потреби крутити все.
// Чиста функція (app.js лише застосовує результат), щоб її можна було тестувати.
export function fitAirToPhi(config, target = 0.45) {
  const p0 = +config?.primaryAir?.openPct || 0;
  const s0 = +config?.operation?.secondaryAirPct || 0;
  const w0 = +config?.airWash?.intakePct || 0;
  const bed0 = PhysicsModel.evaluate(config).breakdown.fuelBedAir;
  let best = null;
  for (let p = 15; p <= 95; p += 5) for (let s = INTAKE_MIN_STOP_PCT; s <= 90; s += 10) for (let w = 10; w <= 100; w += 10) {
    const probe = {
      ...config,
      primaryAir: { ...config?.primaryAir, openPct: p },
      operation: { ...config?.operation, secondaryAirPct: s },
      airWash: { ...config?.airWash, intakePct: w },
    };
    const probed = PhysicsModel.evaluate(probe);
    const phi = probed.metrics.equivalenceRatio;
    const score = Math.abs(phi - target) + HOLD_BURN_RATE_W * Math.abs(probed.breakdown.fuelBedAir - bed0)
      + 1e-5 * (Math.abs(p - p0) + Math.abs(s - s0) + Math.abs(w - w0));
    if (!best || score < best.score) best = { score, primaryPct: p, secondaryPct: s, washIntakePct: w, phi };
  }
  return best;
}

