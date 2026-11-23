// Невеликий доступний компонент «тост» для підтвердження небезпечних дій і скасування.
// Контейнер має role="status" aria-live="polite" (оголошується скрінрідером без
// перехоплення фокусу). Тост із дією «Скасувати» живе autoMs мс; таймер ставиться на
// паузу під курсором і при фокусі всередині (WCAG 2.2.1 - достатньо часу).
// DOM береться з переданого document, тож модуль імпортується в node без побічних ефектів.
export function createToaster(root, { doc = root.ownerDocument, setT = setTimeout, clearT = clearTimeout } = {}) {
  let current = null;

  function dismiss(reason = 'dismiss') {
    if (!current) return;
    const { el, timer, onClose } = current;
    clearT(timer);
    current = null;
    el.remove();
    if (onClose) onClose(reason);
  }

  // opts: { message, actions: [{label, onClick, primary, keepOpen}], autoMs (0 = не зникає),
  //         message і label можуть бути функцією () => рядок: тоді retranslate() оновлює текст
  //         при зміні мови, поки тост відкритий,
  //         kind: 'info'|'warn', focusFirst, onClose(reason) }
  // Одночасно показуємо один тост: новий замінює старий (старий закривається з reason='replaced').
  function show(opts) {
    dismiss('replaced');
    const el = doc.createElement('div');
    el.className = 'toast' + (opts.kind === 'warn' ? ' warn' : '');
    const str = (v) => (typeof v === 'function' ? v() : v);
    const text = doc.createElement('span'); text.className = 'toast-text'; text.textContent = str(opts.message);
    el.appendChild(text);
    const entry = { el, timer: 0, onClose: opts.onClose, text, message: opts.message, labels: [] };
    for (const a of opts.actions || []) {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = a.primary ? 'toast-btn primary' : 'toast-btn ghost';
      b.textContent = str(a.label);
      entry.labels.push([b, a.label]);
      b.addEventListener('click', () => {
        const keep = a.keepOpen === true;
        if (!keep) dismiss('action');
        a.onClick?.();
      });
      el.appendChild(b);
    }
    root.appendChild(el);
    current = entry;
    const arm = () => { clearT(entry.timer); if (opts.autoMs > 0) entry.timer = setT(() => { if (current === entry) dismiss('timeout'); }, opts.autoMs); };
    el.addEventListener('mouseenter', () => clearT(entry.timer));
    el.addEventListener('mouseleave', arm);
    el.addEventListener('focusin', () => clearT(entry.timer));
    el.addEventListener('focusout', arm);
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss('escape'); });
    arm();
    if (opts.focusFirst) el.querySelector('button')?.focus();
    return { dismiss };
  }

  // Перекласти відкритий тост (виклик після зміни мови).
  function retranslate() {
    if (!current) return;
    const str = (v) => (typeof v === 'function' ? v() : v);
    current.text.textContent = str(current.message);
    for (const [b, label] of current.labels) b.textContent = str(label);
  }

  return { show, dismiss, retranslate, isOpen: () => current !== null };
}
