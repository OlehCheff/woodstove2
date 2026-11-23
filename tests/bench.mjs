// Вимірювання часу (не входить у `npm run check`: залежить від машини).
// Запуск: npm run bench
import { defaultConfig, normalizeConfig, applyModePreset } from '../js/config.js';
import { designInternals } from '../js/autodesign.js';
import { requiredPowerKw, sizeStoveForPower, PURPOSES } from '../js/room.js';

const clone = (x) => JSON.parse(JSON.stringify(x));
const c = designInternals(normalizeConfig(clone(defaultConfig)));
applyModePreset(c, PURPOSES.workshop.mode); designInternals(c);
const target = requiredPowerKw('workshop', 30);

const RUNS = 5;
const times = [];
for (let i = 0; i < RUNS; i++) {
  const t0 = performance.now();
  sizeStoveForPower(target, c);
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);
console.log(`room-fit (майстерня 30 м3): медіана ${times[Math.floor(RUNS / 2)].toFixed(0)} мс, мін ${times[0].toFixed(0)} мс, макс ${times[RUNS - 1].toFixed(0)} мс (${RUNS} запусків)`);
const BUDGET_MS = 3000;
if (times[Math.floor(RUNS / 2)] > BUDGET_MS) { console.error(`ПОВІЛЬНО: медіана вище ${BUDGET_MS} мс`); process.exitCode = 1; }
