// UA/EN словник для живця. За замовчуванням 'uk', ?lang=en примусово вмикає EN.
export const LANG_KEY = 'woodstove2Lang';
export function getLang() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'en' || q === 'uk') return q;
    return localStorage.getItem(LANG_KEY) || 'uk';
  } catch { return 'uk'; }
}
export function setLang(l) {
  try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
}

export const STR = {
  uk: {
    title: 'Woodstove 2 — Sprint 8',
    subtitle: '1 од. = 1 см · three@160 · модулі · дебаунс 120мс',
    tourBtn: 'Тур', tourTitle: 'Тур по Woodstove 2', tourClose: 'Зрозуміло',
    secMode: 'Режим роботи / вид', lblMode: 'Режим', lblView: 'Вид',
    showFirebrick: 'Шамот', showBaffle: 'Бафль', showAirChannels: 'Повітряні канали', showChimney: 'Димохід',
    secDims: 'Габарити', w: 'Ширина', d: 'Глибина', hBody: 'Висота корпусу', legs: 'Ніжки',
    secMat: 'Матеріали / кольори (Issue #2)', steel: 'Сталь', brickT: 'Шамот',
    steelColor: 'Колір сталі', brickColor: 'Колір шамоту', glass: 'Скло', floor: 'Підлога',
    steelRough: 'Roughness сталі', steelMetal: 'Metalness сталі',
    secAir: 'Бафль / повітря', baffleH: 'Висота бафля', baffleA: 'Кут бафля', baffleGap: 'Передній зазор',
    baffleFlow: 'Приток бафля', primCount: 'Отворів primary', primDia: 'Ø отвору', primStep: 'Крок',
    primGate: 'Задвижка primary', secCount: 'Перфорацій secondary', secDia: 'Ø перфорації', secStep: 'Крок secondary',
    washGap: 'Air-wash щілина', washFlow: 'Приток air-wash',
    secChimney: 'Димохід / дверцята', chimDia: 'Ø димоходу', chimH: 'Висота труби',
    doorW: 'Ширина дверцят', doorH: 'Висота дверцят', glassInset: 'Відступ скла', frame: 'Рамка', openAngle: 'Кут відкриття',
    secPhys: 'Фізика v2', kEff: 'ККД', kKw: 'Потужність', kBurn: 'Горіння', kDraft: 'Тяга / топка',
    noIssues: 'Проблем не виявлено.',
    secCam: 'Камера', fov: 'FOV', dist: 'Дистанція', focusY: 'Фокус Y',
    openDoor: 'Відкрити дверця', closeDoor: 'Закрити дверця', explode: 'Explode', assemble: 'Зібрати', reset: 'Скинути',
    unitCm: 'см', unitMm: 'мм', unitH: 'год', unitPa: 'Па', unitL: 'л',
  },
  en: {
    title: 'Woodstove 2 — Sprint 8',
    subtitle: '1 unit = 1 cm · three@160 · modules · 120ms debounce',
    tourBtn: 'Tour', tourTitle: 'Woodstove 2 tour', tourClose: 'Got it',
    secMode: 'Operation mode / view', lblMode: 'Mode', lblView: 'View',
    showFirebrick: 'Firebrick', showBaffle: 'Baffle', showAirChannels: 'Air channels', showChimney: 'Chimney',
    secDims: 'Dimensions', w: 'Width', d: 'Depth', hBody: 'Body height', legs: 'Legs',
    secMat: 'Materials / colors (Issue #2)', steel: 'Steel', brickT: 'Firebrick',
    steelColor: 'Steel color', brickColor: 'Brick color', glass: 'Glass', floor: 'Floor',
    steelRough: 'Steel roughness', steelMetal: 'Steel metalness',
    secAir: 'Baffle / air', baffleH: 'Baffle height', baffleA: 'Baffle angle', baffleGap: 'Front gap',
    baffleFlow: 'Baffle airflow', primCount: 'Primary holes', primDia: 'Hole Ø', primStep: 'Spacing',
    primGate: 'Primary shutter', secCount: 'Secondary perfs', secDia: 'Perf Ø', secStep: 'Secondary spacing',
    washGap: 'Air-wash slot', washFlow: 'Air-wash intake',
    secChimney: 'Chimney / door', chimDia: 'Chimney Ø', chimH: 'Stack height',
    doorW: 'Door width', doorH: 'Door height', glassInset: 'Glass inset', frame: 'Frame', openAngle: 'Opening angle',
    secPhys: 'Physics v2', kEff: 'Efficiency', kKw: 'Output', kBurn: 'Burn time', kDraft: 'Draft / firebox',
    noIssues: 'No issues detected.',
    secCam: 'Camera', fov: 'FOV', dist: 'Distance', focusY: 'Focus Y',
    openDoor: 'Open door', closeDoor: 'Close door', explode: 'Explode', assemble: 'Assemble', reset: 'Reset',
    unitCm: 'cm', unitMm: 'mm', unitH: 'h', unitPa: 'Pa', unitL: 'L',
  },
};

export const WARN_TXT = {
  uk: {
    SMOKE_RISK: 'Ризик димлення: замало первинного і вторинного повітря.',
    OVERHEAT_RISK: 'Перегрів: висока потужність при сталі ≤4 мм.',
    INEFFICIENT_MODE: 'Неефективний режим: ККД < 62%.',
    DIRTY_GLASS: 'Закопчення скла: вузький air-wash при сильному полум’ї.',
    DRAFT_WEAK: (pa) => `Слабка тяга (${pa} Па): збільшіть висоту/Ø димоходу або інтенсивність.`,
    BAFFLE_GAP: 'Великий передній зазор бафля — гази йдуть повз догорання.',
    STARTUP_LONG: 'Start-up з довгим горінням — перевірте подачу повітря.',
  },
  en: {
    SMOKE_RISK: 'Smoke risk: too little primary and secondary air.',
    OVERHEAT_RISK: 'Overheat: high output with ≤4 mm steel.',
    INEFFICIENT_MODE: 'Inefficient mode: efficiency < 62%.',
    DIRTY_GLASS: 'Sooty glass: narrow air-wash with strong flame.',
    DRAFT_WEAK: (pa) => `Weak draft (${pa} Pa): increase stack height/Ø or intensity.`,
    BAFFLE_GAP: 'Large baffle front gap — gases bypass afterburning.',
    STARTUP_LONG: 'Start-up with long burn — check air supply.',
  },
};

export const TOUR = {
  uk: [
    '<b>Бафль</b> — подовжує шлях газів, піднімає догорання. Контролюй висоту/кут/зазор.',
    '<b>Air-wash</b> — щілина над склом + приток. Вузька щілина + сильний вогонь = кіптява.',
    '<b>Режими</b> — пресет повітря і полум\'я. Фізика v2 враховує тягу димоходу.',
    '<b>Креслення</b> — front/side/top з SVG-розмірами. Камера фіксується.',
    '<b>Експорт</b> — GLTF/STL для виробництва, JSON — для обміну конфігом.',
  ],
  en: [
    '<b>Baffle</b> — lengthens gas path, boosts afterburning. Tune height/angle/gap.',
    '<b>Air-wash</b> — slot above glass + intake. Narrow slot + strong fire = soot.',
    '<b>Modes</b> — air & flame presets. Physics v2 accounts for stack draft.',
    '<b>Drawings</b> — front/side/top with SVG dimensions. Camera is locked.',
    '<b>Export</b> — GLTF/STL for manufacturing, JSON for sharing configs.',
  ],
};
