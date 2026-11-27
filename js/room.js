// Підбір печі під приміщення: потрібна потужність з об'єму/площі та призначення,
// далі автопідбір габаритів (з внутрішньою геометрією під макс. ККД).
import { normalizeConfig, applyModePreset } from './config.js';
import { OVERSIZE_RATIO } from './thresholds.js';
import { PhysicsModel } from './physics-model.js';
import { designInternals } from './autodesign.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

// kwPerM3 — потрібна потужність на 1 м³; reserve — запас на прогрів і мороз
// (середня смуга України). Значення — інженерні орієнтири, не сертифікація.
export const PURPOSES = {
  sauna:    { labelKey: 'purposeSauna',    kwPerM3: 1 / 1.3, reserve: 1.15, mode: 'high',   minVol: 4,  maxVol: 60 },
  room:     { labelKey: 'purposeRoom',     kwPerM3: 1 / 14,  reserve: 1.20, mode: 'medium', minVol: 20, maxVol: 500 },
  workshop: { labelKey: 'purposeWorkshop', kwPerM3: 1 / 20,  reserve: 1.30, mode: 'high',   minVol: 30, maxVol: 1000 },
};

// Поріг «піч завелика» (OVERSIZE_RATIO) живе в thresholds.js разом з іншими порогами.
export { OVERSIZE_RATIO };

export function roomVolume(room) {
  if (!room) return 60;
  return room.inputMode === 'area'
    ? (+room.areaM2 || 30) * (+room.ceilingM || 2.7)
    : (+room.volumeM3 || 60);
}

// Потреба приміщення, а не можливості печі. Колишні межі 1…20 кВт просто
// повторювали штучні межі моделі: майстерня на 1000 м³ «потребувала» 20 кВт
// замість 65, а кімната на 3 м³ — 1 кВт замість 0.26. Лишаємо тільки
// санітарні межі, щоб число не було нулем чи абсурдом.
export function requiredPowerKw(purpose, volumeM3) {
  const p = PURPOSES[purpose] || PURPOSES.room;
  return clamp(volumeM3 * p.kwPerM3 * p.reserve, 0.2, 100);
}

// Підбір габаритів: масштабуємо пропорційну форму і беремо найближчу потужність.
// Двофазний пошук: грубий скан (крок 0.05, як раніше) + точний прохід лише
// навколо найкращого грубого кандидата. Суцільний дрібний крок на всьому
// діапазоні майже потроїв час одного кліку (кожен designInternals() сам
// запускає перебір бафля), а вузький другий прохід ловить ту саму точність
// (сусідні grid-точки коарс-скану інколи давали розрив 1.34→2.62 кВт при
// цілі 1.95 кВт — майстерня 30 м³, похибка −31%) майже без втрати швидкодії.
export function sizeStoveForPower(targetKw, baseCfg) {
  const shape = { w: 70, d: 55, h: 95 };
  const evalScale = (s) => {
    const c = normalizeConfig(JSON.parse(JSON.stringify(baseCfg)));
    c.dimensions.widthCm = clamp(Math.round(shape.w * s), 30, 140);
    c.dimensions.depthCm = clamp(Math.round(shape.d * s), 30, 120);
    c.dimensions.heightCm = clamp(Math.round(shape.h * s), 40, 180);
    const designed = designInternals(c);
    const kw = PhysicsModel.evaluate(designed).metrics.heatOutputKw;
    return { s, err: Math.abs(kw - targetKw), config: designed, kw: round(kw, 2) };
  };
  let best = null;
  for (let s = 0.55; s <= 1.95; s += 0.05) {
    const r = evalScale(s);
    if (!best || r.err < best.err) best = r;
  }
  for (let s = Math.max(0.5, best.s - 0.06); s <= Math.min(2.0, best.s + 0.06); s += 0.015) {
    if (Math.abs(s - best.s) < 1e-9) continue;
    const r = evalScale(s);
    if (r.err < best.err) best = r;
  }
  return best;
}

// Повертає рекомендацію для поточного призначення і приміщення. Потужність береться
// для РЕЖИМУ ПРИЗНАЧЕННЯ (PURPOSES[..].mode: той самий, що ставить «Підібрати під кімнату»),
// а не для поточного режиму перемикача: розпал (start-up) чи «на ніч» - короткочасні
// режими, їх нечесно порівнювати з постійною потребою кімнати.
export function evaluateRoom(cfg) {
  const volume = roomVolume(cfg.room);
  const purpose = PURPOSES[cfg.room.purpose] || PURPOSES.room;
  const target = requiredPowerKw(cfg.room.purpose, volume);
  let refCfg = cfg;
  if (cfg.operation.mode !== purpose.mode) {
    refCfg = JSON.parse(JSON.stringify(cfg));
    applyModePreset(refCfg, purpose.mode);
  }
  const actual = PhysicsModel.evaluate(refCfg).metrics.heatOutputKw;
  const ratio = target > 0 ? actual / target : 0;
  const enough = actual >= target * 0.9;
  return {
    volume: round(volume, 1),
    targetKw: round(target, 2),
    actualKw: actual,
    mode: purpose.mode,
    enough,
    // 'low' | 'ok' | 'oversized' (enough лишено для зворотної сумісності)
    status: !enough ? 'low' : ratio > OVERSIZE_RATIO ? 'oversized' : 'ok',
    ratio: round(ratio, 2),
  };
}
