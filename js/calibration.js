// Калібрування PhysicsModel за реальним журналом Test Burn.
// Ідея: кожен тест дає відношення measured/predicted. Ми рахуємо глобальний
// масштаб і поправку на режим, але з демпфуванням (shrinkage), щоб не
// перенавчитися на малій вибірці. Це чесніше, ніж точне підганяння під 3 точки.
import { PhysicsModel } from './physics-model.js';

const MODES = ['start-up', 'low', 'medium', 'high', 'overnight'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
const recomputeUncal = (cfg) => PhysicsModel.evaluate({
  ...cfg,
  calibration: { ...(cfg.calibration || {}), enabled: false },
}).metrics.heatOutputKw;

export function emptyCalibration() {
  return { enabled: false, damping: 0.75, globalScale: 1, modeScale: {}, samples: 0, updated: null };
}

// entries: [{ mode, predictedKw, measuredKw }, ...]
export function calibrateFromLog(entries, options = {}) {
  const damping = clamp(options.damping == null ? 0.75 : +options.damping, 0, 1);
  const excludeStartUp = options.excludeStartUp === true;
  const ratiosByMode = {};
  const all = [];
  for (const e of entries || []) {
    if (excludeStartUp && e.mode === 'start-up') continue;
    const p = +e.predictedKw;
    const m = +e.measuredKw;
    if (!(p > 0) || !(m > 0)) continue;
    const r = m / p;
    (ratiosByMode[e.mode] ||= []).push(r);
    all.push(r);
  }
  if (!all.length) return null;

  const globalScale = mean(all);
  const modeScale = {};
  for (const m of MODES) modeScale[m] = 1;
  for (const [m, arr] of Object.entries(ratiosByMode)) {
    const modeRatio = mean(arr);
    // демпфування: тягнемо поправку до 1, затискаємо в межах ±20%
    modeScale[m] = round(clamp(1 + damping * (modeRatio / globalScale - 1), 0.8, 1.2), 4);
  }

  return {
    enabled: true,
    damping,
    globalScale: round(globalScale, 4),
    modeScale,
    samples: all.length,
    updated: new Date().toISOString(),
  };
}

// Злиття нового результату калібрування з попереднім станом: результат
// calibrateFromLog/emptyCalibration не знає про налаштування користувача
// (excludeStartUp), тож без злиття прапорець мовчки повертався до дефолту.
export function mergeCalibration(cal, previous) {
  const prev = previous || {};
  return { ...cal, excludeStartUp: prev.excludeStartUp !== false };
}

function applyFactor(predictedKw, mode, calibration) {
  if (!calibration || calibration.enabled === false || !calibration.globalScale) return predictedKw;
  const modeFactor = (calibration.modeScale && calibration.modeScale[mode]) || 1;
  return predictedKw * calibration.globalScale * modeFactor;
}

// Детектор розсинхрону журналу: predictKw записаний у записі має збігатися з поточним
// прогнозом для того ж конфігу. Якщо модель оновили, а журнал зі старим прогнозом —
// помітить і покаже N записів, що розходяться.
export function detectJournalDesync(log, evalFn) {
  const evaluate = evalFn || recomputeUncal;
  let count = 0, samples = 0;
  for (const e of log || []) {
    const p = +e.predictedKw;
    if (!(p > 0) || !e.config) continue;
    samples++;
    try {
      const cur = evaluate(e.config);
      if (Number.isFinite(cur) && Math.abs(cur - p) / p > 0.05) count++;
    } catch { /* geometry mismatch */ }
  }
  return { count, samples };
}

// Статистика для UI: що було і що стало після калібрування.
export function evaluateCalibration(entries, calibration) {
  let beforeSum = 0, afterSum = 0, beforeMax = 0, afterMax = 0, n = 0;
  const rows = [];
  for (const e of entries || []) {
    const p = +e.predictedKw;
    const m = +e.measuredKw;
    if (!(p > 0) || !(m > 0)) continue;
    const before = ((p - m) / m) * 100;
    const after = ((applyFactor(p, e.mode, calibration) - m) / m) * 100;
    beforeSum += Math.abs(before); afterSum += Math.abs(after);
    beforeMax = Math.max(beforeMax, Math.abs(before));
    afterMax = Math.max(afterMax, Math.abs(after));
    n++;
    rows.push({ mode: e.mode, measuredKw: m, predictedKw: p, before, after });
  }
  if (!n) return null;
  const clamped = [];
  if (calibration && calibration.modeScale) {
    for (const [m, v] of Object.entries(calibration.modeScale)) {
      if (v <= 0.8001 || v >= 1.1999) clamped.push(m);
    }
  }
  return {
    samples: n,
    beforeMeanAbsPct: round(beforeSum / n, 2),
    afterMeanAbsPct: round(afterSum / n, 2),
    beforeMaxAbsPct: round(beforeMax, 2),
    afterMaxAbsPct: round(afterMax, 2),
    clamped,
    rows,
  };
}
