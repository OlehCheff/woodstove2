// Побудова печі: чиста функція (THREE, cfg) → { group, refs }. Без глобалів.
import * as THREE from 'three';

function mat(cache, key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}
function plate(w, h, d, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.castShadow = m.receiveShadow = true;
  return m;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function disposeGroup(root) {
  root.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    if (n.userData.ownedMaterial && n.material?.dispose) n.material.dispose();
  });
}

export function buildStove(cfg, cache = new Map()) {
  const group = new THREE.Group();
  group.name = 'stove';

  const w = cfg.dimensions.widthCm, d = cfg.dimensions.depthCm;
  const h = cfg.dimensions.heightCm, legH = cfg.dimensions.legHeightCm;
  const steelT = Math.min(cfg.materials.steelThicknessMm / 10, w / 6, d / 6, h / 8);
  const brickT = Math.min(cfg.materials.firebrickThicknessCm, 12);
  const thermal = cfg.thermal || {};
  const insulationT = Math.min(Math.max(thermal.insulationThicknessCm == null ? 3 : +thermal.insulationThicknessCm, 0), 8);
  const refractoryT = Math.min(Math.max(thermal.baffleRefractoryThicknessCm == null ? 3 : +thermal.baffleRefractoryThicknessCm, 0), 8);

  const steel = mat(cache, `steel|${cfg.colors.steel}|${cfg.colors.steelRoughness}|${cfg.colors.steelMetalness}`,
    () => new THREE.MeshStandardMaterial({ color: cfg.colors.steel, roughness: cfg.colors.steelRoughness, metalness: cfg.colors.steelMetalness }));
  const brickM = mat(cache, `brick|${cfg.colors.brick}`,
    () => new THREE.MeshStandardMaterial({ color: cfg.colors.brick, roughness: 0.95, metalness: 0.04 }));
  const thermalM = mat(cache, `thermal|${insulationT}|${refractoryT}`,
    () => new THREE.MeshStandardMaterial({ color: 0x8f8172, roughness: 0.98, metalness: 0.02 }));
  const darkM = mat(cache, 'dark', () => new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.45, metalness: 0.6 }));
  const ductM = mat(cache, 'duct', () => new THREE.MeshStandardMaterial({ color: 0x616872, roughness: 0.4, metalness: 0.58 }));
  const controlM = mat(cache, `control|${cfg.colors.control}`, () => new THREE.MeshStandardMaterial({ color: cfg.colors.control, roughness: 0.35, metalness: 0.35 }));
  const handleM = mat(cache, `handle|${cfg.colors.handle}`, () => new THREE.MeshStandardMaterial({ color: cfg.colors.handle, metalness: 0.85, roughness: 0.25 }));
  const primaryAirM = mat(cache, 'primary-air', () => new THREE.MeshStandardMaterial({ color: 0x4f8cff, roughness: 0.35, metalness: 0.45 }));
  const airWashM = mat(cache, 'air-wash', () => new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.35, metalness: 0.45 }));
  const secondaryAirM = mat(cache, 'secondary-air', () => new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.45, metalness: 0.4 }));
  const holeM = mat(cache, 'hole', () => new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.95 }));
  const gasketM = mat(cache, 'gasket', () => new THREE.MeshStandardMaterial({ color: 0x16181c, roughness: 0.9, metalness: 0.1 }));
  const glassM = mat(cache, `glass|${cfg.colors.glass}`,
    () => new THREE.MeshStandardMaterial({ color: cfg.colors.glass, transparent: true, opacity: 0.42, roughness: 0.06, metalness: 0.15 }));

  const shell = new THREE.Group(); shell.name = 'shell'; shell.position.y = legH;

  // дно / боки / зад — перед відкритий під дверцята
  const bottom = plate(w, steelT, d, steel); bottom.position.y = steelT / 2; shell.add(bottom);
  const left = plate(steelT, h, d, steel); left.position.set(-w / 2 + steelT / 2, h / 2, 0); shell.add(left);
  const right = plate(steelT, h, d, steel); right.position.set(w / 2 - steelT / 2, h / 2, 0); shell.add(right);
  const back = plate(w, h, steelT, steel); back.position.set(0, h / 2, -d / 2 + steelT / 2); shell.add(back);

  // Передня стінка з вирізом під дверцята. Чотири панелі замість boolean/shape
  // роблять отвір стабільним для WebGL і дають окремі деталі для STL/GLTF.
  const doorWc = Math.max(20, Math.min(cfg.door.widthCm, w - steelT * 4));
  const doorHc = Math.max(20, Math.min(cfg.door.heightCm, h - steelT * 4));
  const frontPanel = new THREE.Group(); frontPanel.name = 'frontPanel';
  const openingW = Math.min(w - steelT * 2, doorWc + 0.8);
  const openingH = Math.min(h - steelT * 2, doorHc + 0.8);
  const openingBottom = Math.max(steelT, h * 0.48 - openingH / 2);
  const openingTop = Math.min(h - steelT, openingBottom + openingH);
  const sideW = Math.max(steelT, (w - openingW) / 2);
  const frontZ = d / 2 - steelT / 2;
  const addFrontPiece = (pw, ph, px, py) => {
    const piece = plate(pw, ph, steelT, steel);
    piece.position.set(px, py, 0);
    frontPanel.add(piece);
  };
  addFrontPiece(sideW, h, -w / 2 + sideW / 2, h / 2);
  addFrontPiece(sideW, h, w / 2 - sideW / 2, h / 2);
  addFrontPiece(openingW, openingBottom, 0, openingBottom / 2);
  addFrontPiece(openingW, h - openingTop, 0, openingTop + (h - openingTop) / 2);
  frontPanel.position.z = frontZ;
  shell.add(frontPanel);
  const seal = new THREE.Group(); seal.name = 'doorSeal';
  const sealT = 0.8, sealW = 1.2;
  const sealOuterW = openingW + sealW * 2, sealOuterH = openingH + sealW * 2;
  const addSeal = (pw, ph, px, py) => { const piece = plate(pw, ph, sealT, gasketM); piece.position.set(px, py, d / 2 + steelT * 0.5); seal.add(piece); };
  addSeal(sealW, sealOuterH, -openingW / 2 - sealW / 2, openingBottom + openingH / 2);
  addSeal(sealW, sealOuterH, openingW / 2 + sealW / 2, openingBottom + openingH / 2);
  addSeal(openingW, sealW, 0, openingBottom - sealW / 2);
  addSeal(openingW, sealW, 0, openingTop + sealW / 2);
  shell.add(seal);

  // верх з вирізом під димохід: 4 планки навколо коміра (щільне з'єднання, без z-fight)
  const chimR = cfg.chimney.diameterCm / 2;
  const chimZ = -d * 0.2;
  const collarR = chimR * 1.08;
  const topY = h - steelT / 2;
  const mkTop = (pw, pd, px, pz) => { const p = plate(pw, steelT, pd, steel); p.position.set(px, topY, pz); shell.add(p); };
  mkTop(w, (d / 2 - chimZ) - collarR - steelT, 0, d / 2 - ((d / 2 - chimZ) - collarR - steelT) / 2 - steelT / 2); // передня смуга — фактично над дверцятами
  mkTop(w, Math.max(1, (chimZ + d / 2) - collarR), 0, -d / 2 + Math.max(1, (chimZ + d / 2) - collarR) / 2); // задня смуга
  const midDepth = Math.max(1, collarR * 2);
  const midZ = chimZ;
  mkTop(Math.max(1, w / 2 - collarR), midDepth, -(collarR + (w / 2 - collarR) / 2), midZ); // ліва
  mkTop(Math.max(1, w / 2 - collarR), midDepth, +(collarR + (w / 2 - collarR) / 2), midZ); // права
  // Круглий фланець + кутові заглушки: ховають квадратний отвір під круглу трубу.
  const topFlange = new THREE.Mesh(new THREE.CylinderGeometry(collarR * 1.02, collarR * 1.02, steelT * 1.6, 28), darkM);
  topFlange.position.set(0, topY, chimZ); topFlange.name = 'topFlange'; shell.add(topFlange);
  const cornerSize = collarR * 0.34;
  for (const [cx, cz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const fill = plate(cornerSize, steelT, cornerSize, darkM);
    fill.position.set(cx * (collarR - cornerSize * 0.5), topY, chimZ + cz * (collarR - cornerSize * 0.5));
    shell.add(fill);
  }

  // Бафль перекриває всю топку до реального переднього проходу для газів.
  // Front gap працює вздовж Z, а не зменшує ширину пластини.
  const innerW = Math.max(10, w - steelT * 2);
  const innerD = Math.max(10, d - steelT * 2);
  const baffleGap = Math.min(cfg.baffle.frontGapCm, innerD * 0.45);
  const baffleDepth = Math.max(8, innerD - baffleGap);
  const baffleY = Math.max(steelT * 4, Math.min(h - steelT * 2, cfg.baffle.heightCm));
  // Два однакові уголки на боках — на них вставляються дефлектори (як у відео).
  const angleLen = clamp(innerD * 0.5, 6, 24);
  const angleLipH = clamp(baffleY * 0.05, 2.5, 5);
  const angleZ = -baffleGap / 2;
  const baffleAngles = new THREE.Group(); baffleAngles.name = 'baffleAngles';
  for (const s of [-1, 1]) {
    const ax = s * (innerW / 2 - steelT / 2);
    const shelf = plate(steelT, steelT, angleLen, darkM);
    shelf.position.set(ax, baffleY - steelT / 2, angleZ); baffleAngles.add(shelf);
    const lip = plate(steelT, angleLipH, angleLen, darkM);
    lip.position.set(ax, baffleY + angleLipH / 2 - steelT, angleZ); baffleAngles.add(lip);
  }
  shell.add(baffleAngles);
  // Основний дефлектор лежить на уголках (знімний), кут — углиб.
  const baffle = plate(innerW, steelT, baffleDepth, darkM);
  baffle.position.set(0, baffleY, angleZ);
  baffle.rotation.x = THREE.MathUtils.degToRad(cfg.baffle.angleDeg);
  baffle.name = 'bafflePlate'; shell.add(baffle);
  // Передній дефлектор над переднім проходом — другий прохід газів.
  const frontDefDepth = clamp(innerD * 0.22, 5, 14);
  const frontDeflector = plate(innerW, steelT, frontDefDepth, darkM);
  frontDeflector.position.set(0, baffleY + steelT * 2.4, d / 2 - baffleGap - frontDefDepth / 2);
  frontDeflector.name = 'frontDeflector'; shell.add(frontDeflector);
  // Бафль фіксований; внутрішня регулювальна пластина без видимої ручки на фасаді.
  const regTravel = Math.max(6, w * 0.16);
  const baffleReg = plate(Math.max(10, w * 0.28), 1.0, 1.6, darkM);
  baffleReg.position.set(-regTravel / 2 + regTravel * (cfg.baffle.airflowPct / 100), baffleY - 2.4, d * 0.16);
  baffleReg.name = 'baffleReg'; shell.add(baffleReg);

  const airSystems = new THREE.Group(); airSystems.name = 'airSystems';

  // ---- PRIMARY: два овальні отвори в передній плиті ПІД дверцятами + ковзна заслінка (синя) ----
  const primaryY = clamp(openingBottom * 0.45, steelT * 3, 20);
  const ovalW = clamp(openingW * 0.26, 4, 12);
  const ovalH = clamp(primaryY * 0.5, 1.6, 3.0);
  const ovalX = openingW * 0.2;
  for (const ox of [-ovalX, ovalX]) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, steelT * 1.8, 16), holeM);
    hole.scale.set(ovalW / 2, ovalH / 2, 1);
    hole.rotation.x = Math.PI / 2;
    hole.position.set(ox, primaryY, d / 2 + steelT * 0.15);
    airSystems.add(hole);
  }
  const gateW = ovalX + ovalW * 0.7;
  const shutter = plate(gateW, ovalH * 2.6, steelT * 0.7, ductM);
  shutter.position.set(-gateW * 0.5 + gateW * (cfg.primaryAir.openPct / 100), primaryY, d / 2 + steelT * 0.8);
  shutter.name = 'primaryShutter'; airSystems.add(shutter);
  const primaryRod = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 3, 10), ductM);
  primaryRod.rotation.x = Math.PI / 2;
  primaryRod.position.set(shutter.position.x, primaryY, d / 2 + steelT * 1.6);
  airSystems.add(primaryRod);
  const primaryHandle = new THREE.Mesh(new THREE.SphereGeometry(clamp(h * 0.028, 0.9, 1.6), 14, 14), primaryAirM);
  primaryHandle.position.set(shutter.position.x, primaryY, d / 2 + steelT * 2.5);
  primaryHandle.name = 'primaryHandle'; airSystems.add(primaryHandle);

  // ---- SECONDARY: два задні підігрівальні стояки + поперечна SS-труба з отворами Ø3 мм під бафлем ----
  const secondary = new THREE.Group(); secondary.name = 'secondaryAirPreheat';
  const secTubeY = Math.max(18, baffleY - clamp(baffleY * 0.12, 3, 6));
  const secTubeZ = -innerD * 0.08;
  const riserH = Math.max(10, Math.min(cfg.secondaryAir.preheatLengthCm, secTubeY - 8));
  const riserZ = -innerD / 2 + cfg.secondaryAir.channelDepthCm / 2;
  const riserX = Math.max(2, innerW / 2 - cfg.secondaryAir.channelWidthCm / 2 - 1);
  for (const x of [-riserX, riserX]) {
    const riser = plate(cfg.secondaryAir.channelWidthCm, riserH, cfg.secondaryAir.channelDepthCm, ductM);
    riser.position.set(x, 8 + riserH / 2, riserZ); secondary.add(riser);
    const stubH = Math.max(2, secTubeZ === riserZ ? 2 : secTubeY - (8 + riserH));
    const stub = plate(cfg.secondaryAir.channelWidthCm * 0.8, stubH, cfg.secondaryAir.channelDepthCm * 0.8, ductM);
    stub.position.set(x, 8 + riserH + stubH / 2, riserZ + (secTubeZ - riserZ) * 0.4);
    secondary.add(stub);
  }
  const tubeLen = clamp(innerW * 0.9, 16, 120);
  const tubeR = clamp(cfg.secondaryAir.channelWidthCm * 0.14, 0.8, 1.5);
  const secTube = new THREE.Mesh(new THREE.CylinderGeometry(tubeR, tubeR, tubeLen, 16), secondaryAirM);
  secTube.rotation.z = Math.PI / 2;
  secTube.position.set(0, secTubeY, secTubeZ); secTube.name = 'secondaryTube'; secondary.add(secTube);
  const holeCount = clamp(Math.round(cfg.secondaryAir.holeCount), 8, 40);
  const holeDia = Math.max(0.3, cfg.secondaryAir.holeDiameterCm);
  const hStep = tubeLen / holeCount;
  const hx0 = -((holeCount - 1) * hStep) / 2;
  for (let i = 0; i < holeCount; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(holeDia / 2, holeDia / 2, tubeR * 3, 8), holeM);
    p.position.set(hx0 + i * hStep, secTubeY - tubeR * 0.6, secTubeZ);
    secondary.add(p);
  }
  airSystems.add(secondary);

  // ---- AIR-WASH: кожух над дверцятами + флоп-заслінка + щілина на всю ширину; бокова ручка ----
  const airWash = new THREE.Group(); airWash.name = 'airWashChannel';
  const slitW = Math.max(10, openingW * (cfg.airWash.slotWidthPct / 100));
  const slitY = Math.min(h - steelT * 2 - 3, openingTop + 0.6);
  const shroudH = clamp(cfg.airWash.gapCm * 4, 5, 12);
  const shroudDepth = clamp(innerD * 0.12, 3, 7);
  // кожух: верх + перед + боки (формує короб, відкритий знизу)
  const shroudTop = plate(slitW + 3, steelT, shroudDepth, darkM);
  shroudTop.position.set(0, slitY + shroudH, d / 2 - shroudDepth / 2); airWash.add(shroudTop);
  const shroudFront = plate(slitW + 3, shroudH, steelT, darkM);
  shroudFront.position.set(0, slitY + shroudH / 2, d / 2 - 0.3); airWash.add(shroudFront);
  for (const s of [-1, 1]) {
    const side = plate(steelT, shroudH, shroudDepth, darkM);
    side.position.set(s * (slitW + 3) / 2, slitY + shroudH / 2, d / 2 - shroudDepth / 2); airWash.add(side);
  }
  // флоп усередині кожуха (регулює подачу повітря в щілину)
  const flapOpen = clamp(cfg.airWash.intakePct / 100, 0.08, 1);
  const flap = plate(slitW, shroudH * 0.85, steelT * 0.5, airWashM);
  flap.rotation.x = -(Math.PI / 2) * (1 - flapOpen);
  flap.position.set(0, slitY + shroudH * 0.5, d / 2 - shroudDepth + 1.0);
  flap.name = 'airWashFlap'; airWash.add(flap);
  // щілина під кожухом (вихід повітря вниз по склу)
  const slit = plate(slitW, Math.max(0.5, cfg.airWash.gapCm), 0.7, holeM);
  slit.position.set(0, slitY, d / 2 + 0.05); airWash.add(slit);
  // бокова ручка air-wash (права стінка біля переду) + тяга до флопа
  const awRod = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 3.2, 10), ductM);
  awRod.rotation.z = Math.PI / 2;
  awRod.position.set(w / 2 + 1.2, slitY + shroudH / 2, d / 2 - 3); airWash.add(awRod);
  const awLever = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 0.7), airWashM);
  awLever.position.set(w / 2 + 2.6, slitY + shroudH / 2 - 1.2, d / 2 - 3); awLever.name = 'airWashHandle'; airWash.add(awLever);
  const awKnob = new THREE.Mesh(new THREE.SphereGeometry(clamp(h * 0.02, 0.7, 1.2), 12, 12), airWashM);
  awKnob.position.set(w / 2 + 2.6, slitY + shroudH / 2 - 2.6, d / 2 - 3); airWash.add(awKnob);
  airSystems.add(airWash);
  shell.add(airSystems);

  // Реальні конструктивні газові канали (частина корпусу, потрапляють у STL):
  // димова полиця, бокові направляючі верхнього ходу, задня перепускна стінка
  // і люк чистки на задній панелі.
  const gasChannels = new THREE.Group(); gasChannels.name = 'gasChannels';
  const hoodY = Math.min(h - steelT * 2, Math.max(baffleY + steelT * 6, h * 0.82));
  const hoodDepth = Math.max(8, (d / 2 - steelT) - (chimZ + collarR) - 1.5);
  const smokeHood = plate(innerW, steelT, hoodDepth, darkM);
  smokeHood.position.set(0, hoodY, d / 2 - hoodDepth / 2 - steelT);
  smokeHood.name = 'smokeHood'; gasChannels.add(smokeHood);
  for (const gx of [-innerW / 2 + steelT, innerW / 2 - steelT]) {
    const guide = plate(steelT, Math.max(6, hoodY - baffleY - steelT), hoodDepth, darkM);
    guide.position.set(gx, baffleY + (hoodY - baffleY) / 2, d / 2 - hoodDepth / 2 - steelT);
    gasChannels.add(guide);
  }
  const rearHgt = Math.max(6, (hoodY - baffleY) * 0.55);
  const rearBaffleWall = plate(innerW, rearHgt, steelT, darkM);
  rearBaffleWall.position.set(0, hoodY - rearHgt / 2, chimZ + collarR + steelT);
  gasChannels.add(rearBaffleWall);
  const cleanY = Math.max(28, baffleY - 8);
  const cleanPort = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 3.4, 1.6, 20), holeM);
  cleanPort.rotation.x = Math.PI / 2; cleanPort.position.set(0, cleanY, -d / 2 - 0.3);
  gasChannels.add(cleanPort);
  const cleanPortCap = new THREE.Mesh(new THREE.CylinderGeometry(4.1, 4.1, 0.9, 20), darkM);
  cleanPortCap.rotation.x = Math.PI / 2; cleanPortCap.position.set(0, cleanY, -d / 2 - 1.5);
  gasChannels.add(cleanPortCap);
  shell.add(gasChannels);

  // Схема потоків: стрілки напрямку + шляхи для анімації повітря (аеродинаміка).
  const flow = new THREE.Group(); flow.name = 'flowVisualization';
  const flowArrows = [];
  const addFlow = (origin, direction, length, color) => {
    const arrow = new THREE.ArrowHelper(direction.normalize(), origin, length, color, Math.min(3, length * 0.2), Math.min(1.2, length * 0.08));
    arrow.line.material.transparent = true; arrow.cone.material.transparent = true;
    arrow.line.material.opacity = 0.85; arrow.cone.material.opacity = 0.95;
    arrow.line.userData.ownedMaterial = true; arrow.cone.userData.ownedMaterial = true;
    flow.add(arrow); flowArrows.push(arrow);
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // PRIMARY (синій): отвори під дверцятами → вгору в топку
  addFlow(V(0, primaryY, d / 2 + 4), V(0, 0, -1), Math.max(6, d * 0.2), 0x4f8cff);
  addFlow(V(0, primaryY + 1, d * 0.1), V(0, 1, 0), Math.max(6, baffleY * 0.35), 0x4f8cff);
  // SECONDARY (зелений): стояки вгору → поперечна труба → отвори вниз
  addFlow(V(-riserX, 9, riserZ), V(0, 1, 0), Math.max(8, riserH * 0.8), 0x22c55e);
  addFlow(V(riserX, 9, riserZ), V(0, 1, 0), Math.max(8, riserH * 0.8), 0x22c55e);
  addFlow(V(-tubeLen * 0.4, secTubeY + tubeR, secTubeZ), V(1, 0, 0), tubeLen * 0.8, 0x22c55e);
  addFlow(V(0, secTubeY - tubeR, secTubeZ), V(0, -1, 0), Math.max(4, (secTubeY - primaryY) * 0.3), 0xf97316);
  // AIR-WASH (блакитний): щілина → вниз по склу → під дрова
  addFlow(V(0, slitY - 2, d / 2 + 3), V(0, -1, 0), Math.max(10, doorHc * 0.7), 0x38bdf8);
  addFlow(V(0, primaryY + 2, d / 2 + 1), V(0, 0, -1), Math.max(8, d * 0.3), 0x38bdf8);
  // ГАРЯЧІ ГАЗИ: вгору над бафлем → назад → в димохід
  addFlow(V(0, baffleY - 8, 0), V(0, 1, 0), Math.max(8, baffleY - 8), 0xef4444);
  addFlow(V(0, baffleY + 4, d / 2 - baffleGap * 0.4), V(0, 0, -1), Math.max(10, d * 0.42), 0xef7d32);
  addFlow(V(0, baffleY + 5, chimZ), V(0, 1, 0), Math.max(10, h - baffleY - 8), 0xef4444);
  flow.visible = cfg.flow.visible; shell.add(flow);

  // Шляхи для анімації повітря (аеродинаміка). Кожен — полілінія точок.
  const flowPaths = [
    { color: 0x4f8cff, pts: [V(0, primaryY, d / 2 + 5), V(0, primaryY, d * 0.1), V(0, (primaryY + baffleY) / 2, d * 0.05)] },
    { color: 0x38bdf8, pts: [V(0, slitY + 2, d / 2 - 1), V(0, slitY, d / 2 + 0.5), V(0, primaryY + 2, d / 2 + 1), V(0, primaryY + 3, d * 0.15)] },
    { color: 0x22c55e, pts: [V(-riserX, 9, riserZ), V(-riserX, secTubeY - 1, riserZ), V(0, secTubeY, secTubeZ), V(0, secTubeY - 3, secTubeZ)] },
    { color: 0x22c55e, pts: [V(riserX, 9, riserZ), V(riserX, secTubeY - 1, riserZ), V(0, secTubeY, secTubeZ), V(0, secTubeY - 3, secTubeZ)] },
    { color: 0xef7d32, pts: [V(0, baffleY - 6, d / 2 - baffleGap * 0.5), V(0, baffleY + 4, d / 2 - baffleGap * 0.5), V(0, baffleY + 5, chimZ), V(0, h + 8, chimZ)] },
  ];
  const aeroParticles = [];
  const aeroMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
  for (const path of flowPaths) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), aeroMat.clone());
    dot.material.color.setHex(path.color);
    dot.visible = false; dot.userData = { path, t: Math.random() };
    shell.add(dot); aeroParticles.push(dot);
  }

  // камера + полум'я
  const chamber = new THREE.Group(); chamber.name = 'innerChamber';
  const chamberBox = new THREE.Mesh(new THREE.BoxGeometry(Math.max(10, w - steelT * 2), Math.max(10, h - steelT * 2), Math.max(10, d - steelT * 2)),
    new THREE.MeshStandardMaterial({ color: 0x222222, transparent: true, opacity: 0.07, roughness: 1, depthWrite: false }));
  chamberBox.position.set(0, h / 2, 0); chamber.add(chamberBox);
  const flame = new THREE.Group(); flame.name = 'flameGroup'; flame.position.set(0, steelT + 6, d * 0.05);
  const core = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 20),
    new THREE.MeshStandardMaterial({ color: cfg.colors.flameCore, emissive: 0xff5a26, emissiveIntensity: 0.7, transparent: true, opacity: 0.55 }));
  core.position.y = 0;
  const outer = new THREE.Mesh(new THREE.SphereGeometry(6.6, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0xff5a26, emissive: 0xff3a12, emissiveIntensity: 0.45, transparent: true, opacity: 0.28 }));
  outer.position.y = 1.4;
  flame.add(core, outer);
  const sparks = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xffc87a, emissive: 0xff7a2b, transparent: true, opacity: 0.35 }));
    s.position.set((i - 2.5) * 1.1, i * 0.8, (i % 2 ? -1 : 1) * 1.1); sparks.push(s); flame.add(s);
  }
  chamber.add(flame); shell.add(chamber);

  // Ізоляція між сталлю та шамотом + refractory roof над бафлем.
  const firebrick = new THREE.Group(); firebrick.name = 'firebrickLining';
  const cw = Math.max(10, w - steelT * 2), ch2 = Math.max(10, h - steelT * 2), cd = Math.max(10, d - steelT * 2);
  const linerInnerD = Math.max(10, cd - insulationT * 2);
  const linerInnerW = Math.max(10, cw - insulationT * 2);
  // Футерування піднімається лише до бафля — вище починається зона допалювання.
  const linerTopY = Math.max(steelT + insulationT + brickT + 8, Math.min(ch2 - insulationT, baffleY - steelT));
  const brickHeight = Math.max(10, linerTopY - steelT - insulationT - brickT);
  const insHeight = Math.max(12, linerTopY - steelT);
  const brickBottomY = steelT + insulationT + brickT + brickHeight / 2;
  const bBottom = plate(linerInnerW, brickT, linerInnerD, brickM); bBottom.position.set(0, steelT + insulationT + brickT / 2, 0); firebrick.add(bBottom);
  // Передній бортик на дні (щоб паливо/зола не висипались), як у відео.
  const bLip = plate(linerInnerW, brickT, brickT, brickM);
  bLip.position.set(0, steelT + insulationT + brickT + brickT / 2, linerInnerD / 2 - brickT / 2);
  bLip.name = 'firebrickLip'; firebrick.add(bLip);
  const bL = plate(brickT, brickHeight, linerInnerD, brickM); bL.position.set(-cw / 2 + insulationT + brickT / 2, brickBottomY, 0); firebrick.add(bL);
  const bR = plate(brickT, brickHeight, linerInnerD, brickM); bR.position.set(cw / 2 - insulationT - brickT / 2, brickBottomY, 0); firebrick.add(bR);
  const bB = plate(linerInnerW, brickHeight, brickT, brickM); bB.position.set(0, brickBottomY, -cd / 2 + insulationT + brickT / 2); firebrick.add(bB);
  if (insulationT > 0) {
    const iBottom = plate(cw, insulationT, cd, thermalM); iBottom.position.set(0, steelT + insulationT / 2, 0); firebrick.add(iBottom);
    const iL = plate(insulationT, insHeight, cd, thermalM); iL.position.set(-cw / 2 + insulationT / 2, steelT + insHeight / 2, 0); firebrick.add(iL);
    const iR = plate(insulationT, insHeight, cd, thermalM); iR.position.set(cw / 2 - insulationT / 2, steelT + insHeight / 2, 0); firebrick.add(iR);
    const iB = plate(cw, insHeight, insulationT, thermalM); iB.position.set(0, steelT + insHeight / 2, -cd / 2 + insulationT / 2); firebrick.add(iB);
  }
  let refractoryRoof = null;
  if (refractoryT > 0) {
    refractoryRoof = plate(innerW, refractoryT, baffleDepth, thermalM);
    refractoryRoof.position.set(0, baffleY + steelT / 2 + refractoryT / 2, -baffleGap / 2);
    refractoryRoof.rotation.x = THREE.MathUtils.degToRad(cfg.baffle.angleDeg);
    refractoryRoof.name = 'refractoryRoof'; firebrick.add(refractoryRoof);
  }
  shell.add(firebrick);

  // Теплові екрани — опційні (безпека/розподіл тепла, не ККД).
  let heatShield = null;
  if (cfg.visibility && cfg.visibility.shields) {
    heatShield = new THREE.Group(); heatShield.name = 'heatShield';
    const shieldOff = 3.2;
    const shieldH = Math.min(h - 4, h * 0.78);
    const shieldY = 2 + shieldH / 2;
    const backShield = plate(w - 4, shieldH, 0.3, darkM);
    backShield.position.set(0, shieldY, -d / 2 - shieldOff);
    heatShield.add(backShield);
    for (const sx of [-1, 1]) {
      const sideShield = plate(0.3, shieldH, d - 4, darkM);
      sideShield.position.set(sx * (w / 2 + shieldOff), shieldY, 0);
      heatShield.add(sideShield);
    }
    for (const [px, pz] of [[-w / 4, -d / 2], [w / 4, -d / 2], [-w / 2, -d / 4], [-w / 2, d / 4], [w / 2, -d / 4], [w / 2, d / 4]]) {
      const isSide = Math.abs(px) > w / 3;
      const standoff = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, shieldOff, 10), darkM);
      if (isSide) standoff.rotation.z = Math.PI / 2;
      else standoff.rotation.x = Math.PI / 2;
      standoff.position.set(px + (isSide ? Math.sign(px) * shieldOff / 2 : 0), 6, pz + (isSide ? 0 : -shieldOff / 2));
      heatShield.add(standoff);
    }
    shell.add(heatShield);
  }

  // дверцята: рама з 4 планок + скло + ручка, pivot зліва
  const frameT = cfg.door.frameThicknessCm;
  const hingeSign = cfg.door.hingeSide === 'right' ? 1 : -1;
  const doorPivot = new THREE.Group(); doorPivot.name = 'doorPivot';
  doorPivot.position.set(hingeSign * doorWc / 2, h * 0.48, d / 2 + frameT / 2 + 0.05);
  const leaf = new THREE.Group(); leaf.position.set(-hingeSign * doorWc / 2, 0, 0);
  const fh = (bw, bh, x, y) => { const m = plate(bw, bh, frameT, darkM); m.position.set(x, y, 0); leaf.add(m); };
  fh(doorWc, frameT, 0, doorHc / 2 - frameT / 2); fh(doorWc, frameT, 0, -doorHc / 2 + frameT / 2);
  fh(frameT, doorHc - frameT * 2, -doorWc / 2 + frameT / 2, 0); fh(frameT, doorHc - frameT * 2, doorWc / 2 - frameT / 2, 0);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, doorWc - cfg.door.glassInsetCm * 2), Math.max(1, doorHc - cfg.door.glassInsetCm * 2), 0.7), glassM);
  glass.position.z = frameT / 2 + 0.3; leaf.add(glass);
  const handleMat = handleM;
  // Пружинна ручка-спіраль: вал + витки + наконечник.
  const springHandle = new THREE.Group(); springHandle.name = 'springHandle';
  const shaftLen = Math.max(9, doorWc * 0.34);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, shaftLen, 14), handleMat);
  shaft.rotation.z = Math.PI / 2; springHandle.add(shaft);
  const coilLoops = 5;
  for (let i = 0; i < coilLoops; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.3, 8, 16), handleMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = shaftLen / 2 - 0.7 - i * (shaftLen * 0.11);
    springHandle.add(ring);
  }
  const knob = new THREE.Mesh(new THREE.SphereGeometry(1.15, 14, 14), handleMat);
  knob.position.x = shaftLen / 2 + 0.5; springHandle.add(knob);
  // Ручка кріпиться до вільної вертикальної планки рамки (не «на склі»).
  const freeEdgeX = -hingeSign * (doorWc / 2 - frameT / 2);
  const handleMount = plate(frameT + 0.4, frameT + 1.6, 1.0, darkM);
  handleMount.position.set(freeEdgeX, 0, frameT / 2 + 0.5); leaf.add(handleMount);
  springHandle.position.set(freeEdgeX, 0, frameT / 2 + 0.95);
  leaf.add(springHandle);
  // Засувка: планка + кронштейн + ролик біля фасаду.
  const latchX = -hingeSign * (doorWc / 2 - 1.4);
  const latchBar = new THREE.Mesh(new THREE.BoxGeometry(0.9, Math.min(7, doorHc * 0.22), 0.9), darkM);
  latchBar.position.set(latchX, 0, frameT / 2 + 0.3); leaf.add(latchBar);
  const latchBracket = plate(1.4, Math.min(7, doorHc * 0.22), 0.6, darkM);
  latchBracket.position.set(latchX, 0, frameT / 2 + 0.7); leaf.add(latchBracket);
  const latchRoller = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 5.2, 12), handleMat);
  latchRoller.rotation.x = Math.PI / 2; latchRoller.position.set(latchX, 0, frameT / 2 + 1.0); leaf.add(latchRoller);
  doorPivot.add(leaf); shell.add(doorPivot);
  const catchPlate = plate(1.6, Math.min(9, doorHc * 0.3), 1.6, darkM);
  catchPlate.position.set(-hingeSign * (openingW / 2 - 0.9), openingBottom + openingH / 2, d / 2 + steelT * 0.5 + frameT * 0.6);
  catchPlate.name = 'doorCatch'; shell.add(catchPlate);
  for (const y of [-doorHc * 0.32, doorHc * 0.32]) {
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 6, 16), darkM);
    hinge.position.set(hingeSign * doorWc / 2, h * 0.48 + y, d / 2 + frameT + 0.4);
    hinge.name = 'doorHinge'; shell.add(hinge);
  }

  // димохід + комір (щільна посадка)
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(chimR, chimR, cfg.chimney.heightCm, 32), steel);
  const chimneyBaseY = h - steelT / 2;
  chimney.position.set(0, chimneyBaseY + cfg.chimney.heightCm / 2, chimZ); chimney.castShadow = true; shell.add(chimney);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(collarR, collarR * 1.06, steelT * 2.2, 28), darkM);
  collar.position.set(0, h + steelT * 0.35, chimZ); shell.add(collar);
  // Внутрішня димова труба від зони над бафлем до кришки: закриває комірний
  // отвір, щоб крізь нього не було видно внутрішніх шарів.
  const flueBellBottom = Math.min(h - steelT * 2, Math.max(baffleY + steelT * 4, h * 0.55));
  const flueBellH = Math.max(6, (h - steelT) - flueBellBottom);
  const flueBell = new THREE.Mesh(new THREE.CylinderGeometry(chimR * 1.06, chimR * 1.06, flueBellH, 28), ductM);
  flueBell.position.set(0, flueBellBottom + flueBellH / 2, chimZ);
  flueBell.name = 'flueBell'; gasChannels.add(flueBell);
  const flueBellBase = new THREE.Mesh(new THREE.CylinderGeometry(chimR * 1.3, chimR * 1.16, 2.2, 28), darkM);
  flueBellBase.position.set(0, flueBellBottom - 0.4, chimZ);
  gasChannels.add(flueBellBase);

  // ніжки
  if (legH > 0) {
    const legG = plate(5, legH, 5, darkM);
    for (const [lx, lz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const leg = legG.clone(); leg.position.set(lx * (w / 2 - 6), legH / 2, lz * (d / 2 - 6)); group.add(leg);
    }
  }

  // Теплові зони — окремий напівпрозорий шар; колір задає Physics v4 з app.js.
  const thermalZones = new THREE.Group(); thermalZones.name = 'thermalZones';
  const zoneMat = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const zoneFirebox = new THREE.Mesh(new THREE.BoxGeometry(Math.max(10, innerW * 0.9), Math.max(8, baffleY - steelT * 2), Math.max(10, innerD * 0.85)), zoneMat());
  zoneFirebox.position.set(0, steelT + (baffleY - steelT) / 2, 0);
  zoneFirebox.name = 'zoneFirebox'; thermalZones.add(zoneFirebox);
  const hoodTop = Math.min(h - steelT * 2, Math.max(baffleY + steelT * 6, h * 0.82));
  const zoneAfterburn = new THREE.Mesh(new THREE.BoxGeometry(Math.max(10, innerW * 0.9), Math.max(6, hoodTop - baffleY), Math.max(10, innerD * 0.8)), zoneMat());
  zoneAfterburn.position.set(0, baffleY + (hoodTop - baffleY) / 2, -baffleGap * 0.2);
  zoneAfterburn.name = 'zoneAfterburn'; thermalZones.add(zoneAfterburn);
  const zoneChimney = new THREE.Mesh(new THREE.CylinderGeometry(chimR * 1.06, chimR * 1.06, cfg.chimney.heightCm, 20, 1, true), zoneMat());
  zoneChimney.position.set(0, h - steelT / 2 + cfg.chimney.heightCm / 2, chimZ);
  zoneChimney.name = 'zoneChimney'; thermalZones.add(zoneChimney);
  thermalZones.visible = false; shell.add(thermalZones);

  // Дим у димоході: частинки, анімуються в app.js.
  const smoke = new THREE.Group(); smoke.name = 'smoke';
  const smokeParticles = [];
  const smokeMat = mat(cache, 'smoke', () => new THREE.MeshBasicMaterial({ color: 0x9aa3b2, transparent: true, opacity: 0.22, depthWrite: false }));
  const smokeY0 = h - steelT / 2;
  const smokeY1 = h - steelT / 2 + cfg.chimney.heightCm;
  for (let i = 0; i < 12; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(1.5 + (i % 3) * 0.5, 8, 8), smokeMat);
    puff.userData.t = i / 12;
    puff.userData.x0 = ((i % 3) - 1) * chimR * 0.4;
    puff.userData.phase = i * 0.7;
    puff.userData.y0 = smokeY0; puff.userData.y1 = smokeY1;
    puff.position.set(puff.userData.x0, smokeY0, chimZ);
    smoke.add(puff); smokeParticles.push(puff);
  }
  smoke.visible = false; shell.add(smoke);

  group.add(shell);
  const refs = { shell, chimney, collar, doorPivot, frontPanel, firebrick, refractoryRoof, baffle, baffleAngles, frontDeflector, airSystems, gasChannels, chamber, flame, core, outer, sparks, shutter, flow, flowArrows, heatShield, thermalZones, zoneFirebox, zoneAfterburn, zoneChimney, smoke, smokeParticles, flowPaths, aeroParticles };
  for (const n of [chimney, collar, doorPivot, frontPanel, firebrick, baffle, airSystems, gasChannels, chamber, flow]) {
    if (n) n.userData.basePosition = n.position.clone();
  }
  return { group, refs };
}
