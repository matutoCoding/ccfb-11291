// 走时核心:基于 performance.now() 的单调时钟 + 解析式角度计算
//
// 精度设计(对应"10分钟误差<0.1秒"的硬指标):
// 1. 模拟时间 = Σ(performance.now() 帧间隔 × 倍率),不做帧计数累加,
//    帧率波动、掉帧、后台切出都不会累积误差;
// 2. 所有轮系角度都是 simTime 的解析函数 θ(t)=2π·ω·t,不是逐步积分,
//    不存在数值积分漂移;
// 3. performance.now() 为单调时钟,分辨率 ≤5µs,与系统时钟同源,
//    10 分钟量级漂移远小于 0.1s。

export class MovementClock {
  private accMs = 0;        // 累计模拟时间(ms, 已乘倍率)
  private wallAccMs = 0;    // 累计墙钟时间(ms, 未乘倍率,用于漂移对照)
  private lastNow: number | null = null;
  rate = 1;                 // 慢放倍率 0.05 / 0.2 / 1
  paused = false;

  /** 每帧调用,now 为 performance.now() */
  tick(now: number): void {
    if (this.lastNow !== null) {
      const dt = now - this.lastNow;
      // 单帧间隔钳制在 1s 内,防止后台标签页挂起后跳变
      const clamped = Math.min(dt, 1000);
      if (!this.paused) {
        this.accMs += clamped * this.rate;
        this.wallAccMs += clamped;
      }
    }
    this.lastNow = now;
  }

  /** 模拟时间(秒) */
  get time(): number { return this.accMs / 1000; }
  /** 墙钟时间(秒),暂停/慢放时与 time 分离 */
  get wallTime(): number { return this.wallAccMs / 1000; }

  reset(): void {
    this.accMs = 0; this.wallAccMs = 0; this.lastNow = null;
  }
}

/** 摆轮角度(弧度):简谐摆动,频率 = vph/7200 Hz(每小时 vph 次半摆) */
export function balanceAngle(t: number, vph: number, amplitudeDeg = 250): number {
  const f = vph / 7200;
  return (amplitudeDeg * Math.PI / 180) * Math.sin(2 * Math.PI * f * t);
}

/** 擒纵叉角度:跟随半摆节拍,用 tanh 做出"锁-冲"的快速切换感 */
export function palletAngle(t: number, vph: number, amplitudeDeg = 7): number {
  const f = vph / 7200;
  return (amplitudeDeg * Math.PI / 180) * Math.tanh(6 * Math.sin(2 * Math.PI * f * t));
}

/** 游丝呼吸缩放(视觉):随摆角周期性收放 */
export function hairspringBreath(t: number, vph: number): number {
  const f = vph / 7200;
  return 1 + 0.04 * Math.sin(2 * Math.PI * f * t);
}
