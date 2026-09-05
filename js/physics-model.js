// PhysicsModel v2 — прозора оціночна модель (не CFD).
// Входи: config (dimensions, materials, chimney, baffle, primaryAir, secondaryAir, airWash, operation)
// Виходи: { mode, metrics:{efficiencyPct, heatOutputKw, burnTimeHours, draftPa, fireboxLiters}, warnings[], breakdown{} }
import { OPERATION_PRESETS } from './config.js';

const MODE_COEFF = {
  'start-up':  { effBias: -4, powerFactor: 1.05, burnFactor: 0.72, fillFactor: 0.5 },
  'low':       { effBias: +2, powerFactor: 0.58, burnFactor: 1.38, fillFactor: 0.6 },
  'medium':    { effBias: +4, powerFactor: 0.82, burnFactor: 1.0,  fillFactor: 0.7 },
  'high':      { effBias: -2, powerFactor: 1.18, burnFactor: 0.74, fillFactor: 0.85 },
  'overnight': { effBias: -6, powerFactor: 0.42, burnFactor: 1.75, fillFactor: 1.0 },
};
const WOOD_KWH_PER_KG = 4.1; // бук, ~15% вологи
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const safeMode = (m) => (MODE_COEFF[m] ? m : 'medium');

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
    const baffleFlow = +config?.baffle?.airflowPct ?? 55;
    const baffleGap = +config?.baffle?.frontGapCm ?? 6;
    const flame = +config?.operation?.flameIntensity ?? 0.62;

    // --- топка ---
    const steelCm = steelMm / 10;
    const innerW = Math.max(10, w - steelCm * 2 - brickCm * 2);
    const innerD = Math.max(10, d - steelCm * 2 - brickCm * 2);
    const innerH = Math.max(10, h * 0.62 - brickCm); // корисна висота над колосником, під бафлем
    const fireboxLiters = (innerW * innerD * innerH) / 1000;

    // --- повітря ---
    const washEffPct = (washGap / 3) * (washIntake / 100) * 100; // 0..100
    const airMix = (primaryPct * 0.55 + secondaryPct * 0.35 + washEffPct * 0.10) / 100; // 0..1
    const staging = clamp((secondaryPct - 20) * 0.06 + (baffleFlow - 50) * 0.04, -4, +5);

    // --- тяга (спрощено: висота × переріз × температура) ---
    const draftPa = clamp((chimH / 100) * (3.2 + flame * 9) * (chimD / 15) ** 2, 4, 30);

    // --- ККД ---
    const draftBonus = (clamp(chimH / 120, 0.8, 1.25) - 1) * 8;
    const efficiencyPct = clamp(62 + airMix * 20 + staging + draftBonus + mc.effBias, 52, 86);

    // --- потужність ---
    const draftFactor = clamp(draftPa / 12, 0.7, 1.3);
    const geometryFactor = clamp((w * d * h) / 1e6 / 0.36, 0.75, 1.25);
    const heatOutputKw = clamp(
      fireboxLiters * 0.065 * (0.35 + 0.65 * airMix) * mc.powerFactor * draftFactor * geometryFactor,
      2.0, 16.0
    );

    // --- час горіння: енергія закладки / потужність ---
    const loadKg = fireboxLiters * 0.10 * (mc.fillFactor ?? 0.7);
    const burnTimeHours = clamp(
      ((loadKg * WOOD_KWH_PER_KG * (efficiencyPct / 100)) / Math.max(heatOutputKw, 0.1)) * mc.burnFactor * (1 + steelMm * 0.015),
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
    if (mode === 'start-up' && burnTimeHours > 6)
      warnings.push({ level: 'info', code: 'STARTUP_LONG', message: 'Start-up з довгим горінням — перевірте подачу повітря.' });

    return {
      mode,
      metrics: {
        efficiencyPct: round(efficiencyPct, 1),
        heatOutputKw: round(heatOutputKw, 2),
        burnTimeHours: round(burnTimeHours, 1),
        draftPa: round(draftPa, 1),
        fireboxLiters: round(fireboxLiters, 1),
      },
      breakdown: { airMix: round(airMix, 3), staging: round(staging, 2), loadKg: round(loadKg, 1) },
      warnings,
    };
  },
};

// Node-сумісність для тестів
if (typeof module !== 'undefined' && module.exports) module.exports = { PhysicsModel };
// Браузерний fallback (не-модульний доступ)
if (typeof window !== 'undefined') window.PhysicsModel = PhysicsModel;
