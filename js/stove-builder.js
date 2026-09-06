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
  const controlM = mat(cache, 'control', () => new THREE.MeshStandardMaterial({ color: 0xffb347, roughness: 0.35, metalness: 0.35 }));
  const primaryControlM = mat(cache, 'primary-control', () => new THREE.MeshStandardMaterial({ color: 0x4f8cff, roughness: 0.35, metalness: 0.35 }));
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

  // Бафль перекриває всю топку до реального переднього проходу для газів.
  // Front gap працює вздовж Z, а не зменшує ширину пластини.
  const innerW = Math.max(10, w - steelT * 2);
  const innerD = Math.max(10, d - steelT * 2);
  const baffleGap = Math.min(cfg.baffle.frontGapCm, innerD * 0.45);
  const baffleDepth = Math.max(8, innerD - baffleGap);
  const baffle = plate(innerW, steelT, baffleDepth, darkM);
  const baffleY = Math.max(steelT * 4, Math.min(h - steelT * 2, cfg.baffle.heightCm));
  baffle.position.set(0, baffleY, -baffleGap / 2);
  baffle.rotation.x = THREE.MathUtils.degToRad(cfg.baffle.angleDeg);
  baffle.name = 'bafflePlate'; shell.add(baffle);
  const regTravel = Math.max(8, w * 0.22);
  const baffleReg = plate(Math.max(12, w * 0.35), 1.2, 2, darkM);
  const baffleControlX = -regTravel / 2 + regTravel * (cfg.baffle.airflowPct / 100);
  baffleReg.position.set(baffleControlX, baffleY - 2.4, d * 0.16);
  shell.add(baffleReg);
  const baffleHandle = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 16), controlM);
  baffleHandle.position.set(baffleControlX, baffleY - 2.4, d / 2 + 1.8); baffleHandle.name = 'baffleHandle'; shell.add(baffleHandle);

  // Повітряні канали: primary знизу, secondary через два підігрівальні стояки,
  // air-wash через бокові канали у верхню суцільну щілину.
  const airSystems = new THREE.Group(); airSystems.name = 'airSystems';
  const panelW = Math.min(w - steelT * 3, cfg.primaryAir.holeCount * cfg.primaryAir.holeSpacingCm + 8);
  const panel = plate(panelW, 10, steelT, darkM); panel.position.set(0, 16, d / 2 - steelT * 0.5); airSystems.add(panel);
  const sx = -((cfg.primaryAir.holeCount - 1) * cfg.primaryAir.holeSpacingCm) / 2;
  for (let i = 0; i < cfg.primaryAir.holeCount; i++) {
    const hole = new THREE.Mesh(new THREE.CylinderGeometry(cfg.primaryAir.holeDiameterCm / 2, cfg.primaryAir.holeDiameterCm / 2, steelT * 1.8, 16), holeM);
    hole.rotation.x = Math.PI / 2; hole.position.set(sx + i * cfg.primaryAir.holeSpacingCm, 16, d / 2 + steelT * 0.2);
    airSystems.add(hole);
  }
  const shutter = plate(panelW + 2, 11.5, steelT * 0.8, ductM);
  const closedOff = -(panelW * 0.52);
  shutter.position.set(closedOff + (0 - closedOff) * (cfg.primaryAir.openPct / 100), 16, d / 2 + steelT * 0.9);
  shutter.name = 'primaryShutter'; airSystems.add(shutter);
  const primaryHandle = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.2, 16), primaryControlM);
  primaryHandle.rotation.x = Math.PI / 2; primaryHandle.position.set(shutter.position.x, 16, d / 2 + steelT * 2.4);
  primaryHandle.name = 'primaryHandle'; airSystems.add(primaryHandle);

  const secY = Math.min(h - steelT * 3, baffleY + 7);
  const secW = Math.max(12, Math.min(innerW - 2, cfg.secondaryAir.holeCount * cfg.secondaryAir.holeSpacingCm + 10));
  const secondary = new THREE.Group(); secondary.name = 'secondaryAirPreheat';
  const riserHeight = Math.max(12, Math.min(cfg.secondaryAir.preheatLengthCm, secY - 8));
  const riserZ = -innerD / 2 + cfg.secondaryAir.channelDepthCm / 2;
  const riserX = Math.max(2, innerW / 2 - cfg.secondaryAir.channelWidthCm / 2 - 1);
  for (const x of [-riserX, riserX]) {
    const riser = plate(cfg.secondaryAir.channelWidthCm, riserHeight, cfg.secondaryAir.channelDepthCm, ductM);
    riser.position.set(x, 8 + riserHeight / 2, riserZ); secondary.add(riser);
  }
  const secBody = plate(secW, cfg.secondaryAir.manifoldHeightCm, cfg.secondaryAir.channelDepthCm, ductM);
  secBody.position.set(0, secY, riserZ); secondary.add(secBody);
  const ssx = -((cfg.secondaryAir.holeCount - 1) * cfg.secondaryAir.holeSpacingCm) / 2;
  for (let i = 0; i < cfg.secondaryAir.holeCount; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(cfg.secondaryAir.holeDiameterCm / 2, cfg.secondaryAir.holeDiameterCm / 2, cfg.secondaryAir.manifoldHeightCm + 0.8, 12), holeM);
    p.position.set(ssx + i * cfg.secondaryAir.holeSpacingCm, secY - cfg.secondaryAir.manifoldHeightCm / 2, riserZ + cfg.secondaryAir.channelDepthCm * 0.1);
    secondary.add(p);
  }
  airSystems.add(secondary);

  const washW = Math.max(12, Math.min(w - steelT * 3, doorWc + 6));
  const washY = h * 0.48 + doorHc / 2 + 4.2;
  const airWash = new THREE.Group(); airWash.name = 'airWashChannel';
  const washChannelHeight = Math.max(12, Math.min(cfg.airWash.preheatLengthCm, washY - 8));
  const washX = Math.max(doorWc / 2 + cfg.airWash.channelWidthCm / 2, innerW / 2 - cfg.airWash.channelWidthCm / 2 - 1);
  const washZ = d / 2 - cfg.airWash.channelDepthCm / 2 - steelT;
  for (const x of [-washX, washX]) {
    const side = plate(cfg.airWash.channelWidthCm, washChannelHeight, cfg.airWash.channelDepthCm, ductM);
    side.position.set(x, 8 + washChannelHeight / 2, washZ); airWash.add(side);
  }
  const washBody = plate(washW, 3.2, cfg.airWash.channelDepthCm, ductM);
  washBody.position.set(0, washY, washZ); airWash.add(washBody);
  const slotWidth = Math.max(8, washW * cfg.airWash.slotWidthPct / 100);
  const slot = plate(slotWidth, Math.max(0.4, cfg.airWash.gapCm), 0.8, holeM);
  slot.position.set(0, washY - 1.8, d / 2 + 0.1); airWash.add(slot);
  const washReg = plate(Math.max(8, slotWidth - 6), 1.1, 1, darkM);
  const washTravel = Math.max(4, slotWidth * 0.28);
  washReg.position.set(-washTravel / 2 + washTravel * cfg.airWash.intakePct / 100, washY - 3.2, d / 2 + 1);
  airWash.add(washReg);
  const upperVent = plate(Math.max(12, washW * 0.62), 1.1, 0.9, darkM);
  upperVent.position.set(0, washY + 2.2, d / 2 + 0.55); airWash.add(upperVent);
  const upperVentHandle = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 12), controlM);
  upperVentHandle.position.set(washTravel / 2 - washTravel * cfg.airWash.intakePct / 100, washY + 2.2, d / 2 + 1.3); airWash.add(upperVentHandle);
  airSystems.add(airWash);
  shell.add(airSystems);

  // Схема потоків: окремий шар, який можна ввімкнути без зміни геометрії печі.
  const flow = new THREE.Group(); flow.name = 'flowVisualization';
  const flowArrows = [];
  const gasPath = new THREE.Group(); gasPath.name = 'realGasPath';
  const gasPathM = new THREE.MeshBasicMaterial({ color: 0xf97316, transparent: true, opacity: 0.16, depthWrite: false, wireframe: true });
  const pathWidth = Math.max(10, innerW * 0.78);
  const pathDepth = Math.max(10, innerD - baffleGap);
  const pathHeight = Math.max(8, h - baffleY - steelT * 3);
  for (const x of [-pathWidth / 2, pathWidth / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.8, pathHeight, pathDepth), gasPathM);
    wall.position.set(x, baffleY + pathHeight / 2 + steelT, -baffleGap / 2); gasPath.add(wall);
  }
  const pathTop = new THREE.Mesh(new THREE.BoxGeometry(pathWidth, 0.8, pathDepth), gasPathM);
  pathTop.position.set(0, h - steelT * 2, -baffleGap / 2); gasPath.add(pathTop);
  const rearRise = new THREE.Mesh(new THREE.BoxGeometry(pathWidth * 0.7, pathHeight, 0.8), gasPathM);
  rearRise.position.set(0, baffleY + pathHeight / 2 + steelT, chimZ); gasPath.add(rearRise);
  flow.add(gasPath);
  const addFlow = (origin, direction, length, color) => {
    const arrow = new THREE.ArrowHelper(direction.normalize(), origin, length, color, Math.min(3, length * 0.2), Math.min(1.2, length * 0.08));
    arrow.line.material.transparent = true; arrow.cone.material.transparent = true;
    arrow.line.material.opacity = 0.78; arrow.cone.material.opacity = 0.9;
    arrow.line.userData.ownedMaterial = true; arrow.cone.userData.ownedMaterial = true;
    flow.add(arrow); flowArrows.push(arrow);
  };
  addFlow(new THREE.Vector3(0, 16, d / 2 + 5), new THREE.Vector3(0, 0, -1), Math.max(8, d * 0.28), 0x4f8cff);
  addFlow(new THREE.Vector3(-riserX, 10, riserZ), new THREE.Vector3(0, 1, 0), riserHeight * 0.75, 0x22c55e);
  addFlow(new THREE.Vector3(riserX, 10, riserZ), new THREE.Vector3(0, 1, 0), riserHeight * 0.75, 0x22c55e);
  addFlow(new THREE.Vector3(0, secY + 1, riserZ + 1), new THREE.Vector3(0, 0, 1), Math.max(8, innerD * 0.3), 0xffb347);
  addFlow(new THREE.Vector3(0, washY + 1, d / 2 + 3), new THREE.Vector3(0, -1, 0), Math.max(10, doorHc * 0.65), 0x38bdf8);
  addFlow(new THREE.Vector3(0, baffleY - 10, 0), new THREE.Vector3(0, 1, 0), Math.max(8, baffleY - 10), 0xef4444);
  addFlow(new THREE.Vector3(0, baffleY + 3, d / 2 - baffleGap * 0.35), new THREE.Vector3(0, 0, -1), Math.max(10, d * 0.46), 0xef7d32);
  addFlow(new THREE.Vector3(0, baffleY + 5, chimZ), new THREE.Vector3(0, 1, 0), Math.max(10, h - baffleY - 8), 0xef4444);
  flow.visible = cfg.flow.visible; shell.add(flow);

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
  const brickHeight = Math.max(10, ch2 - insulationT - brickT);
  const bBottom = plate(linerInnerW, brickT, linerInnerD, brickM); bBottom.position.set(0, steelT + insulationT + brickT / 2, 0); firebrick.add(bBottom);
  const bL = plate(brickT, brickHeight, linerInnerD, brickM); bL.position.set(-cw / 2 + insulationT + brickT / 2, steelT + insulationT + brickHeight / 2, 0); firebrick.add(bL);
  const bR = plate(brickT, brickHeight, linerInnerD, brickM); bR.position.set(cw / 2 - insulationT - brickT / 2, steelT + insulationT + brickHeight / 2, 0); firebrick.add(bR);
  const bB = plate(linerInnerW, brickHeight, brickT, brickM); bB.position.set(0, steelT + insulationT + brickHeight / 2, -cd / 2 + insulationT + brickT / 2); firebrick.add(bB);
  if (insulationT > 0) {
    const iBottom = plate(cw, insulationT, cd, thermalM); iBottom.position.set(0, steelT + insulationT / 2, 0); firebrick.add(iBottom);
    const iL = plate(insulationT, ch2 - insulationT, cd, thermalM); iL.position.set(-cw / 2 + insulationT / 2, steelT + (ch2 - insulationT) / 2, 0); firebrick.add(iL);
    const iR = plate(insulationT, ch2 - insulationT, cd, thermalM); iR.position.set(cw / 2 - insulationT / 2, steelT + (ch2 - insulationT) / 2, 0); firebrick.add(iR);
    const iB = plate(cw, ch2 - insulationT, insulationT, thermalM); iB.position.set(0, steelT + (ch2 - insulationT) / 2, -cd / 2 + insulationT / 2); firebrick.add(iB);
  }
  let refractoryRoof = null;
  if (refractoryT > 0) {
    refractoryRoof = plate(innerW, refractoryT, baffleDepth, thermalM);
    refractoryRoof.position.set(0, baffleY + steelT / 2 + refractoryT / 2, -baffleGap / 2);
    refractoryRoof.rotation.x = THREE.MathUtils.degToRad(cfg.baffle.angleDeg);
    refractoryRoof.name = 'refractoryRoof'; firebrick.add(refractoryRoof);
  }
  shell.add(firebrick);

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
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 12, 16), mat(cache, 'handle', () => new THREE.MeshStandardMaterial({ color: 0xd6d6d6, metalness: 0.85, roughness: 0.25 })));
  handle.rotation.z = Math.PI / 2; handle.position.set(-hingeSign * doorWc * 0.33, 0, frameT / 2 + 1.8); leaf.add(handle);
  doorPivot.add(leaf); shell.add(doorPivot);
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

  // ніжки
  if (legH > 0) {
    const legG = plate(5, legH, 5, darkM);
    for (const [lx, lz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const leg = legG.clone(); leg.position.set(lx * (w / 2 - 6), legH / 2, lz * (d / 2 - 6)); group.add(leg);
    }
  }

  group.add(shell);
  const refs = { shell, chimney, collar, doorPivot, frontPanel, firebrick, refractoryRoof, baffle, airSystems, chamber, flame, core, outer, sparks, shutter, flow, flowArrows };
  for (const n of [chimney, collar, doorPivot, frontPanel, firebrick, baffle, airSystems, chamber, flow]) {
    if (n) n.userData.basePosition = n.position.clone();
  }
  return { group, refs };
}
