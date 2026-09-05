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
    // матеріали кешовані — не dispose тут, кеш чиститься окремо
  });
}

export function buildStove(cfg, cache = new Map()) {
  const group = new THREE.Group();
  group.name = 'stove';

  const w = cfg.dimensions.widthCm, d = cfg.dimensions.depthCm;
  const h = cfg.dimensions.heightCm, legH = cfg.dimensions.legHeightCm;
  const steelT = Math.min(cfg.materials.steelThicknessMm / 10, w / 6, d / 6, h / 8);
  const brickT = Math.min(cfg.materials.firebrickThicknessCm, 12);

  const steel = mat(cache, `steel|${cfg.colors.steel}|${cfg.colors.steelRoughness}|${cfg.colors.steelMetalness}`,
    () => new THREE.MeshStandardMaterial({ color: cfg.colors.steel, roughness: cfg.colors.steelRoughness, metalness: cfg.colors.steelMetalness }));
  const brickM = mat(cache, `brick|${cfg.colors.brick}`,
    () => new THREE.MeshStandardMaterial({ color: cfg.colors.brick, roughness: 0.95, metalness: 0.04 }));
  const darkM = mat(cache, 'dark', () => new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.45, metalness: 0.6 }));
  const ductM = mat(cache, 'duct', () => new THREE.MeshStandardMaterial({ color: 0x616872, roughness: 0.4, metalness: 0.58 }));
  const holeM = mat(cache, 'hole', () => new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.95 }));
  const glassM = mat(cache, `glass|${cfg.colors.glass}`,
    () => new THREE.MeshStandardMaterial({ color: cfg.colors.glass, transparent: true, opacity: 0.42, roughness: 0.06, metalness: 0.15 }));

  const shell = new THREE.Group(); shell.name = 'shell'; shell.position.y = legH;

  // дно / боки / зад — перед відкритий під дверцята
  const bottom = plate(w, steelT, d, steel); bottom.position.y = steelT / 2; shell.add(bottom);
  const left = plate(steelT, h, d, steel); left.position.set(-w / 2 + steelT / 2, h / 2, 0); shell.add(left);
  const right = plate(steelT, h, d, steel); right.position.set(w / 2 - steelT / 2, h / 2, 0); shell.add(right);
  const back = plate(w, h, steelT, steel); back.position.set(0, h / 2, -d / 2 + steelT / 2); shell.add(back);

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

  // бафль + регулятор притоку
  const baffle = plate(Math.max(10, w - steelT * 2 - cfg.baffle.frontGapCm), steelT, Math.max(8, d * 0.72), darkM);
  const baffleY = Math.max(steelT * 4, Math.min(h - steelT * 2, cfg.baffle.heightCm));
  baffle.position.set(0, baffleY, -cfg.baffle.frontGapCm * 0.2);
  baffle.rotation.x = THREE.MathUtils.degToRad(cfg.baffle.angleDeg);
  baffle.name = 'bafflePlate'; shell.add(baffle);
  const regTravel = Math.max(8, w * 0.22);
  const baffleReg = plate(Math.max(12, w * 0.35), 1.2, 2, darkM);
  baffleReg.position.set(-regTravel / 2 + regTravel * (cfg.baffle.airflowPct / 100), baffleY - 2.4, d * 0.16);
  shell.add(baffleReg);

  // повітряні канали
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

  const secY = Math.min(h - steelT * 3, baffleY + 7);
  const secW = Math.max(12, Math.min(w - steelT * 3, cfg.secondaryAir.holeCount * cfg.secondaryAir.holeSpacingCm + 10));
  const secBody = plate(secW, 4, 6, ductM); secBody.position.set(0, secY, 0); airSystems.add(secBody);
  const ssx = -((cfg.secondaryAir.holeCount - 1) * cfg.secondaryAir.holeSpacingCm) / 2;
  for (let i = 0; i < cfg.secondaryAir.holeCount; i++) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(cfg.secondaryAir.holeDiameterCm / 2, cfg.secondaryAir.holeDiameterCm / 2, 6.8, 12), holeM);
    p.rotation.x = Math.PI / 2; p.position.set(ssx + i * cfg.secondaryAir.holeSpacingCm, secY - 0.5, 0);
    airSystems.add(p);
  }

  const doorWc = Math.max(20, Math.min(cfg.door.widthCm, w - steelT * 4));
  const doorHc = Math.max(20, Math.min(cfg.door.heightCm, h - steelT * 4));
  const washW = Math.max(12, Math.min(w - steelT * 3, doorWc + 6));
  const washY = h * 0.48 + doorHc / 2 + 4.2;
  const washBody = plate(washW, 3.2, 6, ductM); washBody.position.set(0, washY, d / 2 - 2.8); airSystems.add(washBody);
  const slot = plate(Math.max(8, washW - 2), Math.max(0.4, cfg.airWash.gapCm), 0.8, holeM);
  slot.position.set(0, washY - 1.8, d / 2 - 0.1); airSystems.add(slot);
  shell.add(airSystems);

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

  // шамот
  const firebrick = new THREE.Group(); firebrick.name = 'firebrickLining';
  const cw = Math.max(10, w - steelT * 2), ch2 = Math.max(10, h - steelT * 2), cd = Math.max(10, d - steelT * 2);
  const bBottom = plate(cw, brickT, cd, brickM); bBottom.position.set(0, steelT + brickT / 2, 0); firebrick.add(bBottom);
  const bL = plate(brickT, ch2 - brickT, cd, brickM); bL.position.set(-cw / 2 + brickT / 2, h / 2, 0); firebrick.add(bL);
  const bR = plate(brickT, ch2 - brickT, cd, brickM); bR.position.set(cw / 2 - brickT / 2, h / 2, 0); firebrick.add(bR);
  const bB = plate(cw, ch2 - brickT, brickT, brickM); bB.position.set(0, h / 2, -cd / 2 + brickT / 2); firebrick.add(bB);
  shell.add(firebrick);

  // дверцята: рама з 4 планок + скло + ручка, pivot зліва
  const frameT = cfg.door.frameThicknessCm;
  const doorPivot = new THREE.Group(); doorPivot.name = 'doorPivot';
  doorPivot.position.set(-doorWc / 2, h * 0.48, d / 2 + steelT * 0.5);
  const leaf = new THREE.Group(); leaf.position.set(doorWc / 2, 0, 0);
  const fh = (bw, bh, x, y) => { const m = plate(bw, bh, frameT, darkM); m.position.set(x, y, 0); leaf.add(m); };
  fh(doorWc, frameT, 0, doorHc / 2 - frameT / 2); fh(doorWc, frameT, 0, -doorHc / 2 + frameT / 2);
  fh(frameT, doorHc - frameT * 2, -doorWc / 2 + frameT / 2, 0); fh(frameT, doorHc - frameT * 2, doorWc / 2 - frameT / 2, 0);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.max(1, doorWc - cfg.door.glassInsetCm * 2), Math.max(1, doorHc - cfg.door.glassInsetCm * 2), 0.7), glassM);
  glass.position.z = frameT / 2 + 0.3; leaf.add(glass);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 12, 16), mat(cache, 'handle', () => new THREE.MeshStandardMaterial({ color: 0xd6d6d6, metalness: 0.85, roughness: 0.25 })));
  handle.rotation.z = Math.PI / 2; handle.position.set(doorWc * 0.33, 0, frameT / 2 + 1.8); leaf.add(handle);
  doorPivot.add(leaf); shell.add(doorPivot);

  // димохід + комір (щільна посадка)
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(chimR, chimR, cfg.chimney.heightCm, 32), steel);
  chimney.position.set(0, h + cfg.chimney.heightCm / 2 - steelT * 0.5, chimZ); chimney.castShadow = true; shell.add(chimney);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(collarR, collarR * 1.06, steelT * 2.2, 28), darkM);
  collar.position.set(0, h + steelT * 0.4, chimZ); shell.add(collar);

  // ніжки
  if (legH > 0) {
    const legG = plate(5, legH, 5, darkM);
    for (const [lx, lz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const leg = legG.clone(); leg.position.set(lx * (w / 2 - 6), legH / 2, lz * (d / 2 - 6)); group.add(leg);
    }
  }

  group.add(shell);
  const refs = { shell, chimney, collar, doorPivot, firebrick, baffle, airSystems, chamber, flame, core, outer, sparks, shutter };
  for (const n of [chimney, collar, doorPivot, firebrick, baffle, airSystems, chamber]) {
    if (n) n.userData.basePosition = n.position.clone();
  }
  return { group, refs };
}
