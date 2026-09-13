# Woodstove 2 — Звіт по проєкту

## 1. Загальна інформація

| | |
|---|---|
| Назва | **Woodstove 2** — 3D-конфігуратор дров'яної печі |
| Live | https://olehcheff.github.io/woodstove2/ |
| Репозиторій | `OlehCheff/woodstove2`, гілка `main` |
| Стек | чистий ES-модулі, three.js 0.160 (importmap), без збірки |
| Деплой | GitHub Pages (потрібен `Ctrl+F5` — конфіг кешується в localStorage) |

## 2. Структура

```
woodstove2/
├── index.html
├── css/styles.css
├── js/
│   ├── config.js         # конфіг, normalize, validate, encode/decode, пресети
│   ├── physics-model.js  # Physics v5 + optimizeConfig
│   ├── autodesign.js     # авто-проєктування внутрішньої геометрії
│   ├── room.js           # підбір печі під приміщення
│   ├── stove-builder.js  # 3D-геометрія (чиста функція)
│   ├── bom.js            # BOM, CSV, техкреслення SVG, DXF
│   ├── calibration.js    # калібрування за журналом Test Burn
│   ├── exporters.js      # GLTF/STL
│   ├── i18n.js           # UA/EN словники
│   └── app.js            # сцена, UI, керування
└── tests/physics.test.js # node-тести
```

## 3. Реалізований функціонал

**Геометрія / виріб**
- корпус зі сталі заданої товщини, передня панель з отвором під дверцята;
- дверцята: рама, скло, кріплення ручки, пружинна ручка-спіраль, засувка, петлі (ліва/права);
- футерування: шамот (світлий) — боки, зад, дно + передній бортик, з прошарком вермикуліт/CFB ізоляції між сталлю та шамотом;
- глухе дно (без колосника й зольника);
- primary — 2 овальні отвори в передній плиті під дверцятами + ковзна заслінка;
- secondary — 2 задні підігрівальні стояки + поперечна SS-труба з отворами Ø3 мм;
- air-wash — кожух + флоп-заслінка + суцільна щілина над склом + бокова ручка;
- бафль — 2 уголки + знімний дефлектор + передній дефлектор;
- tertiary (опція) — третинна труба з дрібними отворами;
- каталізатор (опція) — стільник перед димоходом;
- газові канали, flue bell, люк чистки, димохід + комір;
- вигляд: розріз, теплові зони, потоки, аеродинаміка, дим, explode.

**Автоматика**
- будь-яка зміна габаритів → автопідбір внутрішньої геометрії під макс. ККД;
- призначення печі: сауна / кімната / майстерня + обʼєм або площа×стеля → підбір габаритів;
- калібрування за журналом Test Burn (з демпфуванням).

**Експорт / дані**
- BOM CSV (11 колонок, двомовний, з лапками), DXF (лише сталь), техкреслення SVG, GLTF/STL;
- журнал тестів + CSV, share-link, compare, screenshot, Print/PDF.

**Мови:** UA/EN повністю.

## 4. Physics v5 — модель

**Тяга (повний димохід, плавучисть):**
```
Δp = g·H·(ρ_air − ρ_gas) · bendPenalty · diaFactor − bafflePenalty
ρ_gas = 1.2·293/(stackTemp+273)
bendPenalty = 1/(1+0.12·bends);  diaFactor = (D/15)^0.3
draftPa ∈ [3, 40]
```

**Температури:**
```
moistureTempPenalty = max(0, moisture% − 12) · 6                              [°C]
combustionTempC = 480 + flame·260 + secondaryPreheat·0.55 + retention·160 + residence·12 − moistureTempPenalty   [450,1100]
modeledFlueTempC = combustionTempC − passes·110 − ins·18 − refractory·12      [120,650]
exitFlueTempC = ambient + (modeledFlueTempC − ambient)·exp(−0.12·H) − bends·6   [40,600]  (ambient = 20°C;
                                                                                 експоненційне охолодження вздовж
                                                                                 труби, а не лінійне)
```

**Вторинне горіння (гейт):**
```
secondaryIgnitionC = catalyst ? min(600, lightoff) : 600
secondaryActive = combustionTempC ≥ secondaryIgnitionC
```

