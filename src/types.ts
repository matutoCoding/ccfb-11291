// 数据模型定义

export type GearType = 'barrel' | 'center' | 'third' | 'fourth' | 'escape' | 'custom';

export interface GearSpec {
  id: string;
  name: string;
  type: GearType;
  module: number;        // 模数 m (mm)
  teeth: number;         // 轮片齿数 z
  pinionTeeth: number;   // 同轴小齿轴齿数(被上一级轮片驱动)
  x: number;             // 平面位置 mm
  y: number;
  isSecondsWheel: boolean; // 秒轮(锚定为 60s/圈)
}

export type BridgeFinish = 'geneva' | 'perlage' | 'brushedCircular' | 'brushedLinear' | 'polished';
export type WheelFinish = 'brushedCircular' | 'polished' | 'sunray';

export interface FinishingConfig {
  bridgeFinish: BridgeFinish;
  genevaStripeWidth: number;  // mm
  genevaAngle: number;        // 度
  perlageSize: number;        // mm 圆点直径
  anisotropy: number;         // 0..1 拉丝各向异性强度
  brushAngle: number;         // 直线拉丝方向(度)
  chamferPolished: boolean;   // 倒角抛光
  wheelFinish: WheelFinish;
  bluedScrews: boolean;       // 蓝钢螺丝
  rubyJewels: boolean;        // 红宝石轴承
  glassReflection: number;    // 0..1 蓝宝石后盖反光强度
}

export interface MovementConfig {
  id: string;
  name: string;
  description: string;
  frequency: 21600 | 28800;   // 摆频 vph
  balancePosition: { x: number; y: number };
  gears: GearSpec[];
  finishing: FinishingConfig;
  createdAt: number;
  updatedAt: number;
}

export interface AppSettings {
  msaa: 1 | 4;
  resolutionScale: number;    // 0.5 .. 2
  showTimingHud: boolean;
  slowmoRate: number;         // 最近使用的慢放倍率
}

export const DEFAULT_SETTINGS: AppSettings = {
  msaa: 4,
  resolutionScale: 1,
  showTimingHud: true,
  slowmoRate: 1,
};

export function defaultFinishing(): FinishingConfig {
  return {
    bridgeFinish: 'geneva',
    genevaStripeWidth: 3.2,
    genevaAngle: 15,
    perlageSize: 1.6,
    anisotropy: 0.85,
    brushAngle: 0,
    chamferPolished: true,
    wheelFinish: 'brushedCircular',
    bluedScrews: true,
    rubyJewels: true,
    glassReflection: 0.35,
  };
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
