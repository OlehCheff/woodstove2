// Єдине джерело порогів попереджень і статусів (кластер B-status-consistency).
// Жодних імпортів: модуль читають і physics-model.js, і i18n.js, і app.js, тож
// число в тексті підказки й число в умові попередження беруться з ОДНОГО місця.
// Усі значення — ОЦІНКИ моделі (REPORT §7), а не виміри; змінювати їх лише тут.

export const EFFICIENCY_LOW_PCT = 58;   // INEFFICIENT_MODE: ККД < 58 % (крім overnight)
export const CREOSOTE_WARN_C = 150;     // CREOSOTE_RISK warn: вихід труби < 150 °C
export const CREOSOTE_DANGER_C = 100;   // CREOSOTE_RISK danger: вихід труби < 100 °C
export const CONNECTOR_MAX_CM = 40;     // CONNECTOR_LONG: горизонтальний патрубок > 40 см
export const STEEL_THIN_MM = 4;         // OVERHEAT_RISK / STEEL_OVERHEAT: сталь ≤ 4 мм
export const BLANK_ALLOWANCE = 1.12;    // BOM: запас площі заготовок (×1.12 = +12 %), НЕ розкладка
export const BLANK_ALLOWANCE_PCT = Math.round((BLANK_ALLOWANCE - 1) * 100); // для текстів/CSV

// Поріг «піч завелика»: потужність/потрібна > OVERSIZE_RATIO. Оцінка, не норма:
// PURPOSES.reserve (room.js) вже дає запас 15-30 %, тож вище ~1.5 піч доведеться душити
// (нижчий ККД, дим, креозот). Значення потребує підтвердження власника.
export const OVERSIZE_RATIO = 1.5;

// Межі правдоподібності Test Burn (test-burn.js). Це ОЦІНКИ для відсіювання
// явного абсурду вводу, а не фізичні межі:
export const TB_BURN_HOURS_MIN = 0.5;        // коротше за 0.5 год закладку не спалити (кочерга/розпал - окремо)
export const TB_FUEL_POWER_RATIO_MAX = 3;    // паливо в топці: > 3x від модельної валової потужності - нереально
export const TB_MEASURED_POWER_RATIO = 3;    // виміряна потужність поза [1/3, 3]x від модельної - підозріло

// Еквівалентне відношення Φ = 1/λ. Зона датчика (зелена) ≠ пороги попереджень:
// між ними є «буфер» (0.35–0.4 і 0.5–0.55), де попередження немає, і датчик
// про це чесно каже нейтральним (не «ризик») текстом.
export const PHI_BAND_MIN = 0.4;
export const PHI_BAND_MAX = 0.5;
export const PHI_RICH_WARN = 0.55;      // MIX_RICH (warn): Φ > 0.55, крім overnight
export const PHI_LEAN_INFO = 0.35;      // MIX_LEAN (info): Φ < 0.35, крім start-up
export const PHI_TARGET = 0.45;         // ціль «Авто в зону»

// Стан Φ-датчика для (округленого до 2 знаків) Φ і режиму. Логіка дзеркалить
// умови MIX_RICH / MIX_LEAN у PhysicsModel (ті самі константи й те саме
// округлення), тож датчик не каже «ризик», коли в «Проблемах» його немає, і навпаки.
// tone: 'ok' (зелена зона) | 'soft' (поза зоною, але попередження немає) | 'warn'.
export function phiGaugeState(phi, mode) {
  const p = +(+phi).toFixed(2);
  if (p >= PHI_BAND_MIN && p <= PHI_BAND_MAX) return { key: 'phiInBand', tone: 'ok' };
  if (p > PHI_RICH_WARN) return mode === 'overnight' ? { key: 'phiModeRich', tone: 'soft' } : { key: 'phiRich', tone: 'warn' };
  if (p > PHI_BAND_MAX) return { key: 'phiRichSoft', tone: 'soft' };
  if (p < PHI_LEAN_INFO) return mode === 'start-up' ? { key: 'phiModeOpen', tone: 'soft' } : { key: 'phiLean', tone: 'warn' };
  return { key: 'phiLeanSoft', tone: 'soft' };
}

// Загальний вердикт конфігурації — ЄДИНЕ місце, де його рахують. Враховує геометрію
// (validateConfig), фізичні попередження (рівні danger/warn; info не рахується) і
// посадки BOM, що потребують виправлення. Банер «коректна» дозволений лише для 'ok'.
// roomStatus ('low'|'ok'|'oversized'|'n/a', room.js) - зауваження до кімнати: «піч
// завелика/замала» не може співіснувати з банером «коректна».
export function configVerdict(validation, physicsWarnings = [], fitIssues = 0, roomStatus = 'ok') {
  const errors = validation?.errors?.length || 0;
  const geoWarn = validation?.warnings?.length || 0;
  const danger = physicsWarnings.filter((w) => w.level === 'danger').length;
  const physWarn = physicsWarnings.filter((w) => w.level === 'warn').length;
  const fit = Math.max(0, +fitIssues || 0);
  const room = roomStatus === 'oversized' || roomStatus === 'low' ? 1 : 0;
  const counts = { errors, danger, warn: geoWarn + physWarn + fit + room, room };
  const level = errors ? 'error' : danger ? 'danger' : counts.warn ? 'warn' : 'ok';
  return { level, counts };
}
