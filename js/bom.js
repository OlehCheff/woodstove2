// BOM (Bill of Materials) + технічні дані з конфігу.
// Розміри деталей рахуються за тими ж формулами, що й у stove-builder.js,
// щоб специфікація збігалася з 3D-моделлю 1:1.
import { PhysicsModel } from './physics-model.js';

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

const NAME_EN = {
  'Днище': 'Bottom', 'Бічна панель (Л/П)': 'Side panel (L/R)', 'Задня панель': 'Back panel',
  'Передня панель — бічна (Л/П)': 'Front panel — side (L/R)', 'Передня панель — під дверима': 'Front panel — below door',
  'Передня панель — над дверима': 'Front panel — above door', 'Верх — передня смуга': 'Top — front strip',
  'Верх — задня смуга': 'Top — rear strip', 'Верх — бічні смуги (Л/П)': 'Top — side strips (L/R)',
  'Дверцята — планки рами гориз. (верх/низ)': 'Door — frame bars horiz. (top/bottom)',
  'Дверцята — планки рами верт. (Л/П)': 'Door — frame bars vert. (L/R)',
  'Скло дверцят': 'Door glass', 'Петля дверцят (кріплення + втулка)': 'Door hinge (mount + bushing)',
  'Пружинна ручка-спіраль': 'Spring coil handle', 'Засувка дверцят (клямка)': 'Door latch',
  'Бафль (пластина)': 'Baffle plate', 'Refractory плита над бафлем': 'Refractory plate above baffle',
  'Засувка бафля': 'Baffle damper', 'Димова полиця': 'Smoke shelf', 'Бічні напрямні верхнього ходу (Л/П)': 'Upper gas-path guides (L/R)',
  'Задня перепускна стінка': 'Rear bypass wall', 'Внутрішня димова труба (flue bell)': 'Internal flue bell',
  'Люк чистки + кришка': 'Cleaning port + cap', 'Панель primary + задвижка': 'Primary panel + gate',
  'Secondary стояки (Л/П)': 'Secondary risers (L/R)', 'Secondary manifold': 'Secondary manifold',
  'Air-wash канали (Л/П)': 'Air-wash channels (L/R)', 'Air-wash корпус + щілина': 'Air-wash box + slot',
  'Верхнє піддувало': 'Upper vent', 'Колосник (прути)': 'Grate bars', 'Зольник (ящик + фасад)': 'Ash pan (box + front)',
  'Шамот — дно': 'Firebrick — floor', 'Шамот — стіни (Л/П/З)': 'Firebrick — walls (L/R/back)',
  'Ізоляція топки (4 сторони)': 'Firebox insulation (4 sides)', 'Комір димоходу': 'Flue collar', 'Ніжки 50×50': 'Legs 50×50',
  'Тепловий екран — задній': 'Heat shield — rear', 'Тепловий екран — бічні (Л/П)': 'Heat shield — sides (L/R)',
  'Primary — 2 овальні отвори + заслінка': 'Primary — 2 oval holes + gate',
  'Secondary труба впоперек (SS)': 'Secondary cross tube (SS)',
  'Air-wash щілина + флоп': 'Air-wash slit + flap',
  'Air-wash бокова ручка + тяга': 'Air-wash side lever + rod',
};
function translateNote(s, lang) {
  if (lang !== 'en' || !s) return s;
  return s
    .replace(/розгортка/g, 'developed').replace(/з ручкою/g, 'with handle').replace(/переріз/g, 'section')
    .replace(/щілина/g, 'slot').replace(/кут/g, 'angle').replace(/зазор/g, 'clearance')
    .replace(/Л \+ П \+ задня/g, 'L+R+back').replace(/Л \+ П/g, 'L+R').replace(/покупна\/токарка/g, 'purchased/machined')
    .replace(/кручена/g, 'coiled').replace(/з зачепом/g, 'with catch').replace(/термостійке/g, 'heat-resistant')
    .replace(/гориз\./g, 'horiz.').replace(/верт\./g, 'vert.').replace(/профільна труба/g, 'profile tube')
    .replace(/см/g, 'cm');
}
function translateMat(s, lang) {
  if (lang !== 'en') return s;
  return s.replace(/сталь/g, 'steel').replace(/шамот/g, 'firebrick').replace(/скло/g, 'glass')
    .replace(/вермикуліт/g, 'vermiculite').replace(/покупна/g, 'purchased').replace(/мм/g, 'mm');
}

