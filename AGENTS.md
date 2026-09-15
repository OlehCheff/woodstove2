# AGENTS — робочі команди Woodstove 2

Запускати **перед кожним пушем**. Обидві мають проходити чисто.

```bash
npm run check     # lint + тести (обов'язково)
```

Окремі команди:

```bash
npm run lint      # ESLint: no-undef (ловить невизначені змінні, як clamp())
npm test          # node tests/physics.test.js — фізика, BOM, калібрування, автопроєкт
npm run smoke     # опційний: headless-браузер (Playwright), інакше SKIPPED
```

## Навіщо lint

Інцидент: `renderPhiGauge` викликав неоголошений `clamp()` → `ReferenceError` обірвав
ініціалізацію → 3D-піч не будувалась (порожній екран). ESLint з `no-undef` ловить це
до пушу: `error 'clamp' is not defined`.

## Smoke у браузері (опційно)

```bash
npm i -D playwright && npx playwright install chromium
npm run smoke                      # дефолт: GitHub Pages
SMOKE_URL=http://localhost:3000/ npm run smoke   # локально (npx serve .)
```

Перевіряє: сторінка завантажилась, WebGL-канвас має ненульовий розмір, KPI відрендерився,
жодних помилок у консолі.

## Правила змін

- Не комітити без `npm run check`.
- Нові поля конфігу — додавати в `normalizeConfig` (безпечні межі, без NaN).
- Нові ключі UI — перевіряти, що `t('key')` і `data-i18n` є в **обох** словниках (`uk`,`en`).
- Публічні рендер-кроки в `app.js` обгортати в `safe(...)`, щоб одна панель не валила 3D.
