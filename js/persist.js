// Завантаження стану при старті: збережений конфіг, share-лінк, міграція версій,
// відкат до типових значень. Окремий від app.js модуль, бо app.js не імпортується
// в node (побічні ефекти), а ця логіка має тестуватись. Жодна помилка тут не має
// лишити порожню панель: на крайній випадок повертається типова піч + повідомлення.
import { STORAGE_KEY, LEGACY_KEYS, defaultConfig, normalizeConfig, deepMerge } from './config.js';
import { parseConfigText, parseShareValue, applyImported } from './sanitize.js';
import { isCalibrationCurrent } from './calibration.js';
import { designInternals } from './autodesign.js';

const defaults = () => normalizeConfig(structuredClone(defaultConfig));

function getStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

// Сирий текст пошкодженого проєкту лишається в одному резервному ключі (перезаписується
// наступним пошкодженням), щоб його можна було витягти вручну. Обрізаємо до ліміту
// санітайзера, щоб не роздувати сховище.
export const CORRUPT_KEY = STORAGE_KEY + '.corrupt';
function keepCorruptCopy(storage, key, raw) {
  try { storage.setItem(CORRUPT_KEY, String(raw).slice(0, 200 * 1024)); } catch { /* ignore */ }
}

// Збережений конфіг. Ніколи не кидає. Повертає { config|null, notices[] }:
// config=null - нічого придатного (немає ключа або все пошкоджене).
// Пошкоджений ключ видаляється, щоб не ламати кожен старт і не показувати
// повідомлення вічно. Конфіг без schemaVersion (до версіювання) читається як є.
export function loadStoredConfig(storage = getStorage()) {
  const notices = [];
  if (!storage) return { config: null, notices };
  for (const key of [STORAGE_KEY, ...LEGACY_KEYS]) {
    let raw = null;
    try { raw = storage.getItem(key); } catch { /* сховище недоступне */ }
    if (!raw) continue;
    const r = parseConfigText(raw, { calibration: 'keep' });
    if (!r.ok) {
      keepCorruptCopy(storage, key, raw);
      try { storage.removeItem(key); } catch { /* ignore */ }
      if (!notices.includes('bootCorrupt')) notices.push('bootCorrupt');
      continue;
    }
    let config;
    try { config = normalizeConfig(deepMerge(structuredClone(defaultConfig), r.patch)); } catch {
      keepCorruptCopy(storage, key, raw);
      try { storage.removeItem(key); } catch { /* ignore */ }
      if (!notices.includes('bootCorrupt')) notices.push('bootCorrupt');
      continue;
    }
    // Калібрування іншої (або невідомої) версії моделі не застосовуємо: його масштаб
    // = виміряне/прогноз СТАРОЇ моделі. Зберігаємо вимкненим, щоб повідомлення було разове.
    if (config.calibration.enabled && !isCalibrationCurrent(config.calibration)) {
      config.calibration.enabled = false;
      notices.push('calStaleNotice');
      try { storage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* ignore */ }
    }
    return { config, notices };
  }
  return { config: null, notices };
}

// Увесь старт: { config, savedDesign, notices[], clearHash, previous }; previous != null
// означає «відкрито поділену піч» (previous - проєкт до неї).
// hash - location.hash. Помилка будь-якого кроку -> типова піч і повідомлення.
export function bootState({ hash = '', storage = getStorage() } = {}) {
  const notices = [];
  let config = null;
  let savedDesign = false;
  let clearHash = false;
  let previous = null; // проєкт до відкриття лінка: для «Скасувати»
  try {
    const stored = loadStoredConfig(storage);
    notices.push(...stored.notices);
    config = stored.config;
    savedDesign = config !== null; // піч уже спроєктована раніше
    if (config === null) config = defaults();

    if (typeof hash === 'string' && hash.startsWith('#config=')) {
      clearHash = true; // лінк не лишається в адресі ні після успіху, ні після помилки
      const r = parseShareValue(hash.slice(8));
      if (r.ok) {
        previous = structuredClone(config);
        config = applyImported(config, r.patch);
        savedDesign = true;
        if (r.droppedCalibration) notices.push('calibrationIgnored');
      } else {
        // для лінка «не JSON» не годиться: користувач JSON не бачив
        notices.push(r.reason === 'parse' ? 'shareErr_parse' : `importErr_${r.reason}`);
      }
    }
    // Збережена або поділена піч авторитетна: бафль не перепідбираємо (див. app.js
    // історію: F5 мовчки давав іншу піч).
    config = designInternals(config, { keepBaffle: savedDesign });
    // Відкритий лінк стає збереженим проєктом одразу: інакше F5 мовчки повертав попередню
    // піч, а перша правка перезаписувала її без жодного сліду. Попередній проєкт повертається
    // кнопкою «Скасувати» (previous).
    if (previous) { try { storage?.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* ignore */ } }
  } catch (e) {
    console.error('boot failed, falling back to defaults:', e);
    try { storage?.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    notices.push('bootFailed');
    savedDesign = false; previous = null;
    try { config = designInternals(defaults()); } catch { config = defaults(); }
  }
  return { config, savedDesign, notices, clearHash, previous };
}