export function buildBOM(cfg, physicsResult = null, lang = 'uk') {
  const trName = (s) => (lang === 'en' ? (NAME_EN[s] || s.replace('Димохід', 'Flue').replace(/ см/g, ' cm')) : s);
  const w = cfg.dimensions.widthCm;
  const d = cfg.dimensions.depthCm;
  const h = cfg.dimensions.heightCm;
  const legH = cfg.dimensions.legHeightCm;
  const steelMm = cfg.materials.steelThicknessMm;
  const steelCm = steelMm / 10;
  const brickT = Math.min(cfg.materials.firebrickThicknessCm, 12);
  const thermal = cfg.thermal || {};
  const insT = Math.min(Math.max(thermal.insulationThicknessCm == null ? 3 : +thermal.insulationThicknessCm, 0), 8);
  const refrT = Math.min(Math.max(thermal.baffleRefractoryThicknessCm == null ? 3 : +thermal.baffleRefractoryThicknessCm, 0), 8);

  const innerW = Math.max(10, w - steelCm * 2);
  const innerD = Math.max(10, d - steelCm * 2);
  const doorW = Math.max(20, Math.min(cfg.door.widthCm, w - steelCm * 4));
  const doorH = Math.max(20, Math.min(cfg.door.heightCm, h - steelCm * 4));
  const openingW = Math.min(w - steelCm * 2, doorW + 0.8);
  const openingH = Math.min(h - steelCm * 2, doorH + 0.8);
  const openingBottom = Math.max(steelCm, h * 0.48 - openingH / 2);
  const openingTop = Math.min(h - steelCm, openingBottom + openingH);
  const sideW = Math.max(steelCm, (w - openingW) / 2);
  const frameT = cfg.door.frameThicknessCm;
  const baffleGap = Math.min(cfg.baffle.frontGapCm, innerD * 0.45);
  const baffleDepth = Math.max(8, innerD - baffleGap);
  const chimR = cfg.chimney.diameterCm / 2;
  const chimZ = -d * 0.2;
  const collarR = chimR * 1.08;
  const flueBellBottom = Math.min(h - steelCm * 2, Math.max(cfg.baffle.heightCm + steelCm * 4, h * 0.55));
  const flueBellH = Math.max(6, (h - steelCm) - flueBellBottom);

  const parts = [];
  const densityOf = (mat) => {
    if (mat === 'шамот') return 0.0021;                 // шамот ~2.1 г/см³
    if (mat.includes('скло')) return 0.0025;            // скло ~2.5 г/см³
    if (mat.includes('vermiculite') || mat.includes('CFB')) return 0.0005; // вермикуліт/CFB ~0.5 г/см³
    return 0.00785;                                     // сталь 7.85 г/см³
  };
  // kind: sheet | bar | tube | purchased. weldCm — довжина зварного шва на одну деталь.
  const add = (name, qty, wCm, hCm, tCm, mat, note = '', kind = 'sheet', weldCm = 0) => {
    const areaCm2 = round(wCm * hCm, 1);
    const massKg = round(areaCm2 * tCm * densityOf(mat), 2);
    parts.push({
      name: trName(name), qty, wCm: round(wCm, 1), hCm: round(hCm, 1), tCm: round(tCm, 1),
      areaCm2, massKg, mat: translateMat(mat, lang), note: translateNote(note, lang), kind, weldCm: round(weldCm, 1), estimate: true,
    });
  };

  // Корпус — сталь (шви: контур днища + вертикальні стики + верх)
  add('Днище', 1, w, d, steelCm, `сталь ${steelMm} мм`, '', 'sheet', 2 * (w + d));
  add('Бічна панель (Л/П)', 2, d, h, steelCm, `сталь ${steelMm} мм`, '', 'sheet', 2 * (d + h));
  add('Задня панель', 1, w, h, steelCm, `сталь ${steelMm} мм`, '', 'sheet', 2 * (w + h));
  add('Передня панель — бічна (Л/П)', 2, sideW, h, steelCm, `сталь ${steelMm} мм`, '', 'sheet', 2 * (sideW + h));
  add('Передня панель — під дверима', 1, openingW, openingBottom, steelCm, `сталь ${steelMm} мм`, '', 'sheet', 2 * (openingW + openingBottom));
  add('Передня панель — над дверима', 1, openingW, h - openingTop, steelCm, `сталь ${steelMm} мм`, '', 'sheet', 2 * (openingW + (h - openingTop)));
  // Верх з вирізом під комір
  const frontStrip = (d / 2 - chimZ) - collarR - steelCm;
  const rearStrip = Math.max(1, (chimZ + d / 2) - collarR);
  const midW = Math.max(1, w / 2 - collarR);
  add('Верх — передня смуга', 1, w, frontStrip, steelCm, `сталь ${steelMm} мм`, '', 'sheet', 2 * (w + frontStrip));
  add('Верх — задня смуга', 1, w, rearStrip, steelCm, `сталь ${steelMm} мм`, '', 'sheet', 2 * (w + rearStrip));
  add('Верх — бічні смуги (Л/П)', 2, midW, collarR * 2, steelCm, `сталь ${steelMm} мм`, '', 'sheet', 2 * (midW + collarR * 2));
  // Дверцята — рама з 4 окремих планок
  const frameSide = Math.max(2, doorH - frameT * 2);
  add('Дверцята — планки рами гориз. (верх/низ)', 2, doorW, frameT, frameT, 'сталь', '', 'bar');
  add('Дверцята — планки рами верт. (Л/П)', 2, frameSide, frameT, frameT, 'сталь', '', 'bar');
  add('Скло дверцят', 1, doorW - cfg.door.glassInsetCm * 2, doorH - cfg.door.glassInsetCm * 2, 0.7, 'скло 7 мм', 'термостійке', 'purchased');
  add('Петля дверцят (кріплення + втулка)', 2, 2.4, 6, 2.4, 'сталь', 'Ø12 мм, покупна/токарка', 'purchased');
  add('Пружинна ручка-спіраль', 1, 14, 2.2, 2.2, 'сталь Ø8', 'кручена, Ø8 мм', 'purchased');
  add('Засувка дверцят (клямка)', 1, 8, 3, 0.6, 'сталь', 'з зачепом', 'purchased');
  // Бафль + refractory
  add('Бафль (пластина)', 1, innerW, baffleDepth, steelCm, `сталь ${steelMm} мм`, 'кут ' + cfg.baffle.angleDeg + '°');
  if (refrT > 0) add('Refractory плита над бафлем', 1, innerW, baffleDepth, refrT, 'vermiculite/CFB');
  // Регулювання бафля
  add('Засувка бафля', 1, Math.max(12, w * 0.35), 1.2, 2, 'сталь', 'з ручкою Ø32');
  // Газові канали
  const hoodY = Math.min(h - steelCm * 2, Math.max(cfg.baffle.heightCm + steelCm * 6, h * 0.82));
  const hoodDepth = Math.max(8, (d / 2 - steelCm) - (chimZ + collarR) - 1.5);
  add('Димова полиця', 1, innerW, hoodDepth, steelCm, `сталь ${steelMm} мм`);
  add('Бічні напрямні верхнього ходу (Л/П)', 2, hoodDepth, hoodY - cfg.baffle.heightCm - steelCm, steelCm, `сталь ${steelMm} мм`);
  add('Задня перепускна стінка', 1, innerW, Math.max(6, (hoodY - cfg.baffle.heightCm) * 0.55), steelCm, `сталь ${steelMm} мм`);
  add('Внутрішня димова труба (flue bell)', 1, Math.PI * chimR * 1.06 * 2, flueBellH, 0.3, 'сталь 3 мм', 'Ø' + round(chimR * 2.12, 1) + ' см, розгортка', 'tube', Math.PI * chimR * 2);
  add('Люк чистки + кришка', 1, 8.2, 8.2, 0.9, 'сталь', 'Ø68/82 мм', 'purchased');
  // Повітряні системи — короби/труби з листа 3 мм (маса = розгортка × товщина стінки).
  const wallT = 0.3;
  // Primary: 2 овальні отвори в передній плиті + ковзна заслінка.
  add('Primary — 2 овальні отвори + заслінка', 1, 2 * (openingW * 0.26) + 6, Math.max(4, openingBottom * 0.45) * 2.6, steelCm, `сталь ${steelMm} мм`, 'отвори в передній плиті під дверцятами');
  // Secondary: 2 стояки + поперечна SS-труба з отворами Ø3 мм.
  const secRiserDev = 2 * (cfg.secondaryAir.channelWidthCm + cfg.secondaryAir.channelDepthCm);
  add('Secondary стояки (Л/П)', 2, secRiserDev, Math.max(12, cfg.secondaryAir.preheatLengthCm), wallT, 'сталь 3 мм', 'розгортка короба', 'tube');
  const tubeLen = Math.max(16, Math.min(innerW * 0.9, 120));
  add('Secondary труба впоперек (SS)', 1, Math.PI * 3.2, tubeLen, 0.15, 'нерж. 1.5 мм', `Ø32×1.5, ${cfg.secondaryAir.holeCount}×Ø3 мм`, 'tube');
  // Air-wash: суцільна щілина над склом + флоп-заслінка + бокова ручка.
  const washW = Math.max(12, Math.min(w - steelCm * 3, doorW + 6));
  add('Air-wash щілина + флоп', 1, washW, Math.max(3, cfg.airWash.gapCm * 4), wallT, 'сталь 3 мм', `щілина ${cfg.airWash.gapCm} см на всю ширину`, 'tube');
  add('Air-wash бокова ручка + тяга', 1, 6, 3, 0.8, 'сталь', 'права стінка, звʼязок з флопом', 'bar');
  // Шамот + ізоляція
  const cw = Math.max(10, w - steelCm * 2);
  const cd = Math.max(10, d - steelCm * 2);
  const linerTopY = Math.max(steelCm * 4, Math.min(h - steelCm * 2 - insT, cfg.baffle.heightCm - steelCm));
  const brickH = Math.max(10, linerTopY - steelCm - insT - brickT);
  add('Шамот — дно', 1, cw - insT * 2, cd - insT * 2, brickT, 'шамот');
  add('Шамот — стіни (Л/П/З)', 3, brickH, Math.max(10, cd - insT * 2), brickT, 'шамот', 'Л + П + задня');
  if (insT > 0) add('Ізоляція топки (4 сторони)', 4, cw, linerTopY - steelCm, insT, 'vermiculite/CFB');
  // Димохід
  add('Димохід Ø' + cfg.chimney.diameterCm + ' см', 1, Math.PI * chimR * 2, cfg.chimney.heightCm, 0.3, 'сталь 3 мм', 'розгортка', 'tube', Math.PI * chimR * 2);
  add('Комір димоходу', 1, Math.PI * collarR * 2, steelCm * 2.2, 0.4, 'сталь', '', 'tube');
  // Ніжки
  if (legH > 0) add('Ніжки 50×50', 4, 5, legH, 5, 'сталь/профіль', 'профільна труба', 'bar');
  // Теплові екрани
  // Теплові екрани — лише якщо увімкнені (опція).
  if (cfg.visibility && cfg.visibility.shields) {
    const shieldH = h * 0.78;
    add('Тепловий екран — задній', 1, w - 4, shieldH, 0.3, 'сталь 3 мм', 'зазор 3.2 см');
    add('Тепловий екран — бічні (Л/П)', 2, d - 4, shieldH, 0.3, 'сталь 3 мм');
  }

  const isSteel = (m) => /steel|сталь/.test(m);
  const steelMass = parts.filter(p => isSteel(p.mat)).reduce((s, p) => s + p.massKg * p.qty, 0);
  const brickMass = parts.filter(p => /firebrick|шамот/.test(p.mat)).reduce((s, p) => s + p.massKg * p.qty, 0);
  const glassMass = parts.filter(p => /glass|скло/.test(p.mat)).reduce((s, p) => s + p.massKg * p.qty, 0);
  const insMass = parts.filter(p => /vermiculite|CFB|вермикуліт/.test(p.mat)).reduce((s, p) => s + p.massKg * p.qty, 0);
  const cutParts = parts.filter(p => p.mat.match(/steel|сталь/) && (p.kind === 'sheet' || p.kind === 'bar' || p.kind === 'tube'));
  const cutAreaCm2 = cutParts.reduce((s, p) => s + p.areaCm2 * p.qty, 0);
  const weldCm = parts.reduce((s, p) => s + p.weldCm * p.qty, 0);
  const physics = physicsResult || PhysicsModel.evaluate(cfg);

  return {
    estimate: true,
    parts,
    totals: {
      steelMassKg: round(steelMass, 1),
      brickMassKg: round(brickMass, 1),
      insulationMassKg: round(insMass, 1),
      glassMassKg: round(glassMass, 2),
      totalMassKg: round(steelMass + brickMass + glassMass + insMass, 1),
      steelAreaM2: round(cutAreaCm2 / 10000, 2),
      cutAreaM2: round((cutAreaCm2 * 1.12) / 10000, 2), // +12% на розкладку металу (nesting)
      weldMeters: round(weldCm / 100, 1),
      purchasedCount: parts.filter(p => p.kind === 'purchased').reduce((s, p) => s + p.qty, 0),
      partCount: parts.reduce((s, p) => s + p.qty, 0),
    },
    metrics: {
      heatOutputKw: physics.metrics.heatOutputKw,
      efficiencyPct: physics.metrics.efficiencyPct,
      fireboxLiters: physics.metrics.fireboxLiters,
    },
  };
}

