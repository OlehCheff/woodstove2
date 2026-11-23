// Безпечна робота з HTML. Єдине місце, де динамічні дані перетворюються на розмітку.
// Правило: у js/*.js НЕ можна писати `.innerHTML = ...`, `insertAdjacentHTML` чи
// `document.write` напряму (це перевіряє тест у tests/physics.test.js). Замість цього:
//   setHtml(el, html`<b>${userValue}</b>`)  - усі ${...} екрануються автоматично;
//   raw(str)                                 - лише для статичних констант із коду (не для даних).
// Модуль без DOM-залежностей на верхньому рівні, тож імпортується в node для тестів.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

// Екранує текст для вставки в HTML-вміст і в значення атрибутів у лапках.
export function esc(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);
}

// Вже безпечний фрагмент: html`` повертає його, а вкладений html`` не екранується двічі.
class SafeHtml {
  constructor(text) { this.text = text; }
  toString() { return this.text; }
}
export const isSafeHtml = (v) => v instanceof SafeHtml;

// Позначає рядок як довірену розмітку. Лише для констант із коду (напр., TOUR з i18n.js).
export function raw(text) { return new SafeHtml(String(text)); }

// Тегований шаблон: кожна підстановка екранується, крім вкладених SafeHtml; масиви
// з'єднуються (кожен елемент за тим самим правилом).
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    const part = Array.isArray(v) ? v.map(piece).join('') : piece(v);
    out += part + strings[i + 1];
  });
  return new SafeHtml(out);
}
const piece = (v) => (v instanceof SafeHtml ? v.text : esc(v));

// Єдиний «стік» innerHTML. Звичайний рядок екранується (стає текстом), а не розміткою.
export function setHtml(el, value) {
  el.innerHTML = value instanceof SafeHtml ? value.text : esc(value);
}

// Єдиний «стік» document.write (звіт для друку). Те саме правило для рядків.
export function writeHtml(doc, value) {
  doc.write(value instanceof SafeHtml ? value.text : esc(value));
}
