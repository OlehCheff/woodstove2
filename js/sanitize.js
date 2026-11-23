// Санітизація недовірених даних: share-лінк (#config=...), імпорт JSON-файлу,
// збережений у localStorage конфіг. Будь-який розпарсений JSON перетворюється на
// БЕЗПЕЧНИЙ частковий конфіг: лише ключі зі схеми (CONFIG_SCHEMA), лише значення
// правильного типу, без __proto__/constructor/prototype, з обмеженням розміру й
// вкладеності. Усе інше мовчки ігнорується. Окремий модуль (а не config.js), бо
// це політика довіри до входу, а не модель печі; але схему й межі бере з config.js,
// щоб не дублювати: кінцевий клемп чисел робить normalizeConfig.
import { CONFIG_SCHEMA, CONFIG_ENUMS, COLOR_RE, OPERATION_MODES, defaultConfig, deepMerge, normalizeConfig, decodeConfigText } from './config.js';

export const LIMITS = {
  maxBytes: 200 * 1024, // файл/декодований лінк; справжній конфіг ~3 КБ
  maxDepth: 8,          // справжній конфіг має 4 рівні
  maxNodes: 20000,      // об'єктів+масивів+значень у всьому JSON
  maxString: 64,        // довжина будь-якого рядка, що потрапляє в результат
};
// base64url росте в 4/3 раза: ліміт для сирого значення хешу.
export const MAX_SHARE_CHARS = Math.ceil(LIMITS.maxBytes * 4 / 3) + 8;

// Схема БЕЗ калібрування: воно обробляється окремо (pickCalibration, лише з власного
// сховища). Інакше walk пропускав би чуже калібрування з лінка/файлу в патч.
const { calibration: _calibrationSchema, ...SCHEMA_NO_CAL } = CONFIG_SCHEMA;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Ітеративний обхід (без рекурсії: 5000 вкладених дужок не мають валити стек).
function isTooComplex(root) {
  const stack = [[root, 1]];
  let nodes = 0;
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (++nodes > LIMITS.maxNodes) return true;
    if (v === null || typeof v !== 'object') continue;
    if (depth > LIMITS.maxDepth) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v)) stack.push([child, depth + 1]);
  }
  return false;
}

function pickString(path, value) {
  if (typeof value !== 'string' || value.length > LIMITS.maxString) return undefined;
  if (CONFIG_ENUMS[path]) return CONFIG_ENUMS[path].includes(value) ? value : undefined;
  if (path.startsWith('colors.')) return COLOR_RE.test(value) ? value : undefined;
  return undefined; // рядок без набору/формату - не довіряємо
}

// Обходимо КЛЮЧІ СХЕМИ, а не вхідного об'єкта: невідомі й небезпечні ключі
// (__proto__, constructor) просто не відвідуються.
function walk(schema, input, path, stats) {
  const out = {};
  for (const key of Object.keys(schema)) {
    if (!has(input, key)) continue;
    const def = schema[key];
    const v = input[key];
    const p = path ? `${path}.${key}` : key;
    let picked;
    if (isObj(def)) {
      if (isObj(v)) { const sub = walk(def, v, p, stats); if (Object.keys(sub).length) picked = sub; }
    } else if (typeof def === 'number') {
      if (typeof v === 'number' && Number.isFinite(v)) { picked = v; stats.accepted++; }
    } else if (typeof def === 'boolean') {
      if (typeof v === 'boolean') { picked = v; stats.accepted++; }
    } else if (typeof def === 'string') {
      picked = pickString(p, v);
      if (picked !== undefined) stats.accepted++;
    }
    if (picked !== undefined) out[key] = picked;
  }
  return out;
}

// Калібрування (лише з власного сховища): відомі режими, скінченні числа.
function pickCalibration(v) {
  if (!isObj(v)) return undefined;
  const out = {};
  for (const k of ['damping', 'globalScale', 'samples', 'modelVersion']) if (typeof v[k] === 'number' && Number.isFinite(v[k])) out[k] = v[k];
  for (const k of ['enabled', 'excludeStartUp']) if (typeof v[k] === 'boolean') out[k] = v[k];
  if (typeof v.updated === 'string' && v.updated.length <= 40) out.updated = v.updated;
  if (isObj(v.modeScale)) {
    out.modeScale = {};
    for (const m of OPERATION_MODES) if (has(v.modeScale, m) && typeof v.modeScale[m] === 'number' && Number.isFinite(v.modeScale[m])) out.modeScale[m] = v.modeScale[m];
  }
  return out;
}

// Чи прийшло з лінка/файлу калібрування, яке МАЛО БИ щось змінити (увімкнене, з
// вибіркою або з масштабом != 1). Старі лінки несли повний дефолтний об'єкт - про
// нього не варто повідомляти.
function carriesCalibration(c) {
  if (!isObj(c)) return false;
  return c.enabled === true || +c.samples > 0 || (Number.isFinite(+c.globalScale) && +c.globalScale !== 1 && c.globalScale !== null);
}

// parsed - будь-що, що повернув JSON.parse. opts.calibration: 'drop' (лінк/файл,
// за замовчуванням - калібрування НІКОЛИ не застосовується мовчки) або 'keep'
// (власне сховище користувача).
// Повертає { ok:true, patch, accepted, droppedCalibration } або { ok:false, reason }.
export function sanitizeConfig(parsed, opts = {}) {
  if (!isObj(parsed)) return { ok: false, reason: 'notStove' };
  if (isTooComplex(parsed)) return { ok: false, reason: 'tooComplex' };
  const stats = { accepted: 0 };
  const patch = walk(SCHEMA_NO_CAL, parsed, '', stats);
  const keep = opts.calibration === 'keep';
  const droppedCalibration = !keep && carriesCalibration(parsed.calibration);
  if (keep) { const cal = pickCalibration(parsed.calibration); if (cal) patch.calibration = cal; }
  // JSON без жодного впізнаного поля - не конфіг печі (чужий файл, {} , масив).
  if (stats.accepted === 0) return { ok: false, reason: 'notStove' };
  return { ok: true, patch, accepted: stats.accepted, droppedCalibration };
}

// Текст JSON (файл, збережений рядок) -> результат sanitizeConfig або { ok:false, reason }.
export function parseConfigText(text, opts = {}) {
  if (typeof text !== 'string') return { ok: false, reason: 'parse' };
  if (text.length > LIMITS.maxBytes) return { ok: false, reason: 'tooLarge' };
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { ok: false, reason: 'parse' }; }
  return sanitizeConfig(parsed, opts);
}

// Значення після '#config=' -> те саме. Спершу довжина (дешево), потім декодування.
export function parseShareValue(value) {
  if (typeof value !== 'string' || !value) return { ok: false, reason: 'parse' };
  if (value.length > MAX_SHARE_CHARS) return { ok: false, reason: 'tooLarge' };
  let text;
  try { text = decodeConfigText(value); } catch { return { ok: false, reason: 'parse' }; }
  return parseConfigText(text, { calibration: 'drop' });
}

// Патч -> повний нормалізований конфіг. Калібрування НЕ береться з патча: лишається
// те, що вже є в користувача (його журнал, його рішення), інакше - типове (вимкнене).
export function applyImported(current, patch) {
  const merged = normalizeConfig(deepMerge(structuredClone(defaultConfig), patch));
  if (isObj(current?.calibration)) merged.calibration = structuredClone(current.calibration);
  return merged;
}