export function bomToCsv(bom, lang = 'uk') {
  const head = lang === 'en'
    ? 'Part,Qty,Width cm,Height cm,Thickness cm,Type,Cut area cm2,Mass kg,Material,Weld cm,Note'
    : 'Деталь,К-ть,Ширина см,Висота см,Товщина см,Тип,Площа різу см2,Маса кг,Матеріал,Шов см,Примітка';
  const kindTxt = lang === 'en'
    ? { sheet: 'sheet', bar: 'bar', tube: 'developed', purchased: 'purchased' }
    : { sheet: 'лист', bar: 'планка', tube: 'розгортка', purchased: 'покупна' };
  const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = bom.parts.map((p) => [
    p.name, p.qty, p.wCm, p.hCm, p.tCm, kindTxt[p.kind] || p.kind,
    (p.kind === 'purchased' ? '' : p.areaCm2), p.massKg, p.mat, p.weldCm, p.note,
  ].map(esc).join(','));
  const totals = lang === 'en'
    ? `TOTAL,,steel ${bom.totals.steelMassKg} kg,brick ${bom.totals.brickMassKg} kg,glass ${bom.totals.glassMassKg} kg,cut ${bom.totals.cutAreaM2} m2,weld ${bom.totals.weldMeters} m,purchased ${bom.totals.purchasedCount} pcs,total ${bom.totals.totalMassKg} kg (estimate)`
    : `РАЗОМ,,сталь ${bom.totals.steelMassKg} кг,шамот ${bom.totals.brickMassKg} кг,скло ${bom.totals.glassMassKg} кг,різ ${bom.totals.cutAreaM2} м2,шов ${bom.totals.weldMeters} м,покупних ${bom.totals.purchasedCount} шт,загалом ${bom.totals.totalMassKg} кг (оцінка)`;
  return [head, ...rows, '', totals].join('\n');
}

