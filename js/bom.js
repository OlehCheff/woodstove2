// BOM (Bill of Materials) + технічні дані з конфігу.
// Розміри деталей рахуються за тими ж формулами, що й у stove-builder.js,
// щоб специфікація збігалася з 3D-моделлю 1:1.
import { PhysicsModel } from './physics-model.js';

const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export function buildBOM(cfg, physicsResult = null) {
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
    if (mat === 'шамот') return 0.0021;      // шамот ~2.1 г/см³
    if (mat.includes('скло')) return 0.0025; // скло ~2.5 г/см³
    return 0.00785;                          // сталь 7.85 г/см³
  };
  // kind: sheet | bar | tube | purchased. weldCm — довжина зварного шва на одну деталь.
  const add = (name, qty, wCm, hCm, tCm, mat, note = '', kind = 'sheet', weldCm = 0) => {
    const areaCm2 = round(wCm * hCm, 1);
    const massKg = round(areaCm2 * tCm * densityOf(mat), 2);
    parts.push({
      name, qty, wCm: round(wCm, 1), hCm: round(hCm, 1), tCm: round(tCm, 1),
      areaCm2, massKg, mat, note, kind, weldCm: round(weldCm, 1), estimate: true,
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
  // Повітряні системи
  add('Панель primary + задвижка', 1, Math.min(w - steelCm * 3, cfg.primaryAir.holeCount * cfg.primaryAir.holeSpacingCm + 8), 11.5, steelCm, `сталь ${steelMm} мм`, `${cfg.primaryAir.holeCount}×Ø${cfg.primaryAir.holeDiameterCm} см`);
  add('Secondary стояки (Л/П)', 2, cfg.secondaryAir.channelWidthCm, Math.max(12, Math.min(cfg.secondaryAir.preheatLengthCm, 999)), cfg.secondaryAir.channelDepthCm, 'сталь 3 мм');
  add('Secondary manifold', 1, Math.max(12, Math.min(innerW - 2, cfg.secondaryAir.holeCount * cfg.secondaryAir.holeSpacingCm + 10)), cfg.secondaryAir.manifoldHeightCm, cfg.secondaryAir.channelDepthCm, 'сталь 3 мм', `${cfg.secondaryAir.holeCount}×Ø${cfg.secondaryAir.holeDiameterCm} см`);
  const washW = Math.max(12, Math.min(w - steelCm * 3, doorW + 6));
  add('Air-wash канали (Л/П)', 2, cfg.airWash.channelWidthCm, Math.max(12, Math.min(cfg.airWash.preheatLengthCm, 999)), cfg.airWash.channelDepthCm, 'сталь 3 мм');
  add('Air-wash корпус + щілина', 1, washW, 4.3, cfg.airWash.channelDepthCm, 'сталь 3 мм', `щілина ${cfg.airWash.gapCm} см`);
  add('Верхнє піддувало', 1, Math.max(12, washW * 0.62), 1.1, 0.9, 'сталь');
  // Колосник + зольник
  const grateSpan = Math.max(14, innerW - 8);
  const slatCount = Math.max(5, Math.floor(grateSpan / 3.4));
  add('Колосник (прути)', slatCount, 1.6, Math.max(10, innerD * 0.68), 1.6, 'сталь', 'переріз 16×16 мм', 'bar');
  add('Зольник (ящик + фасад)', 1, Math.min(innerW - 6, doorW * 0.66), 5.5 + 4.5, 1.6, 'сталь', 'з ручкою');
  // Шамот + ізоляція
  const cw = Math.max(10, w - steelCm * 2);
  const cd = Math.max(10, d - steelCm * 2);
  const linerTopY = Math.max(steelCm * 4, Math.min(h - steelCm * 2 - insT, cfg.baffle.heightCm - steelCm));
  const brickH = Math.max(10, linerTopY - steelCm - insT - brickT);
  add('Шамот — дно', 1, cw - insT * 2, cd - insT * 2, brickT, 'шамот');
  add('Шамот — стіни (Л/П/З)', 3, brickT, brickH, brickT, 'шамот', 'Л + П + задня');
  if (insT > 0) add('Ізоляція топки (4 сторони)', 4, cw, linerTopY - steelCm, insT, 'vermiculite/CFB');
  // Димохід
  add('Димохід Ø' + cfg.chimney.diameterCm + ' см', 1, Math.PI * chimR * 2, cfg.chimney.heightCm, 0.3, 'сталь 3 мм', 'розгортка', 'tube', Math.PI * chimR * 2);
  add('Комір димоходу', 1, Math.PI * collarR * 2, steelCm * 2.2, 0.4, 'сталь', '', 'tube');
  // Ніжки
  if (legH > 0) add('Ніжки 50×50', 4, 5, legH, 5, 'сталь/профіль', 'профільна труба', 'bar');
  // Теплові екрани
  const shieldH = h * 0.78;
  add('Тепловий екран — задній', 1, w - 4, shieldH, 0.4, 'сталь 4 мм', 'зазор 3.2 см');
  add('Тепловий екран — бічні (Л/П)', 2, d - 4, shieldH, 0.4, 'сталь 4 мм');

  const steelMass = parts.filter(p => p.mat.includes('сталь')).reduce((s, p) => s + p.massKg * p.qty, 0);
  const brickMass = parts.filter(p => p.mat === 'шамот').reduce((s, p) => s + p.massKg * p.qty, 0);
  const glassMass = parts.filter(p => p.mat.includes('скло')).reduce((s, p) => s + p.massKg * p.qty, 0);
  const cutParts = parts.filter(p => p.kind === 'sheet' || p.kind === 'bar' || p.kind === 'tube');
  const cutAreaCm2 = cutParts.reduce((s, p) => s + p.areaCm2 * p.qty, 0);
  const weldCm = parts.reduce((s, p) => s + p.weldCm * p.qty, 0);
  const physics = physicsResult || PhysicsModel.evaluate(cfg);

  return {
    estimate: true,
    parts,
    totals: {
      steelMassKg: round(steelMass, 1),
      brickMassKg: round(brickMass, 1),
      glassMassKg: round(glassMass, 2),
      totalMassKg: round(steelMass + brickMass + glassMass, 1),
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
  const kindTxt = { sheet: 'лист', bar: 'планка', tube: 'розгортка', purchased: 'покупна' };
  const rows = bom.parts.map((p) => [
    p.name, p.qty, p.wCm, p.hCm, p.tCm, kindTxt[p.kind] || p.kind,
    (p.kind === 'purchased' ? '' : p.areaCm2), p.massKg, p.mat, p.weldCm, p.note,
  ].join(','));
  const totals = lang === 'en'
    ? `TOTAL,,steel ${bom.totals.steelMassKg} kg,brick ${bom.totals.brickMassKg} kg,glass ${bom.totals.glassMassKg} kg,cut ${bom.totals.cutAreaM2} m2,weld ${bom.totals.weldMeters} m,purchased ${bom.totals.purchasedCount} pcs,total ${bom.totals.totalMassKg} kg (estimate)`
    : `РАЗОМ,,сталь ${bom.totals.steelMassKg} кг,шамот ${bom.totals.brickMassKg} кг,скло ${bom.totals.glassMassKg} кг,різ ${bom.totals.cutAreaM2} м2,шов ${bom.totals.weldMeters} м,покупних ${bom.totals.purchasedCount} шт,загалом ${bom.totals.totalMassKg} кг (оцінка)`;
  return [head, ...rows, '', totals].join('\n');
}

// DXF R12 (LINE + TEXT) — розкладка плоских деталей для плазми/лазера.
// Одиниці — мм (1 см = 10 мм). Одна деталь = прямокутник + маркування.
export function buildDXF(cfg) {
  const bom = buildBOM(cfg);
  const flat = bom.parts.filter(p => p.kind === 'sheet' || p.kind === 'bar' || p.kind === 'tube');
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

// Технічне креслення у SVG: front/side/top з внутрішніми деталями.
export function buildDrawingSVG(cfg) {
  const { widthCm: W, depthCm: D, heightCm: H, legHeightCm: L } = cfg.dimensions;
  const steelMm = cfg.materials.steelThicknessMm;
  const steelCm = steelMm / 10;
  const brickT = Math.min(cfg.materials.firebrickThicknessCm, 12);
  const scale = 3; // px per cm
  const margin = 70;
  const px = (v) => round(v * scale, 1);
  const dimLine = (x1, y1, x2, y2, label, side = 'top') => {
    const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
    const tx = side === 'top' ? midX : midX - 6;
    const ty = side === 'top' ? midY - 8 : midY + 4;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#333" stroke-width="1" marker-start="url(#arrow)" marker-end="url(#arrow)"/>
      <rect x="${tx - 30}" y="${ty - 10}" width="60" height="16" rx="3" fill="#fff" stroke="#4f8cff"/><text x="${tx}" y="${ty + 2}" text-anchor="middle" font-size="10" fill="#172033">${label}</text>`;
  };

  // ---- FRONT VIEW ----
  const fw = px(W), fh = px(H + L);
  const fx0 = margin, fy0 = margin;
  const doorW = Math.min(cfg.door.widthCm, W - steelCm * 4);
  const doorH = Math.min(cfg.door.heightCm, H - steelCm * 4);
  const dx0 = fx0 + (fw - px(doorW)) / 2;
  const dy0 = fy0 + px(L) + px(H * 0.48) - px(doorH) / 2;
  const baffleY = Math.max(steelCm * 4, Math.min(H - steelCm * 2, cfg.baffle.heightCm));
  const front = `
    <rect x="${fx0}" y="${fy0}" width="${fw}" height="${fh}" fill="#f8f9fb" stroke="#172033" stroke-width="1.5"/>
    <rect x="${dx0}" y="${dy0}" width="${px(doorW)}" height="${px(doorH)}" fill="#eef3fa" stroke="#4f8cff" stroke-width="1" stroke-dasharray="4 2"/>
    <text x="${dx0 + px(doorW) / 2}" y="${dy0 + px(doorH) / 2}" text-anchor="middle" font-size="10" fill="#4f8cff">дверцята</text>
    <line x1="${fx0}" y1="${fy0 + px(L + baffleY)}" x2="${fx0 + fw}" y2="${fy0 + px(L + baffleY)}" stroke="#c56a2d" stroke-width="1.5" stroke-dasharray="6 3"/>
    <text x="${fx0 + fw - 8}" y="${fy0 + px(L + baffleY) - 4}" text-anchor="end" font-size="9" fill="#c56a2d">бафль Y=${cfg.baffle.heightCm} см</text>
    ${dimLine(fx0, fy0 + fh + 20, fx0 + fw, fy0 + fh + 20, `W ${W} см`, 'top')}
    ${dimLine(fx0 + fw + 20, fy0 + px(L), fx0 + fw + 20, fy0 + px(L + H), `H ${H} см`, 'side')}
    ${L > 0 ? dimLine(fx0 + fw + 45, fy0, fx0 + fw + 45, fy0 + fh, `Σ ${H + L} см`, 'side') : ''}
    ${L > 0 ? dimLine(fx0 - 20, fy0, fx0 - 20, fy0 + px(L), `legs ${L} см`, 'side') : ''}
  `;
  // ---- SIDE VIEW ----
  const sx0 = margin + fw + 140;
  const sw = px(D);
  const side = `
    <rect x="${sx0}" y="${fy0}" width="${sw}" height="${fh}" fill="#f8f9fb" stroke="#172033" stroke-width="1.5"/>
    <rect x="${sx0}" y="${fy0 + px(L + baffleY) - px(brickT)}" width="${sw}" height="${px(brickT)}" fill="#f5e3d0" stroke="#c56a2d"/>
    <circle cx="${sx0 + sw / 2}" cy="${fy0 + px(L + H) - px(cfg.chimney.diameterCm / 2)}" r="${px(cfg.chimney.diameterCm / 2)}" fill="none" stroke="#172033" stroke-width="1"/>
    ${dimLine(sx0, fy0 + fh + 20, sx0 + sw, fy0 + fh + 20, `D ${D} см`, 'top')}
  `;
  // ---- TOP VIEW ----
  const ty0 = fy0 + fh + 70;
  const chimZoff = D * 0.2;
  const top = `
    <rect x="${fx0}" y="${ty0}" width="${fw}" height="${sw}" fill="#f8f9fb" stroke="#172033" stroke-width="1.5"/>
    <circle cx="${fx0 + fw / 2}" cy="${ty0 + px(chimZoff)}" r="${px(cfg.chimney.diameterCm / 2)}" fill="#eef3fa" stroke="#4f8cff" stroke-width="1"/>
    <text x="${fx0 + fw / 2}" y="${ty0 + px(chimZoff) - px(cfg.chimney.diameterCm / 2) - 5}" text-anchor="middle" font-size="9" fill="#4f8cff">Ø${cfg.chimney.diameterCm} см</text>
    ${dimLine(fx0, ty0 + sw + 20, fx0 + fw, ty0 + sw + 20, `W ${W} см`, 'top')}
  `;

  const totalW = margin * 2 + fw + 140 + sw;
  const totalH = ty0 + sw + 90;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" font-family="Arial">
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" fill="#333"/>
      </marker>
    </defs>
    <rect width="${totalW}" height="${totalH}" fill="#fff"/>
    <text x="${margin}" y="${30}" font-size="14" font-weight="bold" fill="#172033">Woodstove 2 — технічне креслення (см)</text>
    <text x="${margin}" y="${48}" font-size="10" fill="#666">сталь ${steelMm} мм · шамот ${brickT} см · ${new Date().toLocaleDateString()}</text>
    ${front}${side}${top}
  </svg>`;
}
