// 程序化网格生成:齿轮、夹板、游丝、螺丝、表镜等
// 所有网格以局部坐标生成(Z 为机芯轴向,单位 mm),由场景负责摆放。

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  tangents: Float32Array; // 预计算切线(默认环绕方向),供各向异性拉丝使用
  indices: Uint32Array;
}

type V2 = [number, number];
type V3 = [number, number, number];

class MeshBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  tan: number[] = [];
  idx: number[] = [];

  vert(p: V3, n: V3, t?: V3): number {
    this.pos.push(p[0], p[1], p[2]);
    const nl = norm3(n);
    this.nrm.push(nl[0], nl[1], nl[2]);
    // 默认切线:XY 面内环绕方向(垂直于半径),拉丝绕轴心旋转,转动时高光稳定
    let tg: V3 = t ?? [-p[1], p[0], 0];
    if (len3(tg) < 1e-6) tg = [1, 0, 0];
    tg = norm3(tg);
    this.tan.push(tg[0], tg[1], tg[2]);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  build(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nrm),
      tangents: new Float32Array(this.tan),
      indices: new Uint32Array(this.idx),
    };
  }
}

function norm3(v: V3): V3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function len3(v: V3): number { return Math.hypot(v[0], v[1], v[2]); }

/** 通用拉伸体:外轮廓(+可选内孔轮廓)沿 Z 拉伸,上下边缘可倒角 */
export function extrudeRing(outer: V2[], inner: V2[] | null, z0: number, z1: number, bevel = 0.08): MeshData {
  const mb = new MeshBuilder();
  const avgR = outer.reduce((s, p) => s + Math.hypot(p[0], p[1]), 0) / outer.length || 1;
  const b = Math.min(bevel, (z1 - z0) / 2.5, avgR * 0.3);
  const k = b > 1e-5 ? 1 - b / avgR : 1;
  // 截面层: [z, scale, 层类型]
  const levels: { z: number; s: number }[] = b > 1e-5
    ? [{ z: z0, s: k }, { z: z0 + b, s: 1 }, { z: z1 - b, s: 1 }, { z: z1, s: k }]
    : [{ z: z0, s: 1 }, { z: z1, s: 1 }];

  const n = outer.length;
  const scaled = (pts: V2[], s: number): V2[] => pts.map(p => [p[0] * s, p[1] * s] as V2);

  // 外壁
  for (let li = 0; li < levels.length - 1; li++) {
    const A = scaled(outer, levels[li].s), B = scaled(outer, levels[li + 1].s);
    const zA = levels[li].z, zB = levels[li + 1].z;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const edge: V2 = [B[j][0] - A[i][0], B[j][1] - A[i][1]];
      // 轮廓外法线(XY 面内,垂直于轮廓边)
      const perp: V2 = [edge[1], -edge[0]];
      // 侧壁法线 = 轮廓外法线;倒角层混入 ±Z 分量形成 45° 斜面
      const isBevel = Math.abs(levels[li + 1].s - levels[li].s) > 1e-6;
      const zSign = levels[li + 1].z > levels[li].z ? 1 : -1;
      const nn: V3 = isBevel
        ? norm3([perp[0], perp[1], zSign * Math.hypot(perp[0], perp[1]) * 0.9])
        : [perp[0], perp[1], 0];
      const a = mb.vert([A[i][0], A[i][1], zA], nn);
      const bq = mb.vert([A[j][0], A[j][1], zA], nn);
      const c = mb.vert([B[j][0], B[j][1], zB], nn);
      const d = mb.vert([B[i][0], B[i][1], zB], nn);
      mb.quad(a, bq, c, d);
    }
  }

  // 内孔壁(法线反向)
  if (inner) {
    const m = inner.length;
    for (let li = 0; li < levels.length - 1; li++) {
      const A = scaled(inner, levels[li].s), B = scaled(inner, levels[li + 1].s);
      const zA = levels[li].z, zB = levels[li + 1].z;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m;
        const edge: V2 = [A[j][0] - A[i][0], A[j][1] - A[i][1]];
        const perp: V2 = [-edge[1], edge[0]]; // 指向孔内
        const nn: V3 = [perp[0], perp[1], 0];
        const a = mb.vert([A[i][0], A[i][1], zA], nn);
        const bq = mb.vert([B[i][0], B[i][1], zB], nn);
        const c = mb.vert([B[j][0], B[j][1], zB], nn);
        const d = mb.vert([A[j][0], A[j][1], zA], nn);
        mb.quad(a, bq, c, d);
      }
    }
  }

  // 上下端面
  const zBot = levels[0].z, zTop = levels[levels.length - 1].z;
  const outBot = scaled(outer, levels[0].s), outTop = scaled(outer, levels[levels.length - 1].s);
  if (inner) {
    const inBot = scaled(inner, levels[0].s), inTop = scaled(inner, levels[levels.length - 1].s);
    const m = inner.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const k2 = Math.round((i / n) * m) % m, k3 = Math.round(((i + 1) / n) * m) % m;
      // 顶面(+Z)
      let a = mb.vert([outTop[i][0], outTop[i][1], zTop], [0, 0, 1]);
      let bq = mb.vert([outTop[j][0], outTop[j][1], zTop], [0, 0, 1]);
      let c = mb.vert([inTop[k3][0], inTop[k3][1], zTop], [0, 0, 1]);
      let d = mb.vert([inTop[k2][0], inTop[k2][1], zTop], [0, 0, 1]);
      mb.quad(a, bq, c, d);
      // 底面(-Z)
      a = mb.vert([outBot[i][0], outBot[i][1], zBot], [0, 0, -1]);
      bq = mb.vert([inBot[k2][0], inBot[k2][1], zBot], [0, 0, -1]);
      c = mb.vert([inBot[k3][0], inBot[k3][1], zBot], [0, 0, -1]);
      d = mb.vert([outBot[j][0], outBot[j][1], zBot], [0, 0, -1]);
      mb.quad(a, bq, c, d);
    }
  } else {
    // 三角扇(轮廓为星形凸,绕原点)
    const cTop = mb.vert([0, 0, zTop], [0, 0, 1]);
    const cBot = mb.vert([0, 0, zBot], [0, 0, -1]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = mb.vert([outTop[i][0], outTop[i][1], zTop], [0, 0, 1]);
      const bq = mb.vert([outTop[j][0], outTop[j][1], zTop], [0, 0, 1]);
      mb.tri(cTop, a, bq);
      const a2 = mb.vert([outBot[i][0], outBot[i][1], zBot], [0, 0, -1]);
      const b2 = mb.vert([outBot[j][0], outBot[j][1], zBot], [0, 0, -1]);
      mb.tri(cBot, b2, a2);
    }
  }
  return mb.build();
}

