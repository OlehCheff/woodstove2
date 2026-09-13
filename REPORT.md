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
- дверцята: рама, скло, підсилення, пружинна ручка-спіраль, засувка, петлі (ліва/права);
- футерування: вермикуліт (світлий) — боки, зад, дно + передній бортик;
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
combustionTempC = 480 + flame·260 + secondaryPreheat·0.55 + retention·160 + residence·12 − moisturePenalty   [450,1100]
modeledFlueTempC = combustionTempC − passes·110 − ins·18 − refractory·12      [120,650]
exitFlueTempC = modeledFlueTempC·(1−0.09·H) − bends·6                          [40,600]
```

**Вторинне горіння (гейт):**
```
secondaryIgnitionC = catalyst ? min(600, lightoff) : 600
secondaryActive = combustionTempC ≥ secondaryIgnitionC
```

**ККД:**
```
combustionEff = 68 + (T−600)·0.04 + secondaryQuality·1.2 + retention·5 + residence
              + airMix·5 + staging + draftBonus·0.3 + targetFit − moisturePenalty
              + secondaryGate(+3 / −8) + catalystBonus(0 / +2.5) + effBias    [48,92]
flueLoss = 7 + (flueTemp−150)·0.025 + (1−retention)·8 − passes·1.5            [8,28]
efficiency = combustionEff − flueLoss                                         [35,88]
```

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

## 5. BOM (поточні значення, Standard)

- сталь ≈202 кг, шамот ≈86 кг, ізоляція ≈29 кг, скло ≈2.3 кг;
- різ (з розкладкою) ≈5.6 м², зварні шви ≈25 м, покупних 6;
- усе — **оцінка**, не виробничий розрахунок.

## 6. Тести

`node tests/physics.test.js` → **ALL TESTS PASSED** (фізика, пресети, валідність, BOM, DXF/SVG, автопроєкт, калібрування, room).
Числовий свип: **256 комбінацій** габаритів → 0 збоїв.

## 7. Відомі обмеження

- усі числа — інженерна оцінка, не CFD і не сертифікація;
- маса чутлива до товщини сталі (4–5 мм = важка піч);
- автодизайн обмежує шамот на малих печах;
- експорт у EN — частково транслітеровані/перекладені назви;
- тяга рахується від «ідеального» димоходу без урахування вітру/температури зовні.
