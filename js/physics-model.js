// PhysicsModel v3 — оціночна airflow/thermal модель, не CFD і не сертифікація.
import { OPERATION_PRESETS } from './config.js';

const MODE_COEFF = {
  'start-up':  { effBias: -4, powerFactor: 1.05, burnFactor: 0.72, fillFactor: 0.5 },
  'low':       { effBias: +2, powerFactor: 0.58, burnFactor: 1.38, fillFactor: 0.6 },
  'medium':    { effBias: +4, powerFactor: 0.82, burnFactor: 1.0,  fillFactor: 0.7 },
  'high':      { effBias: -2, powerFactor: 1.18, burnFactor: 0.74, fillFactor: 0.85 },
  'overnight': { effBias: -6, powerFactor: 0.42, burnFactor: 1.75, fillFactor: 0.7 },
};
const WOOD_KWH_PER_KG = 4.1;
const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const safeMode = (m) => (MODE_COEFF[m] ? m : 'medium');
const circleArea = (diameterCm) => PI * (diameterCm / 2) ** 2;

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
    const chimH = +config?.chimney?.heightCm || 120;

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

    const secondary = config?.secondaryAir || {};
    const airWash = config?.airWash || {};
    const steelCm = steelMm / 10;
    const linerCm = brickCm + insulationCm;
    const innerW = Math.max(10, w - steelCm * 2 - linerCm * 2);
    const innerD = Math.max(10, d - steelCm * 2 - linerCm * 2);
    const innerH = Math.max(10, h * 0.62 - linerCm);
    const fireboxLiters = (innerW * innerD * innerH) / 1000;

    // Фізичні площі проходів, а не тільки UI-відсотки.
    const primaryOpeningAreaCm2 = circleArea(+config?.primaryAir?.holeDiameterCm || 1.2) * (+config?.primaryAir?.holeCount || 8) * primaryPct / 100;
    const secondaryOpeningAreaCm2 = circleArea(+secondary.holeDiameterCm || 0.7) * (+secondary.holeCount || 10) * (baffleFlow / 100);
    const doorWidth = Math.max(20, Math.min(+config?.door?.widthCm || 42, w - steelCm * 4));
    const slotWidthCm = doorWidth * washWidthPct / 100;
    const airWashOpeningAreaCm2 = slotWidthCm * washGap * washIntake / 100;
    const chimneyAreaCm2 = circleArea(chimD);
    const effectiveIntakeAreaCm2 = primaryOpeningAreaCm2 + secondaryOpeningAreaCm2 + airWashOpeningAreaCm2;

    // Тяга і пропускна здатність: спрощена модель для порівняння варіантів.
    const baffleHeightNorm = clamp((baffleHeight - 20) / 60, 0, 1);
    const baffleAngleNorm = clamp(baffleAngle / 15, -1, 1);
    const baffleDraftPenalty = baffleHeightNorm * 1.2;
    const draftPa = clamp((chimH / 100) * (3.2 + flame * 9) * (chimD / 15) ** 2 - baffleDraftPenalty, 4, 30);
    const stackVelocityMs = clamp(0.75 * Math.sqrt(Math.max(draftPa, 0.1)), 1, 6);
    const draftFlowM3s = clamp((chimneyAreaCm2 / 10000) * stackVelocityMs, 0.003, 0.15);
    const secondaryVelocityMs = clamp((draftPa * 0.12) / Math.max(secondaryOpeningAreaCm2, 0.4), 0.05, 8);
    const airWashVelocityMs = clamp((draftPa * 0.04) / Math.max(airWashOpeningAreaCm2 / 10, 0.6), 0.05, 5);

    const secondaryDemandCm2 = clamp(fireboxLiters * 0.02, 2, 12);
    const secondaryCoverage = clamp(secondaryOpeningAreaCm2 / secondaryDemandCm2, 0, 1.5);
    const airWashCoverage = clamp(airWashOpeningAreaCm2 / Math.max(doorWidth * 0.9, 1), 0, 1.5);
    const bafflePreheatBonus = baffleHeightNorm * 25 + baffleAngleNorm * 15;
    const secondaryPreheatC = clamp(20 + (+secondary.preheatLengthCm || 55) * 1.9 + flame * 95 + bafflePreheatBonus, 60, 420);
    const airWashPreheatC = clamp(20 + (+airWash.preheatLengthCm || 45) * 1.7 + flame * 65, 50, 340);
    const washEffPct = clamp((washGap / 3) * (washIntake / 100) * 100, 0, 100);
    const airMix = (primaryPct * 0.55 + secondaryPct * 0.35 + washEffPct * 0.10) / 100;
    const staging = clamp((secondaryPct - 20) * 0.06 + (baffleFlow - 50) * 0.04, -4, +5);
    const draftBonus = (clamp(chimH / 120, 0.8, 1.25) - 1) * 8;

    // Thermal architecture: a hotter insulated firebox, a defined gas path,
    // and heat extraction after secondary combustion. This remains an estimate,
    // not CFD or a certification calculation.
    const thermalRetention = clamp(0.58 + insulationCm * 0.055 + baffleRefractoryCm * 0.035, 0.58, 0.94);
    const gasPathCm = Math.max(20, baffleHeight * 0.55 + Math.max(8, innerD - baffleGap) * 0.65 + heatExchangePasses * innerD * 0.8) * (1 / Math.max(Math.cos(baffleAngle * Math.PI / 180), 0.75));
    const gasResidenceSeconds = clamp((gasPathCm / 100) / Math.max(stackVelocityMs, 0.2), 0.15, 8);
    const combustionTempC = clamp(480 + flame * 260 + secondaryPreheatC * 0.55 + thermalRetention * 160 + gasResidenceSeconds * 12, 450, 1100);
    const targetTemperatureFit = clamp(2 - Math.abs(combustionTempC - targetCombustionTempC) / 180, -2, 2);
    const secondaryQuality = clamp((secondaryCoverage - 0.75) * 4 + (secondaryPreheatC - 160) / 120, -3, 4);
    const combustionEfficiencyPct = clamp(
      68 + (combustionTempC - 600) * 0.04 + secondaryQuality * 1.2 + thermalRetention * 5 + gasResidenceSeconds
        + airMix * 5 + staging + draftBonus * 0.3 + targetTemperatureFit + mc.effBias,
      48, 92
    );
    const modeledFlueTempC = clamp(combustionTempC - heatExchangePasses * 110 - insulationCm * 18 - baffleRefractoryCm * 12, 120, 650);
    const flueLossPct = clamp(7 + (modeledFlueTempC - 150) * 0.025 + (1 - thermalRetention) * 8 - heatExchangePasses * 1.5, 8, 28);
    const efficiencyPct = clamp(combustionEfficiencyPct - flueLossPct, 35, 88);

    const draftFactor = clamp(draftPa / 12, 0.7, 1.3);
    const geometryFactor = clamp((w * d * h) / 1e6 / 0.36, 0.75, 1.25);
    const grossHeatOutputKw = clamp(
      fireboxLiters * 0.105 * (0.35 + 0.65 * airMix) * mc.powerFactor * draftFactor * geometryFactor,
      1.5, 24.0
    );
    const heatOutputKw = clamp(
      grossHeatOutputKw * efficiencyPct / 100,
      1.0, 20.0
    );
    // Орієнтир: ~120 кг/м³ насипної маси сухих полін, не щільність деревини.
    // Безпечна максимальна закладка залишає місце для полум'я та вторинного повітря.
    const maxLoadKg = fireboxLiters * 0.12 * 0.9;
    const recommendedLoadKg = maxLoadKg * (mc.fillFactor ?? 0.7);
    const loadKg = recommendedLoadKg;
    const inputEnergyKwh = loadKg * WOOD_KWH_PER_KG * 0.85;
    const usefulEnergyKwh = inputEnergyKwh * efficiencyPct / 100;
    const burnTimeHours = clamp(
      (usefulEnergyKwh / Math.max(heatOutputKw, 0.1)) * mc.burnFactor * (1 + steelMm * 0.015),
      2.0, 14.0
    );

    const warnings = [];
    if (primaryPct < 22 && secondaryPct < 30)
      warnings.push({ level: 'warn', code: 'SMOKE_RISK', message: 'Ризик димлення: замало первинного і вторинного повітря.' });
    if (heatOutputKw > 9.0 && steelMm <= 4)
      warnings.push({ level: 'danger', code: 'OVERHEAT_RISK', message: 'Перегрів: висока потужність при сталі ≤4 мм.' });
    if (efficiencyPct < 62)
      warnings.push({ level: 'warn', code: 'INEFFICIENT_MODE', message: 'Неефективний режим: ККД < 62%.' });
    if (washGap < 0.9 && flame > 0.75)
      warnings.push({ level: 'warn', code: 'DIRTY_GLASS', message: 'Закопчення скла: вузький air-wash при сильному полум’ї.' });
    if (draftPa < 8)
      warnings.push({ level: 'warn', code: 'DRAFT_WEAK', message: `Слабка тяга (${round(draftPa, 1)} Па): збільшіть висоту/Ø димоходу або інтенсивність.` });
    if (baffleGap > 12)
      warnings.push({ level: 'info', code: 'BAFFLE_GAP', message: 'Великий передній зазор бафля — гази йдуть повз догорання.' });
    if (secondaryCoverage < 0.62)
      warnings.push({ level: 'warn', code: 'SECONDARY_RESTRICTED', message: 'Замала площа secondary-отворів для обʼєму топки.' });
    if (secondaryPreheatC < 130)
      warnings.push({ level: 'warn', code: 'SECONDARY_COLD', message: 'Secondary air недостатньо підігрівається перед догоранням.' });
    if (airWashVelocityMs > 2.0 && washWidthPct < 80)
      warnings.push({ level: 'warn', code: 'AIRWASH_JETS', message: 'Air-wash може працювати струменями: розширте slot або зменште intake.' });
    if (airWashCoverage < 0.55)
      warnings.push({ level: 'warn', code: 'AIRWASH_LOW', message: 'Недостатнє покриття скла повітряною завісою.' });
    if (mode === 'start-up' && burnTimeHours > 6)
      warnings.push({ level: 'info', code: 'STARTUP_LONG', message: 'Start-up з довгим горінням — перевірте подачу повітря.' });

    return {
      version: 4,
      mode,
      metrics: {
        efficiencyPct: round(efficiencyPct, 1), heatOutputKw: round(heatOutputKw, 2), burnTimeHours: round(burnTimeHours, 1),
        draftPa: round(draftPa, 1), fireboxLiters: round(fireboxLiters, 1),
        primaryOpeningAreaCm2: round(primaryOpeningAreaCm2, 2), secondaryOpeningAreaCm2: round(secondaryOpeningAreaCm2, 2),
        airWashOpeningAreaCm2: round(airWashOpeningAreaCm2, 2), chimneyAreaCm2: round(chimneyAreaCm2, 2),
        stackVelocityMs: round(stackVelocityMs, 2), secondaryVelocityMs: round(secondaryVelocityMs, 2), airWashVelocityMs: round(airWashVelocityMs, 2),
        secondaryPreheatC: round(secondaryPreheatC, 0), airWashPreheatC: round(airWashPreheatC, 0), draftFlowM3s: round(draftFlowM3s, 3),
        combustionTempC: round(combustionTempC, 0), modeledFlueTempC: round(modeledFlueTempC, 0),
        combustionEfficiencyPct: round(combustionEfficiencyPct, 1), flueLossPct: round(flueLossPct, 1),
        thermalRetentionPct: round(thermalRetention * 100, 1), gasPathCm: round(gasPathCm, 1),
        gasResidenceSeconds: round(gasResidenceSeconds, 2), grossHeatOutputKw: round(grossHeatOutputKw, 2),
        inputEnergyKwh: round(inputEnergyKwh, 1), usefulEnergyKwh: round(usefulEnergyKwh, 1),
        recommendedLoadKg: round(recommendedLoadKg, 1), maxLoadKg: round(maxLoadKg, 1), loadingVolumePct: round((mc.fillFactor ?? 0.7) * 100, 0),
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

export function optimizeConfig(config) {
  let best = null;
  const h = config.dimensions.heightCm;
  const heightStart = Math.max(24, Math.round(h * 0.42));
  const heightEnd = Math.min(h - 12, Math.round(h * 0.74));
  const heights = [];
  for (let value = heightStart; value <= heightEnd; value += 6) heights.push(value);
  const angles = [-2, 2, 6, 10];
  const gaps = [4, 6, 8, 10];
  const airflows = [45, 55, 65];

  for (const heightCm of heights) for (const angleDeg of angles) for (const frontGapCm of gaps) for (const airflowPct of airflows) {
    const candidate = structuredClone(config);
    candidate.baffle.heightCm = heightCm;
    candidate.baffle.angleDeg = angleDeg;
    candidate.baffle.frontGapCm = frontGapCm;
    candidate.baffle.airflowPct = airflowPct;
    const result = PhysicsModel.evaluate(candidate);
    const penalty = result.warnings.reduce((total, warning) => total + (warning.level === 'danger' ? 20 : warning.level === 'warn' ? 6 : 1), 0);
    const comfortBonus = result.metrics.heatOutputKw >= 2.5 && result.metrics.heatOutputKw <= 12 ? 2 : 0;
    const score = result.metrics.efficiencyPct + result.breakdown.secondaryCoverage * 2 + result.breakdown.airWashCoverage + comfortBonus - penalty;
    if (!best || score > best.score) best = { score, config: candidate, result };
  }
  return best;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { PhysicsModel };
if (typeof window !== 'undefined') window.PhysicsModel = PhysicsModel;