// DXF R12 (LINE + TEXT) — розкладка плоских деталей для плазми/лазера.
// Одиниці — мм (1 см = 10 мм). Одна деталь = прямокутник + маркування.
export function buildDXF(cfg, lang = 'uk') {
  const bom = buildBOM(cfg, null, lang);
  const flat = bom.parts.filter(p => /steel|сталь/.test(p.mat) && (p.kind === 'sheet' || p.kind === 'bar' || p.kind === 'tube'));
  const sheetW = 2000; // мм корисна ширина листа
  const gap = 20;      // мм між деталями
  let x = 20, y = 20, rowH = 0, n = 0;
  const out = [];
  const line = (x1, y1, x2, y2) => {
    out.push('0', 'LINE', '8', 'CUT', '10', x1.toFixed(2), '20', y1.toFixed(2), '11', x2.toFixed(2), '21', y2.toFixed(2));
  };
  const text = (tx, ty, h, s) => {
    out.push('0', 'TEXT', '8', 'MARK', '10', tx.toFixed(2), '20', ty.toFixed(2), '40', h.toFixed(2), '1', s);
  };
  for (const p of flat) {
    const pw = p.wCm * 10, ph = p.hCm * 10;
    for (let i = 0; i < p.qty; i++) {
      if (x + pw > sheetW) { x = 20; y += rowH + gap; rowH = 0; }
      line(x, y, x + pw, y); line(x + pw, y, x + pw, y + ph);
      line(x + pw, y + ph, x, y + ph); line(x, y + ph, x, y);
      n++;
      text(x + 8, y + 8, Math.min(30, ph * 0.1), `${p.wCm}x${p.hCm} t${p.tCm} #${n}`);
      x += pw + gap;
      rowH = Math.max(rowH, ph);
    }
  }
  return ['0', 'SECTION', '2', 'ENTITIES', ...out, '0', 'ENDSEC', '0', 'EOF'].join('\n');
}