**ККД:**
```
moistureEffPenalty = max(0, moisture% − 12) · 0.15
moistureFlueLossPenalty = max(0, moisture% − 12) · 0.25   (прихована теплота пароутворення, що йде з димом)
combustionEff = 68 + (T−600)·0.04 + secondaryQuality·1.2 + retention·5 + residence
              + airMix·5 + staging + draftBonus·0.3 + targetFit − moistureEffPenalty
              + secondaryGate(+3 / −8) + effBias                              [48,92]
flueLoss = 7 + (flueTemp−150)·0.025 + (1−retention)·8 − passes·1.5 + moistureFlueLossPenalty   [8,28]
efficiency = combustionEff − flueLoss + catalystBonus(0 / +2.5)               [35,88]
```
Каталізатор рахується ПІСЛЯ стелі `combustionEff` (не всередині неї) — інакше
на печі, що й так впирається у стелю 92, бонус каталізатора був непомітний.

**Надлишок повітря:**
```
λ = clamp(1.4 + airMix·1.6, 1.1, 4);  Φ = 1/λ  (ціль 0.4–0.5)
```

**Потужність / закладка / час:**
```
gross = fireboxLiters·0.105·(0.35+0.65·airMix)·powerFactor·draftFactor·geometryFactor  [1.5,24]
heat  = gross·efficiency/100 · calibrationFactor                                       [1,20]
maxLoad = liters·0.12·0.9;  recommended = maxLoad·fillFactor
burn = usefulEnergy/heat · burnFactor · (1+steelMm·0.015)                              [2,14]
```

**Варнінги:**
`SMOKE_RISK, OVERHEAT_RISK, STEEL_OVERHEAT, WET_WOOD, INEFFICIENT_MODE, DIRTY_GLASS, DRAFT_WEAK, SECONDARY_RESTRICTED, SECONDARY_COLD, SECONDARY_INACTIVE, AIRWASH_JETS, AIRWASH_LOW, BAFFLE_GAP, STARTUP_LONG, CHIMNEY_NARROW, CHIMNEY_LARGE, CREOSOTE_RISK, MIX_RICH, MIX_LEAN, CATALYST_COLD`.

## 5. BOM (поточні значення, Standard за замовчуванням у UI)

- метал (сталь + нержавійка secondary-труби) ≈205 кг, шамот ≈79 кг, ізоляція ≈26 кг, скло ≈2,3 кг;
- різ (з розкладкою) ≈5,8 м², зварні шви ≈25,4 м, покупних 6;
- числа взято напряму з `buildBOM(designInternals(normalizeConfig(defaultConfig)))` —
  тобто те, що фактично показує UI на стандартній печі, а не окремий пресет
  без автопроєктування;
- усе — **оцінка**, не виробничий розрахунок.

## 6. Тести

`node tests/physics.test.js` → **ALL TESTS PASSED** (фізика, пресети, валідність, BOM, DXF/SVG, автопроєкт, калібрування, room).
Числовий свип: **256 комбінацій** габаритів → 0 збоїв.

## 7. Відомі обмеження

- усі числа — інженерна оцінка, не CFD і не сертифікація;
- маса чутлива до товщини сталі (4–5 мм = важка піч);
- автодизайн обмежує шамот на малих печах;
- тяга рахується від «ідеального» димоходу без урахування вітру/температури зовні;
- `CATALYST_COLD` описує перехідний стан прогріву каталізатора одразу після
  розпалу, а модель — стаціонарна (без часової осі): мінімальна досяжна
  температура зони допалювання в межах UI ≈590°C, тож поріг займання
  каталізатора (150–500°C у налаштуваннях) фактично завжди нижчий за неї.
  Це обмеження моделі, а не помилка порогу.
- ще 10 кодів (`SMOKE_RISK`, `STEEL_OVERHEAT`, `INEFFICIENT_MODE`,
  `DIRTY_GLASS`, `SECONDARY_RESTRICTED`, `AIRWASH_JETS`, `AIRWASH_LOW`,
  `BAFFLE_GAP`, `MIX_RICH`, `MIX_LEAN`) жодного разу не спрацювали на
  1350-конфігураційному свипі: усі залежать від `primaryAir.openPct`,
  `operation.secondaryAirPct`, `airWash.gapCm/intakePct`,
  `baffle.airflowPct/frontGapCm` — параметрів, які повністю визначає пресет
  режиму й оптимізатор бафля, без окремого UI-контролю (в інтерфейсі немає
  Expert-панелі, хоча в `i18n.js` лишились переклади для неї — див. нижче).
  Це не помилка порогу в кожному з 10 кодів окремо, а один спільний
  архітектурний наслідок: попередження лишаються в моделі для сценаріїв
  ручного/API-редагування конфігурації, а не для звичайного UI-потоку.
  `CHIMNEY_NARROW`/`CHIMNEY_LARGE` теж не спрацьовують у тому самому свипі —
  але це навмисний результат (Major #8): автопідбір діаметра тепер завжди
  влучає у власний коридор валідатора; попередження лишається як захист від
  зовнішнього/вручну відредагованого конфігу з невідповідним діаметром.