/** 齿轮轮廓(梯形直齿,节圆 r=m·z/2) */
export function gearOutline(module: number, teeth: number): V2[] {
  const r = (module * teeth) / 2;
  const rTip = r + module * 0.9;
  const rRoot = Math.max(r - module * 1.0, r * 0.55);
  const pts: V2[] = [];
  const pitch = (Math.PI * 2) / teeth;
  const tipHalf = pitch * 0.19, rootHalf = pitch * 0.30;
  for (let i = 0; i < teeth; i++) {
    const a = i * pitch;
    pts.push(
      [rRoot * Math.cos(a - rootHalf), rRoot * Math.sin(a - rootHalf)],
      [rTip * Math.cos(a - tipHalf), rTip * Math.sin(a - tipHalf)],
      [rTip * Math.cos(a + tipHalf), rTip * Math.sin(a + tipHalf)],
      [rRoot * Math.cos(a + rootHalf), rRoot * Math.sin(a + rootHalf)],
    );
  }
  return pts;
}

/** 擒纵轮轮廓(尖钩齿) */
export function escapeOutline(module: number, teeth: number): V2[] {
  const r = (module * teeth) / 2;
  const rTip = r + module * 1.1;
  const rRoot = r - module * 0.8;
  const pts: V2[] = [];
  const pitch = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * pitch;
    pts.push(
      [rRoot * Math.cos(a - pitch * 0.42), rRoot * Math.sin(a - pitch * 0.42)],
      [rTip * Math.cos(a - pitch * 0.03), rTip * Math.sin(a - pitch * 0.03)],
      [rTip * Math.cos(a + pitch * 0.03), rTip * Math.sin(a + pitch * 0.03)],
      [rRoot * Math.cos(a + pitch * 0.28), rRoot * Math.sin(a + pitch * 0.28)],
    );
  }
  return pts;
}

