# Woodstove 2 — Sprint 10 (Airflow Engineering)

Що виправлено відносно `woodstove1` (Sprint 1–7):

- **Модернізація:** `three@0.160` через importmap, ES-модулі замість моноліту 1314 рядків:
  `js/config.js`, `js/physics-model.js`, `js/stove-builder.js`, `js/app.js`, `js/exporters.js`
- **Продуктивність:** дебаунс перебудови 120мс, кеш матеріалів, точкове оновлення видимості/камери без rebuild
- **Геометрія:** верх з вирізом під димохід (4 планки), комір з посадкою, рама дверцят з 4 планок (видно скло)
- **UI/UX:** темна скляна панель, collapsible-секції, адаптив, SVG-креслення з точками, тур-модалка замість `alert()`
- **Фізика v2:** враховує висоту/Ø димоходу (тяга Па), `intakePct`, `baffle.airflowPct`, об'єм топки (л), масу закладки (кг); breakdown + 7 варнінгів
- **Issue #2 закрито:** колір сталі/шамоту/скла/підлоги + roughness/metalness
- **Експорт:** GLTF + STL, Save/Load JSON, міграція localStorage V1←V2
- **Product Sprint 9:** готові моделі `Compact / Standard / Wide / Workshop`, share-link через URL hash, compare конфігурацій, screenshot і Print/PDF-звіт.
- **Geometry validation:** перевірка дверцят, бафля, primary-отворів, шамоту та димоходу до виробничого етапу.
- **Airflow Engineering:** бафль має реальний передній газовий прохід; secondary air проходить через вертикальні підігрівальні стояки й manifold; air-wash має бокові канали та суцільну регульовану щілину.
- **Physics v3:** площі opening, швидкості потоків, draft flow, температури підігріву, secondary/air-wash coverage та stability warnings.
- **Thermal Architecture v4:** ізоляція топки, refractory roof над бафлем, розрахунок температурних зон, часу перебування газів, втрат через димохід та енергетичного балансу. Це оцінка конструкції, не CFD і не сертифікація.
- **Flow visualization:** синій primary, зелений preheat, помаранчевий secondary, блакитний air-wash, червоний hot gas.
- **Test Burn:** вологість дров, маса закладки, час, температури й smoke opacity; незалежне порівняння зʼявляється після введення виміряного корисного тепла, а не підміняється прогнозом ККД.
- **Usability:** `Auto from firebox` підбирає закладку за обʼємом топки та режимом; `Find optimum` підбирає бафль/airflow для поточної моделі; експертні контролі сховані в Expert-секціях.
- **Hardware controls:** кольорові ручки primary/baffle у 3D та вибір лівої/правої петлі дверцят.

## Запуск
- Варіант без збірки: `npx serve .` → відкрити `index.html` (потрібен інтернет для CDN three.js)
- Тести: `npm test` або `node tests/physics.test.js`

## Структура
```
woodstove2/
├── index.html
├── css/styles.css
├── js/config.js
├── js/physics-model.js
├── js/stove-builder.js
├── js/app.js
├── js/exporters.js
├── js/i18n.js
├── tests/physics.test.js
└── package.json
```