// Технічне креслення у SVG: front/side/top. Підлога — внизу (Y інвертований коректно).
export function buildDrawingSVG(cfg, lang = 'uk') {
  const { widthCm: W, depthCm: D, heightCm: H, legHeightCm: L } = cfg.dimensions;
  const steelMm = cfg.materials.steelThicknessMm;
  const steelCm = steelMm / 10;
  const brickT = Math.min(cfg.materials.firebrickThicknessCm, 12);
  const scale = 3; // px per cm
  const margin = 70;
  const px = (v) => round(v * scale, 1);
  const u = lang === 'en' ? 'cm' : 'см';
  const lbBody = lang === 'en' ? 'Body H' : 'H корпусу';
  const lbLegs = lang === 'en' ? 'Legs' : 'Ніжки';
  const lbTotal = lang === 'en' ? 'Overall H' : 'H загальна';
  const lbDoor = lang === 'en' ? 'door' : 'дверцята';
  const lbBaffle = lang === 'en' ? 'baffle Y' : 'бафль Y';
  const dimLine = (x1, y1, x2, y2, label, side = 'top') => {
    const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
    const tx = side === 'top' ? midX : midX - 6;
    const ty = side === 'top' ? midY - 8 : midY + 4;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#333" stroke-width="1" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
      <rect x="${tx - 32}" y="${ty - 10}" width="64" height="16" rx="3" fill="#fff" stroke="#4f8cff"/><text x="${tx}" y="${ty + 2}" text-anchor="middle" font-size="10" fill="#172033">${label}</text>`;
  };

  // ---- FRONT VIEW ----
  const fw = px(W), fh = px(H + L);
  const fx0 = margin, fy0 = margin;
  const floorY = fy0 + fh;                      // низ = підлога
  const sy = (cm) => floorY - px(cm);           // см від підлоги → екран Y
  const doorW = Math.min(cfg.door.widthCm, W - steelCm * 4);
  const doorH = Math.min(cfg.door.heightCm, H - steelCm * 4);
  const doorCenterCm = L + H * 0.48;
  const dx0 = fx0 + (fw - px(doorW)) / 2;
  const dyTop = sy(doorCenterCm + doorH / 2);
  const baffleY = Math.max(steelCm * 4, Math.min(H - steelCm * 2, cfg.baffle.heightCm));
  const front = `
    <rect x="${fx0}" y="${fy0}" width="${fw}" height="${fh}" fill="#f8f9fb" stroke="#172033" stroke-width="1.5"/>
    ${L > 0 ? `<line x1="${fx0}" y1="${sy(L)}" x2="${fx0 + fw}" y2="${sy(L)}" stroke="#172033" stroke-width="1" stroke-dasharray="3 3"/>` : ''}
    <rect x="${dx0}" y="${dyTop}" width="${px(doorW)}" height="${px(doorH)}" fill="#eef3fa" stroke="#4f8cff" stroke-width="1" stroke-dasharray="4 2"/>
    <text x="${dx0 + px(doorW) / 2}" y="${dyTop + px(doorH) / 2}" text-anchor="middle" font-size="10" fill="#4f8cff">${lbDoor}</text>
    <line x1="${fx0}" y1="${sy(L + baffleY)}" x2="${fx0 + fw}" y2="${sy(L + baffleY)}" stroke="#c56a2d" stroke-width="1.5" stroke-dasharray="6 3"/>
    <text x="${fx0 + fw - 8}" y="${sy(L + baffleY) - 4}" text-anchor="end" font-size="9" fill="#c56a2d">${lbBaffle}=${cfg.baffle.heightCm} ${u}</text>
    ${dimLine(fx0, floorY + 20, fx0 + fw, floorY + 20, `W ${W} ${u}`, 'top')}
    ${dimLine(fx0 + fw + 20, sy(L), fx0 + fw + 20, sy(L + H), `${lbBody} ${H} ${u}`, 'side')}
    ${L > 0 ? dimLine(fx0 + fw + 48, sy(0), fx0 + fw + 48, sy(L + H), `${lbTotal} ${H + L} ${u}`, 'side') : ''}
    ${L > 0 ? dimLine(fx0 - 22, sy(0), fx0 - 22, sy(L), `${lbLegs} ${L} ${u}`, 'side') : ''}
  `;
  // ---- SIDE VIEW ----
  const sx0 = margin + fw + 150;
  const sw = px(D);
  const side = `
    <rect x="${sx0}" y="${fy0}" width="${sw}" height="${fh}" fill="#f8f9fb" stroke="#172033" stroke-width="1.5"/>
    ${L > 0 ? `<line x1="${sx0}" y1="${sy(L)}" x2="${sx0 + sw}" y2="${sy(L)}" stroke="#172033" stroke-width="1" stroke-dasharray="3 3"/>` : ''}
    <rect x="${sx0}" y="${sy(L + baffleY)}" width="${sw}" height="${px(brickT)}" fill="#f5e3d0" stroke="#c56a2d"/>
    <circle cx="${sx0 + sw / 2}" cy="${sy(L + H)}" r="${px(cfg.chimney.diameterCm / 2)}" fill="none" stroke="#172033" stroke-width="1"/>
    ${dimLine(sx0, floorY + 20, sx0 + sw, floorY + 20, `D ${D} ${u}`, 'top')}
  `;
  // ---- TOP VIEW ---- (перед унизу, зад/димохід — вище)
  const ty0 = fy0 + fh + 80;
  const top = `
    <rect x="${fx0}" y="${ty0}" width="${fw}" height="${sw}" fill="#f8f9fb" stroke="#172033" stroke-width="1.5"/>
    <circle cx="${fx0 + fw / 2}" cy="${ty0 + px(D * 0.3)}" r="${px(cfg.chimney.diameterCm / 2)}" fill="#eef3fa" stroke="#4f8cff" stroke-width="1"/>
    <text x="${fx0 + fw / 2}" y="${ty0 + px(D * 0.3) - px(cfg.chimney.diameterCm / 2) - 5}" text-anchor="middle" font-size="9" fill="#4f8cff">Ø${cfg.chimney.diameterCm} ${u}</text>
    ${dimLine(fx0, ty0 + sw + 20, fx0 + fw, ty0 + sw + 20, `W ${W} ${u}`, 'top')}
  `;

  const totalW = margin * 2 + fw + 150 + sw;
  const totalH = ty0 + sw + 90;
  const title = lang === 'en' ? 'Woodstove 2 — technical drawing (cm)' : 'Woodstove 2 — технічне креслення (см)';
  const sub = lang === 'en'
    ? `steel ${steelMm} mm · firebrick ${brickT} cm · ${new Date().toLocaleDateString()}`
    : `сталь ${steelMm} мм · шамот ${brickT} см · ${new Date().toLocaleDateString()}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" font-family="Arial">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#333"/>
      </marker>
    </defs>
    <rect width="${totalW}" height="${totalH}" fill="#fff"/>
    <text x="${margin}" y="${30}" font-size="14" font-weight="bold" fill="#172033">${title}</text>
    <text x="${margin}" y="${48}" font-size="10" fill="#666">${sub}</text>
    ${front}${side}${top}
  </svg>`;
}
