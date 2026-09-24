// Автопроєктування внутрішньої геометрії під макс. ККД.
// Користувач задає лише зовнішні габарити, дверцята і матеріали.
// Усе інше (бафль, повітряні отвори, канали, ізоляція, димохід) рахується тут.
import { normalizeConfig, sizeSecondaryHoles, secondaryTubeLengthCm, secondaryHolePattern } from './config.js';
import { optimizeConfig } from './physics-model.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// Чи влазить уже збережений бафль у корпус (ті самі правила, що й у
// config.js:validateConfig — BAFFLE_TOO_HIGH і BAFFLE_REFRACTORY_HIGH).
function baffleFitsBody(cfg) {
  const h = +cfg.dimensions.heightCm;
  const steelCm = (+cfg.materials.steelThicknessMm || 5) / 10;
  const refrT = cfg.thermal?.baffleRefractoryThicknessCm == null ? 3 : +cfg.thermal.baffleRefractoryThicknessCm;
  const b = +cfg.baffle.heightCm;
  return Number.isFinite(b) && b >= 20 && b < h - steelCm * 3 && b + refrT < h - steelCm * 2;
}

// options.keepBaffle — збережена/поділена геометрія авторитетна: бафль не
// перепідбирається. Потрібно, щоб та сама піч після F5 показувала ТІ САМІ
// цифри, що й у сесії (у сесії слайдери повітря/вологості/димоходу бафль не
// рухають, а завантаження раніше ганяло оптимізатор і мовчки міняло і бафль,
// і діаметр труби). Бафль, який фізично не влазить у корпус, перераховується
// попри прапорець.
export function designInternals(cfg, options = {}) {
  const w = +cfg.dimensions.widthCm;
  const d = +cfg.dimensions.depthCm;
  const h = +cfg.dimensions.heightCm;
  const steelCm = (+cfg.materials.steelThicknessMm || 5) / 10;

  // Ергономіка дверцят — фіксовані найкращі значення.
  cfg.door.glassInsetCm = 2;
  cfg.door.frameThicknessCm = 3;
  cfg.door.openAngleDeg = 70;
  // Обрізаємо від "бажаного" розміру (останній навмисний вибір користувача),
  // а не від поточного widthCm/heightCm — інакше після зменшення печі
  // дверцята обрізались один раз і вже ніколи не поверталися до нормального
  // розміру, навіть коли піч знову ставала достатньо великою.
  cfg.door.widthCm = clamp(+cfg.door.preferredWidthCm || +cfg.door.widthCm || 42, 20, Math.max(20, w - 6));
  cfg.door.heightCm = clamp(+cfg.door.preferredHeightCm || +cfg.door.heightCm || 38, 20, Math.max(20, h - 10));

  // Висота труби масштабується від розміру печі. Діаметр рахується нижче,
  // після підбору бафля — він залежить від об'єму топки, а топка залежить
  // від фінальної висоти бафля.
  cfg.chimney.heightCm = clamp(Math.round((110 + (h - 60) * 0.5) / 5) * 5, 100, 150);

  // Primary: кількість/крок отворів від ширини.
  cfg.primaryAir.holeCount = clamp(Math.round(w / 8), 3, 14);
  cfg.primaryAir.holeDiameterCm = 1.2;
  cfg.primaryAir.holeSpacingCm = clamp(round((w - 6) / Math.max(1, cfg.primaryAir.holeCount - 1), 1), 2, 8);

  // Secondary: поперечна SS-труба з отворами; кількість і Ø масштабуються від
  // топки (sizeSecondaryHoles у config.js — там же й обґрунтування 0.082 см²/л).
  // Було «~1% об'єму топки, стеля 4 см²» → 15×Ø3 мм = 1.06 см² на Standard,
  // тобто 2.7 % площі всіх входів повітря: повзун secondary у Φ-тюнері рухав
  // λ 2.01→2.46, чого залізо з такими отворами фізично дати не могло.
  const linerCmEst = (+cfg.materials.firebrickThicknessCm || 4) + 3;
  const innerWEst = Math.max(10, w - steelCm * 2 - linerCmEst * 2);
  const innerDEst = Math.max(10, d - steelCm * 2 - linerCmEst * 2);
  const innerHEst = Math.max(10, Math.round(h * 0.6) - steelCm - linerCmEst);
  const litersEst = (innerWEst * innerDEst * innerHEst) / 1000;
  const secHoles = sizeSecondaryHoles(litersEst, secondaryTubeLengthCm(cfg));
  cfg.secondaryAir.holeDiameterCm = secHoles.holeDiameterCm;
  cfg.secondaryAir.holeCount = secHoles.holeCount;
  cfg.secondaryAir.holeSpacingCm = clamp(round(secondaryHolePattern(cfg).pitchCm, 1), 1.0, 4);
  // Стояк ширшаємо так, щоб два вікна в днищі під ним (≈(ш−1)×2 см кожне на товстій сталі)
  // мали ≥1.2× площі отворів труби — інакше на великих печах вузьким місцем
  // шляху стають вікна, а не отвори (workshop: 17.6 проти 33.8 см²).
  const secHolesCm2 = Math.PI * (secHoles.holeDiameterCm / 2) ** 2 * secHoles.holeCount;
  cfg.secondaryAir.channelWidthCm = clamp(Math.ceil(1.2 * secHolesCm2 / (2 * 2) + 1), 5, 12);
  cfg.secondaryAir.channelDepthCm = 4;
  cfg.secondaryAir.preheatLengthCm = clamp(Math.round(h * 0.55), 15, 140);
  cfg.secondaryAir.manifoldHeightCm = 4;

  // Air-wash.
  cfg.airWash.channelWidthCm = 4;
  cfg.airWash.channelDepthCm = 4;
  cfg.airWash.preheatLengthCm = 45;
  cfg.airWash.slotWidthPct = 94;

  // Теплова архітектура на максимум ефективності.
  cfg.thermal.insulationThicknessCm = 3;
  cfg.thermal.baffleRefractoryThicknessCm = 3;
  cfg.thermal.targetCombustionTempC = 850;
  cfg.thermal.heatExchangePasses = 2;

  // Шамот обмежуємо, щоб фізично лишалася топка (інакше 30 см + 8 см шамоту = 0 об'єму).
  const minDim = Math.min(w, d);
  const maxBrick = Math.max(2, Math.floor(((minDim - steelCm * 2 - 8.5) / 2 - 3) * 2) / 2);
  cfg.materials.firebrickThicknessCm = Math.min(+cfg.materials.firebrickThicknessCm || 4, maxBrick);
  cfg.thermal.insulationThicknessCm = Math.min(3, Math.max(1, (minDim - steelCm * 2 - 8.5) / 2 - cfg.materials.firebrickThicknessCm));

  normalizeConfig(cfg);

  // Бафль підбираємо оптимізатором (висота/кут/зазор/приток) під поточний режим.
  // Кожен кандидат оцінюється з тим діаметром труби, який для нього й буде
  // розраховано нижче: інакше результат залежав від діаметра з ПОПЕРЕДНЬОГО
  // виклику, і повторне автопроєктування тієї ж печі давало інший бафль.
  if (!(options.keepBaffle && baffleFitsBody(cfg))) {
    const best = optimizeConfig(cfg, (candidate) => { candidate.chimney.diameterCm = chimneyDiameterFor(candidate); });
    if (best) {
      cfg.baffle.heightCm = best.config.baffle.heightCm;
      cfg.baffle.angleDeg = best.config.baffle.angleDeg;
      cfg.baffle.frontGapCm = best.config.baffle.frontGapCm;
      cfg.baffle.airflowPct = best.config.baffle.airflowPct;
    }
  }
  // Пост-умова: бафль ніколи не лишається вищим за корпус. Раніше
  // optimizeConfig міг повернути null (корпус < 36 см), і в печі 40 см
  // мовчки лишався бафль 58 см з попередньої геометрії — BAFFLE_TOO_HIGH
  // і завищений обʼєм топки у фізиці.
  const refrT = cfg.thermal?.baffleRefractoryThicknessCm == null ? 3 : +cfg.thermal.baffleRefractoryThicknessCm;
  // Висоту беремо з уже нормалізованого конфігу, а не з локальної h (вона
  // прочитана до normalizeConfig і могла бути поза межами).
  const steelCmN = (+cfg.materials.steelThicknessMm || 5) / 10;
  const baffleMax = +cfg.dimensions.heightCm - Math.max(steelCmN * 3, steelCmN * 2 + refrT) - 0.5;
  cfg.baffle.heightCm = clamp(+cfg.baffle.heightCm || 20, 20, Math.max(20, round(baffleMax, 1)));

  // Діаметр труби — середина того самого коридору [flueMinCm, flueMaxCm],
  // який config.js:validateConfig рахує з обсягу топки (та сама формула).
  // Рахуємо тут, а не на початку функції, бо коридор залежить від фінальної
  // висоти бафля (topка вище бафля вже не рахується як об'єм топки), і без
  // цього автопідбір діаметра й валідатор регулярно сперечались одне з одним
  // (CHIMNEY_NARROW/CHIMNEY_LARGE навіть на «нормальних» печах).
  cfg.chimney.diameterCm = chimneyDiameterFor(cfg);

  return normalizeConfig(cfg);
}

function chimneyDiameterFor(cfg) {
  const w = +cfg.dimensions.widthCm, d = +cfg.dimensions.depthCm, h = +cfg.dimensions.heightCm;
  const steelCm = (+cfg.materials.steelThicknessMm || 5) / 10;
  const linerFlue = cfg.materials.firebrickThicknessCm + cfg.thermal.insulationThicknessCm;
  const fbW = Math.max(10, w - steelCm * 2 - linerFlue * 2);
  const fbD = Math.max(10, d - steelCm * 2 - linerFlue * 2);
  const fbH = Math.max(10, Math.min(cfg.baffle.heightCm, h) - steelCm - linerFlue);
  const flueLiters = (fbW * fbD * fbH) / 1000;
  const flueMinCm = Math.max(10, Math.min(18, 11 + flueLiters * 0.03));
  const flueMaxCm = Math.max(14, Math.min(25, 17 + flueLiters * 0.05));
  return clamp(Math.round(((flueMinCm + flueMaxCm) / 2 - steelCm) * 2) / 2, 10, 25);
}
