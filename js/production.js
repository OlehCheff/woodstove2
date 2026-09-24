// Виробничий шар (блок G) — чисті функції без DOM/three, без імпортів.
// Таблиці допусків, теплова деформація, правила посадок і рендер символів
// зварних швів ISO 2553 (система A) у SVG. Єдине джерело для js/bom.js
// (buildWeldPlan/buildFitPlan) і креслення (buildDrawingSVG).

export const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
export const ceilTo = (v, step) => Math.ceil(v / step - 1e-9) * step;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ISO 2768-1, клас m — граничні відхилення лінійних розмірів, мм: [до, ±]
export const ISO2768_M = [[3, 0.1], [6, 0.1], [30, 0.2], [120, 0.3], [400, 0.5], [1000, 0.8], [2000, 1.2], [4000, 2]];
// ISO 13920, клас B — лінійні розміри зварних конструкцій, мм
export const ISO13920_B = [[30, 1], [120, 2], [400, 2], [1000, 3], [2000, 4], [4000, 6]];
export const tolFor = (table, mm) => (table.find(([max]) => mm <= max) || table[table.length - 1])[1];

// Теплова деформація Δl/l вуглецевої сталі — EN 1993-1-2, 3.4.1.1 (20…1200 °C).
export function steelStrain(tC) {
  const T = clamp(+tC || 20, 20, 1200);
  if (T < 750) return 1.2e-5 * T + 0.4e-8 * T * T - 2.416e-4;
  if (T <= 860) return 1.1e-2;
  return 2e-5 * T - 6.2e-3;
}
// Аустенітна нержавійка — EN 1993-1-2, додаток C.
export function stainlessStrain(tC) {
  const T = clamp(+tC || 20, 20, 1200);
  return (16 + 4.79e-3 * T - 1.243e-6 * T * T) * 1e-6 * (T - 20);
}
export const FIRECLAY_ALPHA = 5.5e-6; // шамот, середній 20…1000 °C (оцінка)
export const fireclayStrain = (tC) => FIRECLAY_ALPHA * (clamp(+tC || 20, 20, 1400) - 20);

// Розрахункові температури (найгірший перехідний випадок: деталь гаряча, корпус ще холодний, розпал).
export const DESIGN_TEMP_C = { baffle: 800, stainless: 800, firebrick: 700, body: 20 };
// Конструктивні запаси, мм.
export const FIT_MM = {
  assembly: 1, brickMin: 2, board: 2, glassSide: 2.5, glassCutTol: 1,
  doorOverlapMin: 15, gasketRope: 10, railBearingMin: 10, flueSlip: 2, flueInsertMin: 50,
  tubeHoleClear: 1, tubeAxialExtra: 2,
};

// Зазор на бік для вільної деталі між двома холодними стінками: половина
// теплового подовження + монтажний запас, округлено вгору до 0.5 мм.
export const gapPerSideMm = (lengthMm, strain, extraMm = FIT_MM.assembly) => ceilTo(lengthMm * strain / 2 + extraMm, 0.5);

// Катет/товщина кутового шва: a ≈ 0.7·t_min, не менше 3 мм (EN 1993-1-8, 4.5.2), ціле мм.
export const filletA = (tMinMm) => Math.min(5, Math.max(3, Math.floor(0.7 * tMinMm)));

