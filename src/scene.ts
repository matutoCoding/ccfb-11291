// 由机芯配置构建渲染场景
import type { GearSpec, MovementConfig } from './types';
import { computeTrain, pitchRadius, pinionRadius } from './train';
import {
  MeshData, extrudeRing, gearOutline, escapeOutline, circleOutline, capsuleOutline,
  cylinder, ring, hairspring, hand, domeDisc, mergeMeshes, transformMesh, flatShape,
} from './geometry';

export type PartKind = 'static' | 'gear' | 'balance' | 'hairspring' | 'pallet' | 'glass';

export interface Material {
  color: [number, number, number];
  metallic: number;
  roughness: number;
  anisotropy: number;
  finishMode: number; // 0抛光 1直线拉丝 2环形拉丝 3日内瓦纹 4珍珠纹 5蓝钢 6红宝石 7太阳纹
  alpha: number;
  size: number;   // 条纹宽/珍珠纹直径
  angle: number;  // 弧度
  chamfer: boolean;
}

export interface ScenePart {
  key: string;
  label: string;
  kind: PartKind;
  mesh: MeshData;
  material: Material;
  /** 世界摆放位置(齿轮轴心等) */
  pos: [number, number, number];
  /** kind=gear 时:轮系中的索引 */
  gearIndex?: number;
  /** 拾取用:包围圆柱半径 */
  pickRadius: number;
  transparent: boolean;
}

export interface BuiltScene {
  parts: ScenePart[];
  omegas: number[];        // 每个齿轮的 rev/s(带符号)
  vph: number;
  plateRadius: number;
  movement: MovementConfig;
}

const STEEL: [number, number, number] = [0.78, 0.79, 0.82];
const BRASS: [number, number, number] = [0.83, 0.66, 0.32];
const RHODIUM: [number, number, number] = [0.72, 0.74, 0.78];

function gearMesh(g: GearSpec): MeshData {
  const rTip = pitchRadius(g) + g.module * 0.9;
  const z0 = 0.15, z1 = 0.15 + Math.max(0.22, g.module * 1.6);
  const outline = g.type === 'escape' ? escapeOutline(g.module, g.teeth) : gearOutline(g.module, g.teeth);
  const pieces: MeshData[] = [];
  if (g.type === 'escape') {
    // 擒纵轮:整体薄片 + 轮毂
    pieces.push(extrudeRing(outline, null, z0, z0 + 0.14, 0.02));
    pieces.push(cylinder(0.5, z0, z0 + 0.9, 24, 0.03));
  } else {
    // 轮缘 + 4 辐条 + 轮毂 + 齿轴
    const rIn = Math.max(rTip - g.module * 3.2, rTip * 0.72);
    pieces.push(extrudeRing(outline, circleOutline(rIn, 48), z0, z1, 0.04));
    const hubR = Math.max(0.65, pinionRadius(g) * 0.85);
    const spokeLen = rIn - hubR + 0.3;
    const spokeW = Math.max(0.5, g.module * 2.4);
    for (let k = 0; k < 4; k++) {
      const spoke = extrudeRing(
        [[-spokeW / 2, hubR - 0.2], [spokeW / 2, hubR - 0.2], [spokeW / 2, hubR + spokeLen], [-spokeW / 2, hubR + spokeLen]],
        null, z0 + 0.04, z1 - 0.04, 0.03,
      );
      pieces.push(transformMesh(spoke, (k * Math.PI) / 2, 0, 0, 0));
    }
    pieces.push(cylinder(hubR, z0, z1 + 0.5, 28, 0.04));
    // 齿轴(小齿轮)
    if (g.pinionTeeth > 0) {
      const pm = g.module * 0.6;
      pieces.push(extrudeRing(gearOutline(pm, g.pinionTeeth), null, z1 + 0.1, z1 + 0.75, 0.02));
    }
  }
  return mergeMeshes(pieces);
}

function balanceMesh(): MeshData {
  const pieces: MeshData[] = [
    ring(4.6, 3.9, 1.9, 2.25, 72, 0.06),
    // 双臂
    transformMesh(extrudeRing([[-0.45, -3.9], [0.45, -3.9], [0.45, 3.9], [-0.45, 3.9]], null, 1.98, 2.18, 0.03), 0, 0, 0, 0),
    cylinder(0.32, 1.0, 2.6, 24, 0.03), // 摆轴
    // 摆轮螺丝(装饰)
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(k => {
      const a = (k / 8) * Math.PI * 2;
      return transformMesh(cylinder(0.28, 2.05, 2.45, 12, 0.02), 0, Math.cos(a) * 4.28, Math.sin(a) * 4.28, 0);
    }),
  ];
  return mergeMeshes(pieces);
}

function palletMesh(): MeshData {
  // 简化擒纵叉:锚形
  const outline: [number, number][] = [
    [-0.25, 0], [-0.5, -1.6], [-0.15, -1.75], [0, -1.1], [0.15, -1.75], [0.5, -1.6],
    [0.25, 0], [0.6, 1.3], [0.2, 1.5], [-0.2, 1.5], [-0.6, 1.3],
  ];
  return flatShape(outline, 0.75, 1.0, 0.03);
}