export function circleOutline(r: number, seg = 48): V2[] {
  const pts: V2[] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

/** 圆角矩形轮廓(夹板基础形) */
export function roundedRectOutline(w: number, h: number, r: number, segPerCorner = 6): V2[] {
  const pts: V2[] = [];
  const hw = w / 2 - r, hh = h / 2 - r;
  const corners: V2[] = [[hw, hh], [-hw, hh], [-hw, -hh], [hw, -hh]];
  for (let c = 0; c < 4; c++) {
    const [cx, cy] = corners[c];
    const a0 = [0, Math.PI / 2, Math.PI, -Math.PI / 2][c];
    for (let i = 0; i <= segPerCorner; i++) {
      const a = a0 + (i / segPerCorner) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

/** 跑道形(胶囊)轮廓,用于条夹板 */
export function capsuleOutline(length: number, width: number, seg = 12): V2[] {
  const pts: V2[] = [];
  const r = width / 2, hl = Math.max(length / 2 - r, 0.01);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI - Math.PI / 2;
    pts.push([hl + r * Math.cos(a), r * Math.sin(a)]);
  }
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI + Math.PI / 2;
    pts.push([-hl + r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

export function cylinder(r: number, z0: number, z1: number, seg = 40, bevel = 0.05): MeshData {
  return extrudeRing(circleOutline(r, seg), null, z0, z1, bevel);
}

export function ring(rOut: number, rIn: number, z0: number, z1: number, seg = 64, bevel = 0.05): MeshData {
  return extrudeRing(circleOutline(rOut, seg), circleOutline(rIn, seg), z0, z1, bevel);
}

/** 阿基米德游丝(扁平螺旋带) */
export function hairspring(r0: number, r1: number, turns: number, z: number, width: number, thick: number): MeshData {
  const mb = new MeshBuilder();
  const N = Math.max(64, Math.floor(turns * 48));
  const pts: V2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = t * turns * Math.PI * 2;
    const r = r0 + (r1 - r0) * t;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  for (let i = 0; i < N; i++) {
    const p0 = pts[i], p1 = pts[i + 1];
    const d: V2 = [p1[0] - p0[0], p1[1] - p0[1]];
    const l = Math.hypot(d[0], d[1]) || 1;
    const n2: V2 = [-d[1] / l, d[0] / l];
    const hw = width / 2;
    const corners: V3[] = [
      [p0[0] + n2[0] * hw, p0[1] + n2[1] * hw, z + thick / 2],
      [p0[0] - n2[0] * hw, p0[1] - n2[1] * hw, z + thick / 2],
      [p1[0] + n2[0] * hw, p1[1] + n2[1] * hw, z + thick / 2],
      [p1[0] - n2[0] * hw, p1[1] - n2[1] * hw, z + thick / 2],
      [p0[0] + n2[0] * hw, p0[1] + n2[1] * hw, z - thick / 2],
      [p0[0] - n2[0] * hw, p0[1] - n2[1] * hw, z - thick / 2],
      [p1[0] + n2[0] * hw, p1[1] + n2[1] * hw, z - thick / 2],
      [p1[0] - n2[0] * hw, p1[1] - n2[1] * hw, z - thick / 2],
    ];
    const up: V3 = [0, 0, 1], dn: V3 = [0, 0, -1];
    const side: V3 = [n2[0], n2[1], 0], side2: V3 = [-n2[0], -n2[1], 0];
    // 顶面
    mb.quad(mb.vert(corners[0], up), mb.vert(corners[2], up), mb.vert(corners[3], up), mb.vert(corners[1], up));
    // 底面
    mb.quad(mb.vert(corners[4], dn), mb.vert(corners[5], dn), mb.vert(corners[7], dn), mb.vert(corners[6], dn));
    // 两侧
    mb.quad(mb.vert(corners[0], side), mb.vert(corners[4], side), mb.vert(corners[6], side), mb.vert(corners[2], side));
    mb.quad(mb.vert(corners[1], side2), mb.vert(corners[3], side2), mb.vert(corners[7], side2), mb.vert(corners[5], side2));
  }
  return mb.build();
}

/** 指针(秒针):细长菱形杆 + 尾翼 */
export function hand(length: number, width: number, z0: number, z1: number): MeshData {
  const tail = length * 0.28;
  const outline: V2[] = [
    [0, -tail], [width / 2, -tail * 0.4], [width * 0.16, 0],
    [width * 0.10, length * 0.75], [0, length], [-width * 0.10, length * 0.75],
    [-width * 0.16, 0], [-width / 2, -tail * 0.4],
  ];
  return extrudeRing(outline, null, z0, z1, 0.02);
}

/** 简单多边形拉伸(擒纵叉等) */
export function flatShape(outline: V2[], z0: number, z1: number, bevel = 0.03): MeshData {
  return extrudeRing(outline, null, z0, z1, bevel);
}

/** 蓝宝石表镜:微凸圆片 */
export function domeDisc(r: number, zBase: number, sag: number, rings = 6, seg = 64): MeshData {
  const mb = new MeshBuilder();
  const idx: number[][] = [];
  for (let ri = 0; ri <= rings; ri++) {
    const rr = (ri / rings) * r;
    const z = zBase + sag * Math.sqrt(Math.max(0, 1 - (rr / r) * (rr / r)));
    // 法线:由弧面梯度
    const dzdr = rr > 1e-4 ? -sag * (rr / r) / (r * Math.sqrt(Math.max(1e-4, 1 - (rr / r) * (rr / r)))) : 0;
    const row: number[] = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const n = norm3([-dzdr * Math.cos(a), -dzdr * Math.sin(a), 1]);
      row.push(mb.vert([rr * Math.cos(a), rr * Math.sin(a), z], n));
    }
    idx.push(row);
  }
  for (let ri = 0; ri < rings; ri++) {
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      mb.quad(idx[ri][i], idx[ri][j], idx[ri + 1][j], idx[ri + 1][i]);
    }
  }
  return mb.build();
}

export function mergeMeshes(meshes: MeshData[]): MeshData {
  let np = 0, ni = 0;
  for (const m of meshes) { np += m.positions.length; ni += m.indices.length; }
  const positions = new Float32Array(np);
  const normals = new Float32Array(np);
  const tangents = new Float32Array(np);
  const indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo);
    normals.set(m.normals, vo);
    tangents.set(m.tangents, vo);
    const base = vo / 3;
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base;
    vo += m.positions.length; io += m.indices.length;
  }
  return { positions, normals, tangents, indices };
}

/** 绕 Z 旋转 + 平移(用于拼装轮辐等) */
export function transformMesh(m: MeshData, rotZ: number, tx: number, ty: number, tz: number): MeshData {
  const c = Math.cos(rotZ), s = Math.sin(rotZ);
  const positions = new Float32Array(m.positions.length);
  const normals = new Float32Array(m.normals.length);
  const tangents = new Float32Array(m.tangents.length);
  for (let i = 0; i < m.positions.length; i += 3) {
    const x = m.positions[i], y = m.positions[i + 1];
    positions[i] = c * x - s * y + tx;
    positions[i + 1] = s * x + c * y + ty;
    positions[i + 2] = m.positions[i + 2] + tz;
    const nx = m.normals[i], ny = m.normals[i + 1];
    normals[i] = c * nx - s * ny; normals[i + 1] = s * nx + c * ny; normals[i + 2] = m.normals[i + 2];
    const tx2 = m.tangents[i], ty2 = m.tangents[i + 1];
    tangents[i] = c * tx2 - s * ty2; tangents[i + 1] = s * tx2 + c * ty2; tangents[i + 2] = m.tangents[i + 2];
  }
  return { positions, normals, tangents, indices: m.indices };
}
