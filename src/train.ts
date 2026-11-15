// 轮系传动比计算与默认机芯
import type { GearSpec, MovementConfig } from './types';
import { defaultFinishing, uid } from './types';

export const TAU = Math.PI * 2;

/** 轮片节圆半径 mm */
export function pitchRadius(g: GearSpec): number {
  return (g.module * g.teeth) / 2;
}
/** 齿轴节圆半径 mm(齿轴模数取轮片的 0.6 倍,视觉上更协调) */
export function pinionRadius(g: GearSpec): number {
  return (g.module * 0.6 * g.pinionTeeth) / 2;
}

export interface TrainEntry {
  gear: GearSpec;
  omega: number;      // 角速度 rev/s(带符号,负=顺时针)
  rpm: number;
  periodSec: number;  // 转一圈秒数
  ratioToPrevious: number | null; // 相对前一级增速比
}

export interface TrainResult {
  entries: TrainEntry[];
  /** 由轮系推算的摆频 vph(擒纵轮每齿 2 击) */
  impliedVph: number | null;
  /** 秒轮一圈秒数(恒为 60,锚定保证) */
  secondsPeriod: number;
  escapeWheel: TrainEntry | null;
}

/**
 * 以秒轮为锚点(正好 60s/圈)向两端推算整个轮系转速。
 * 规则:第 i 级轮片驱动第 i+1 级的齿轴,ω_{i+1} = -ω_i * z_i / zp_{i+1}
 */
export function computeTrain(gears: GearSpec[]): TrainResult {
  const empty: TrainResult = { entries: [], impliedVph: null, secondsPeriod: 60, escapeWheel: null };
  if (gears.length === 0) return empty;

  let anchorIdx = gears.findIndex(g => g.isSecondsWheel);
  if (anchorIdx < 0) anchorIdx = Math.min(1, gears.length - 1);

  const omegas = new Array<number>(gears.length).fill(0);
  omegas[anchorIdx] = -1 / 60; // 秒针一圈正好 60 秒(俯视背面顺时针为负)

  // 向高速端(数组后方)推
  for (let i = anchorIdx; i < gears.length - 1; i++) {
    const drive = gears[i], driven = gears[i + 1];
    if (driven.pinionTeeth > 0) {
      omegas[i + 1] = -omegas[i] * drive.teeth / driven.pinionTeeth;
    }
  }
  // 向低速端(数组前方)推:前一级轮片驱动本级齿轴
  for (let i = anchorIdx; i > 0; i--) {
    const drive = gears[i - 1], driven = gears[i];
    if (driven.pinionTeeth > 0 && drive.teeth > 0) {
      omegas[i - 1] = -omegas[i] * driven.pinionTeeth / drive.teeth;
    }
  }

  const entries: TrainEntry[] = gears.map((g, i) => ({
    gear: g,
    omega: omegas[i],
    rpm: omegas[i] * 60,
    periodSec: omegas[i] !== 0 ? Math.abs(1 / omegas[i]) : Infinity,
    ratioToPrevious: i > 0 && omegas[i - 1] !== 0 ? Math.abs(omegas[i] / omegas[i - 1]) : null,
  }));

  const escapeIdx = gears.findIndex(g => g.type === 'escape');
  let impliedVph: number | null = null;
  let escapeWheel: TrainEntry | null = null;
  if (escapeIdx >= 0) {
    escapeWheel = entries[escapeIdx];
    // 擒纵轮每转一齿产生 2 次摆锤击发
    impliedVph = Math.abs(omegas[escapeIdx]) * gears[escapeIdx].teeth * 2 * 3600;
  }
  return { entries, impliedVph, secondsPeriod: 60, escapeWheel };
}

/** 自动布局:从中心轮出发,按啮合节圆相切排成折线 */
export function autoLayout(gears: GearSpec[]): void {
  if (gears.length === 0) return;
  gears[0].x = 0; gears[0].y = 0;
  let angle = -Math.PI / 2;
  for (let i = 1; i < gears.length; i++) {
    const prev = gears[i - 1], cur = gears[i];
    const dist = pitchRadius(prev) + pinionRadius(cur) + 0.15;
    // 每级偏转一点角度,避免全部挤在一条线上
    angle += (i % 2 === 0 ? 0.55 : -0.35);
    cur.x = +(prev.x + Math.cos(angle) * dist).toFixed(2);
    cur.y = +(prev.y + Math.sin(angle) * dist).toFixed(2);
  }
}

/** 默认机芯:中心轮 80/10 → 三轮 75/10 → 秒轮 60/10 → 擒纵轮 15/5,21600vph 精确匹配 */
export function createDefaultMovement(name = 'Cal. 默认机芯'): MovementConfig {
  const mk = (partial: Partial<GearSpec> & Pick<GearSpec, 'name' | 'type' | 'module' | 'teeth' | 'pinionTeeth'>): GearSpec => ({
    id: uid(), x: 0, y: 0, isSecondsWheel: false, ...partial,
  });
  const gears: GearSpec[] = [
    mk({ name: '中心轮', type: 'center', module: 0.20, teeth: 80, pinionTeeth: 10 }),
    mk({ name: '三轮', type: 'third', module: 0.16, teeth: 75, pinionTeeth: 10 }),
    mk({ name: '秒轮(四轮)', type: 'fourth', module: 0.14, teeth: 60, pinionTeeth: 10, isSecondsWheel: true }),
    mk({ name: '擒纵轮', type: 'escape', module: 0.12, teeth: 15, pinionTeeth: 5 }),
  ];
  autoLayout(gears);
  const now = Date.now();
  return {
    id: uid(),
    name,
    description: '小三针手动机芯,中心轮→三轮→秒轮→擒纵轮',
    frequency: 21600,
    balancePosition: { x: 10.5, y: 6.5 },
    gears,
    finishing: defaultFinishing(),
    createdAt: now,
    updatedAt: now,
  };
}
