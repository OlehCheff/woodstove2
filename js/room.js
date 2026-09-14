// Підбір печі під приміщення: потрібна потужність з об'єму/площі та призначення,
// далі автопідбір габаритів (з внутрішньою геометрією під макс. ККД).
import { normalizeConfig } from './config.js';
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

export function roomVolume(room) {
  if (!room) return 60;
  return room.inputMode === 'area'
    ? (+room.areaM2 || 30) * (+room.ceilingM || 2.7)
    : (+room.volumeM3 || 60);
}

export function requiredPowerKw(purpose, volumeM3) {
  const p = PURPOSES[purpose] || PURPOSES.room;
  return clamp(volumeM3 * p.kwPerM3 * p.reserve, 1, 20);
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

// Повертає рекомендацію для поточного призначення і приміщення.
export function evaluateRoom(cfg) {
  const volume = roomVolume(cfg.room);
  const target = requiredPowerKw(cfg.room.purpose, volume);
  const actual = PhysicsModel.evaluate(cfg).metrics.heatOutputKw;
  return {
    volume: round(volume, 1),
    targetKw: round(target, 2),
    actualKw: actual,
    enough: actual >= target * 0.9,
    ratio: round(target > 0 ? actual / target : 0, 2),
  };
}
