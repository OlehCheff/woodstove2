// Автопроєктування внутрішньої геометрії під макс. ККД.
// Користувач задає лише зовнішні габарити, дверцята і матеріали.
// Усе інше (бафль, повітряні отвори, канали, ізоляція, димохід) рахується тут.
import { normalizeConfig } from './config.js';
import { optimizeConfig } from './physics-model.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function designInternals(cfg) {
  const w = +cfg.dimensions.widthCm;
  const d = +cfg.dimensions.depthCm;
  const h = +cfg.dimensions.heightCm;
  const steelCm = (+cfg.materials.steelThicknessMm || 5) / 10;

  // Ергономіка дверцят — фіксовані найкращі значення.
  cfg.door.glassInsetCm = 2;
  cfg.door.frameThicknessCm = 3;
  cfg.door.openAngleDeg = 70;
  cfg.door.widthCm = clamp(+cfg.door.widthCm || 42, 20, Math.max(20, w - 6));
  cfg.door.heightCm = clamp(+cfg.door.heightCm || 38, 20, Math.max(20, h - 10));

  // Димохід масштабується від розміру печі.
  cfg.chimney.diameterCm = clamp(round(Math.sqrt(w * d) * 0.24 * 2) / 2, 10, 25);
  cfg.chimney.heightCm = clamp(Math.round((110 + (h - 60) * 0.5) / 5) * 5, 100, 150);

  // Primary: кількість/крок отворів від ширини.
  cfg.primaryAir.holeCount = clamp(Math.round(w / 8), 3, 14);
  cfg.primaryAir.holeDiameterCm = 1.2;
  cfg.primaryAir.holeSpacingCm = clamp(round((w - 6) / Math.max(1, cfg.primaryAir.holeCount - 1), 1), 2, 8);

  // Secondary: поперечна SS-труба з отворами Ø3 мм; кількість масштабується від топки.
  // Орієнтир сумарної площі вторинного входу ~1% об'єму топки (0.6–3 см²).
  const linerCmEst = (+cfg.materials.firebrickThicknessCm || 4) + 3;
  const innerWEst = Math.max(10, w - steelCm * 2 - linerCmEst * 2);
  const innerDEst = Math.max(10, d - steelCm * 2 - linerCmEst * 2);
  const innerHEst = Math.max(10, Math.round(h * 0.6) - steelCm - linerCmEst);
  const litersEst = (innerWEst * innerDEst * innerHEst) / 1000;
  const targetSecArea = clamp(litersEst * 0.01, 1.0, 4.0);
  cfg.secondaryAir.holeDiameterCm = 0.3;
  cfg.secondaryAir.holeCount = clamp(Math.round(targetSecArea / (Math.PI * 0.15 * 0.15)), 8, 60);
  cfg.secondaryAir.holeSpacingCm = clamp(round((w * 0.8) / Math.max(1, cfg.secondaryAir.holeCount), 1), 1.0, 4);
  cfg.secondaryAir.channelWidthCm = 5;
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
  const best = optimizeConfig(cfg);
  if (best) {
    cfg.baffle.heightCm = best.config.baffle.heightCm;
    cfg.baffle.angleDeg = best.config.baffle.angleDeg;
    cfg.baffle.frontGapCm = best.config.baffle.frontGapCm;
    cfg.baffle.airflowPct = best.config.baffle.airflowPct;
  }
  return normalizeConfig(cfg);
}
