// Журнал тестових горінь (localStorage). Чиста логіка без DOM, щоб тестувалась у node.
// Журнал - дані користувача: розбір толерантний до сміття, обрізання НЕ мовчазне
// (повертаємо, що саме відкинуто, а app.js повідомляє про це користувачу).
export const JOURNAL_KEY = 'woodstove2TestLogV1';
export const JOURNAL_MAX = 30;

// Сирий рядок зі сховища -> масив записів-обʼєктів. Усе, що не масив обʼєктів, ігнорується.
export function parseJournal(raw) {
  let value;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  return value.filter((e) => e !== null && typeof e === 'object' && !Array.isArray(e));
}

// Додає запис, лишає останні `max`. Повертає { log, dropped[] }: dropped - найстаріші
// записи, що не вмістились (їх можна запропонувати експортувати до втрати).
export function appendEntry(log, entry, max = JOURNAL_MAX) {
  const all = [...log, entry];
  const overflow = Math.max(0, all.length - max);
  return { log: all.slice(overflow), dropped: all.slice(0, overflow), all };
}

// CSV-експорт: поля журналу - недовірені дані (localStorage). RFC 4180 (лапки, коми,
// переноси) і захист від формул: рядок на = + - @ або табуляцію/CR отримує префікс ',
// щоб Excel/Sheets не виконали його. Числа (включно з від'ємними) не чіпаємо.
export function csvField(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
// Дата запису або порожньо: невалідний ts не має кидати RangeError і зривати експорт.
export const csvDate = (ts) => (typeof ts === 'number' && Number.isFinite(ts) && Math.abs(ts) <= 8.64e15 ? new Date(ts).toISOString() : '');