// Переривчастий шов n × l (e) на довжині L, мм.
export function stitch(lengthMm, l = 40, e0 = 60) {
  const n = Math.max(2, Math.round((lengthMm + e0) / (l + e0)));
  const e = Math.max(10, Math.round((lengthMm - n * l) / (n - 1)));
  return { n, l, e, weldMm: n * l };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Символ зварного шва ISO 2553 (система A).
// (x,y) — точка шва (вістря стрілки); (kx,ky) — злам стрілки/початок опорної лінії.
// w — {id, type:'fillet'|'butt-I'|'butt-V', a, s, sides:'arrow'|'both', allAround, flush, stitch, tail}
// compact — лише гліф + хвіст (на виді); інакше — повний символ (у таблиці швів).
export function weldSymbolSVG(x, y, kx, ky, w, { refLen = 26, compact = true, color = '#172033' } = {}) {
  const dir = kx >= x ? 1 : -1;
  const rx2 = kx + dir * refLen;
  const out = [];
  const ln = (x1, y1, x2, y2, extra = '') => out.push(`<line x1="${round(x1)}" y1="${round(y1)}" x2="${round(x2)}" y2="${round(y2)}" stroke="${color}" stroke-width="0.9"${extra}/>`);
  // стрілка від зламу до шва
  ln(kx, ky, x, y);
  const ang = Math.atan2(y - ky, x - kx), ah = 5;
  out.push(`<path d="M${round(x)},${round(y)} L${round(x - ah * Math.cos(ang - 0.35))},${round(y - ah * Math.sin(ang - 0.35))} L${round(x - ah * Math.cos(ang + 0.35))},${round(y - ah * Math.sin(ang + 0.35))} Z" fill="${color}"/>`);
  // опорна лінія (суцільна) + ідентифікаційна (штрихова) — лише для однобічного шва
  ln(kx, ky, rx2, ky);
  if (w.sides !== 'both') ln(kx + dir * 4, ky + 3, rx2, ky + 3, ' stroke-dasharray="3 2"');
  // гліф — на 0.42·refLen від зламу, над суцільною лінією (= з боку стрілки)
  const gx = kx + dir * refLen * 0.42, s = 6;
  const glyph = (up) => {
    const k = up ? -1 : 1;
    if (w.type === 'fillet') out.push(`<path d="M${round(gx - s / 2)},${ky} L${round(gx - s / 2)},${round(ky + k * s)} L${round(gx + s / 2)},${ky}" fill="none" stroke="${color}" stroke-width="0.9"/>`);
    else if (w.type === 'butt-I') { ln(gx - 1.6, ky, gx - 1.6, ky + k * s); ln(gx + 1.6, ky, gx + 1.6, ky + k * s); }
    else if (w.type === 'butt-V') { ln(gx, ky, gx - s * 0.58, ky + k * s); ln(gx, ky, gx + s * 0.58, ky + k * s); }
    if (w.flush && up) ln(gx - s * 0.6, ky - s - 2, gx + s * 0.6, ky - s - 2);
  };
  glyph(true);
  if (w.sides === 'both') glyph(false);
  // кругом (all-around) — коло в зламі
  if (w.allAround) out.push(`<circle cx="${round(kx)}" cy="${round(ky)}" r="2.6" fill="none" stroke="${color}" stroke-width="0.9"/>`);
  // хвіст (вилка + позначення процесу/ID)
  ln(rx2, ky, rx2 + dir * 4, ky - 4); ln(rx2, ky, rx2 + dir * 4, ky + 4);
  const anchor = dir > 0 ? 'start' : 'end';
  out.push(`<text x="${round(rx2 + dir * 6)}" y="${round(ky + 3)}" font-size="8" fill="${color}" text-anchor="${anchor}">${esc(w.tail || '')}</text>`);
  if (!compact) {
    // a-розмір ліворуч від гліфа, довжина/крок праворуч (ISO 2553): відсутність довжини = суцільний на всю довжину
    const left = w.type === 'fillet' ? `a${w.a}` : (w.type === 'butt-V' ? `s${w.s}` : '');
    if (left && w.sides === 'both') out.push(`<text x="${round(gx - dir * (s / 2 + 2))}" y="${round(ky + 8.5)}" font-size="8" fill="${color}" text-anchor="${dir > 0 ? 'end' : 'start'}">${left}</text>`);
    if (left) out.push(`<text x="${round(gx - dir * (s / 2 + 2))}" y="${round(ky - 1.5)}" font-size="8" fill="${color}" text-anchor="${dir > 0 ? 'end' : 'start'}">${left}</text>`);
    const right = w.stitch ? `${w.stitch.n}×${w.stitch.l} (${w.stitch.e})` : '';
    if (right) out.push(`<text x="${round(gx + dir * (s / 2 + 2))}" y="${round(ky - 1.5)}" font-size="8" fill="${color}" text-anchor="${dir > 0 ? 'start' : 'end'}">${right}</text>`);
  }
  return `<g class="weld" data-weld="${esc(w.id || '')}">${out.join('')}</g>`;
}