export function buildScene(m: MovementConfig): BuiltScene {
  const train = computeTrain(m.gears);
  const fin = m.finishing;
  const parts: ScenePart[] = [];
  const aniso = fin.anisotropy;

  const bridgeMode = { geneva: 3, perlage: 4, brushedCircular: 2, brushedLinear: 1, polished: 0 }[fin.bridgeFinish];
  const wheelMode = { brushedCircular: 2, polished: 0, sunray: 7 }[fin.wheelFinish];
  const bridgeSize = fin.bridgeFinish === 'geneva' ? fin.genevaStripeWidth : fin.perlageSize;
  const bridgeAngle = (fin.bridgeFinish === 'geneva' ? fin.genevaAngle : fin.brushAngle) * Math.PI / 180;

  // 主夹板
  let maxR = 12;
  for (const g of m.gears) maxR = Math.max(maxR, Math.hypot(g.x, g.y) + pitchRadius(g) + 2);
  maxR = Math.max(maxR, Math.hypot(m.balancePosition.x, m.balancePosition.y) + 6);
  const plateR = maxR + 1.5;
  parts.push({
    key: 'mainplate', label: '主夹板', kind: 'static',
    mesh: extrudeRing(circleOutline(plateR, 96), null, -1.0, 0, 0.12),
    material: { color: [0.55, 0.56, 0.60], metallic: 0.9, roughness: 0.45, anisotropy: aniso * 0.8, finishMode: 4, alpha: 1, size: fin.perlageSize * 1.4, angle: 0, chamfer: fin.chamferPolished },
    pos: [0, 0, 0], pickRadius: 0, transparent: false,
  });

  // 齿轮
  m.gears.forEach((g, i) => {
    const isEscape = g.type === 'escape';
    parts.push({
      key: `gear:${g.id}`, label: g.name, kind: 'gear', gearIndex: i,
      mesh: gearMesh(g),
      material: {
        color: isEscape ? STEEL : BRASS, metallic: 0.95,
        roughness: isEscape ? 0.18 : 0.32, anisotropy: aniso,
        finishMode: isEscape ? 0 : wheelMode, alpha: 1,
        size: fin.perlageSize, angle: 0, chamfer: fin.chamferPolished,
      },
      pos: [g.x, g.y, 0], pickRadius: pitchRadius(g) + g.module, transparent: false,
    });
    // 秒针装在秒轮上
    if (g.isSecondsWheel) {
      parts.push({
        key: `hand:${g.id}`, label: '秒针', kind: 'gear', gearIndex: i,
        mesh: hand(pitchRadius(g) + 3.5, 0.5, 1.0, 1.12),
        material: { color: [0.1, 0.2, 0.7], metallic: 0.9, roughness: 0.12, anisotropy: 0.4, finishMode: 5, alpha: 1, size: 1, angle: 0, chamfer: false },
        pos: [g.x, g.y, 0], pickRadius: 0, transparent: false,
      });
    }
  });

  // 摆轮 + 游丝
  const bp = m.balancePosition;
  parts.push({
    key: 'balance', label: '摆轮', kind: 'balance',
    mesh: balanceMesh(),
    material: { color: BRASS, metallic: 0.95, roughness: 0.2, anisotropy: aniso * 0.6, finishMode: 2, alpha: 1, size: 1, angle: 0, chamfer: fin.chamferPolished },
    pos: [bp.x, bp.y, 0], pickRadius: 4.8, transparent: false,
  });
  parts.push({
    key: 'hairspring', label: '游丝', kind: 'hairspring',
    mesh: hairspring(0.8, 3.0, 5.5, 2.45, 0.12, 0.05),
    material: { color: [0.15, 0.25, 0.6], metallic: 0.9, roughness: 0.25, anisotropy: 0.5, finishMode: 5, alpha: 1, size: 1, angle: 0, chamfer: false },
    pos: [bp.x, bp.y, 0], pickRadius: 0, transparent: false,
  });

  // 擒纵叉:摆在擒纵轮与摆轮之间
  const esc = m.gears.find(g => g.type === 'escape');
  if (esc) {
    const mx = (esc.x + bp.x) / 2, my = (esc.y + bp.y) / 2;
    parts.push({
      key: 'pallet', label: '擒纵叉', kind: 'pallet',
      mesh: palletMesh(),
      material: { color: STEEL, metallic: 0.95, roughness: 0.15, anisotropy: 0.3, finishMode: 0, alpha: 1, size: 1, angle: 0, chamfer: true },
      pos: [mx, my, 0], pickRadius: 1.2, transparent: false,
    });
  }

  // 夹板:轮系条夹板(覆盖中心轮到三轮方向)+ 摆轮夹板
  const bridgeMat: Material = {
    color: RHODIUM, metallic: 0.9, roughness: 0.35, anisotropy: aniso,
    finishMode: bridgeMode, alpha: 1, size: bridgeSize, angle: bridgeAngle, chamfer: fin.chamferPolished,
  };
  const g0 = m.gears[0], g1 = m.gears[1] ?? m.gears[0];
  if (g0 && g1) {
    const cx = (g0.x + g1.x) / 2, cy = (g0.y + g1.y) / 2;
    const len = Math.hypot(g1.x - g0.x, g1.y - g0.y) + 7;
    const ang = Math.atan2(g1.y - g0.y, g1.x - g0.x);
    parts.push({
      key: 'bridge:train', label: '轮系夹板', kind: 'static',
      mesh: transformMesh(extrudeRing(capsuleOutline(len, 6.5), null, 1.5, 2.05, 0.12), ang, cx, cy, 0),
      material: bridgeMat, pos: [0, 0, 0], pickRadius: 0, transparent: false,
    });
  }
  // 摆夹板(从摆轮向中心延伸)
  const bAng = Math.atan2(-bp.y, -bp.x);
  parts.push({
    key: 'bridge:balance', label: '摆夹板', kind: 'static',
    mesh: transformMesh(extrudeRing(capsuleOutline(9, 5), null, 2.6, 3.15, 0.12), bAng, bp.x + Math.cos(bAng) * 3.2, bp.y + Math.sin(bAng) * 3.2, 0),
    material: { ...bridgeMat }, pos: [0, 0, 0], pickRadius: 0, transparent: false,
  });

  // 红宝石轴承:每个齿轮轴心 + 摆轮上下
  if (fin.rubyJewels) {
    const jewelMat: Material = { color: [0.6, 0.02, 0.05], metallic: 0.1, roughness: 0.08, anisotropy: 0, finishMode: 6, alpha: 0.88, size: 1, angle: 0, chamfer: false };
    m.gears.forEach((g, i) => {
      parts.push({
        key: `jewel:${g.id}`, label: `${g.name} 红宝石轴承`, kind: 'static',
        mesh: cylinder(0.55, 2.05, 2.3, 24, 0.06),
        material: jewelMat, pos: [g.x, g.y, 0], pickRadius: 0, transparent: true,
      });
      void i;
    });
    parts.push({
      key: 'jewel:balance', label: '摆轮红宝石轴承', kind: 'static',
      mesh: cylinder(0.6, 3.15, 3.4, 24, 0.06),
      material: jewelMat, pos: [bp.x, bp.y, 0], pickRadius: 0, transparent: true,
    });
  }

  // 螺丝(蓝钢回火色或精钢):夹板两端
  const screwMat: Material = fin.bluedScrews
    ? { color: [0.1, 0.2, 0.7], metallic: 0.95, roughness: 0.1, anisotropy: 0.3, finishMode: 5, alpha: 1, size: 1, angle: 0, chamfer: false }
    : { color: STEEL, metallic: 0.95, roughness: 0.12, anisotropy: 0.3, finishMode: 0, alpha: 1, size: 1, angle: 0, chamfer: false };
  const screwAt = (x: number, y: number, z: number, key: string) => {
    const slot = extrudeRing([[-0.5, -0.07], [0.5, -0.07], [0.5, 0.07], [-0.5, 0.07]], null, z + 0.28, z + 0.33, 0);
    parts.push({
      key, label: '螺丝', kind: 'static',
      mesh: mergeMeshes([cylinder(0.55, z, z + 0.3, 24, 0.05), slot]),
      material: screwMat, pos: [x, y, 0], pickRadius: 0, transparent: false,
    });
  };
  if (g0 && g1) {
    const ang = Math.atan2(g1.y - g0.y, g1.x - g0.x);
    const cx = (g0.x + g1.x) / 2, cy = (g0.y + g1.y) / 2;
    const len = Math.hypot(g1.x - g0.x, g1.y - g0.y) + 7;
    screwAt(cx + Math.cos(ang) * (len / 2 - 1.2), cy + Math.sin(ang) * (len / 2 - 1.2), 2.05, 'screw:t1');
    screwAt(cx - Math.cos(ang) * (len / 2 - 1.2), cy - Math.sin(ang) * (len / 2 - 1.2), 2.05, 'screw:t2');
  }
  screwAt(bp.x + Math.cos(bAng) * 6.4, bp.y + Math.sin(bAng) * 6.4, 3.15, 'screw:b1');

  // 蓝宝石后盖
  parts.push({
    key: 'glass', label: '蓝宝石后盖', kind: 'glass',
    mesh: domeDisc(plateR + 0.8, 4.6, 0.7, 8, 72),
    material: { color: [1, 1, 1], metallic: 0, roughness: 0, anisotropy: 0, finishMode: 0, alpha: 1, size: 1, angle: 0, chamfer: false },
    pos: [0, 0, 0], pickRadius: 0, transparent: true,
  });

  return { parts, omegas: train.entries.map(e => e.omega), vph: m.frequency, plateRadius: plateR, movement: m };
}
