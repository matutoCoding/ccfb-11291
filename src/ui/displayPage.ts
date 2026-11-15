// 展示页:WebGPU 机芯透视视图
import { MovementRenderer } from '../renderer';
import { buildScene } from '../scene';
import { computeTrain } from '../train';
import { getCurrentMovement, rendererHolder, getSceneVersion } from '../appState';
import { loadSettings } from '../store';
import { el } from './dom';
import { MovementConfig } from '../types';

let mountedVersion = -1;
let hudTimer = 0;

export async function renderDisplayPage(root: HTMLElement): Promise<void> {
  const layout = el('div', { id: 'display-layout' });
  const wrap = el('div', { id: 'canvas-wrap' });
  const canvas = el('canvas', { id: 'gpu-canvas' }) as HTMLCanvasElement;
  const hud = el('div', { id: 'timing-hud' });
  const tooltip = el('div', { id: 'gear-tooltip' });
  const toolbar = el('div', { class: 'toolbar' });
  const side = el('div', { id: 'display-side' });
  wrap.append(canvas, hud, tooltip, toolbar);
  layout.append(wrap, side);
  root.append(layout);

  const m = getCurrentMovement();
  const settings = loadSettings();

  // 渲染器(WebGPU context 与 canvas 绑定,每次进入页面重建)
  if (rendererHolder.current) {
    rendererHolder.current.dispose();
    rendererHolder.current = null;
  }
  const renderer = await MovementRenderer.create(canvas, { msaa: settings.msaa, resolutionScale: settings.resolutionScale });
  if (!renderer) {
    showWebGpuFallback(wrap);
    return;
  }
  rendererHolder.current = renderer;

  if (!m) {
    side.append(el('div', { class: 'empty-hint' }, ['请先在「机芯列表」创建机芯']));
    return;
  }

  const applyScene = (conf: MovementConfig) => {
    const scene = buildScene(conf);
    renderer!.setScene(scene);
    renderer!.glassReflection = conf.finishing.glassReflection;
    mountedVersion = getSceneVersion();
  };
  applyScene(m);

  // 每帧检查配置是否有更新(编辑页/打磨页改动后回到展示页自动生效)
  renderer.onFrame = (simTime, wallTime) => {
    if (getSceneVersion() !== mountedVersion) {
      const cur = getCurrentMovement();
      if (cur) applyScene(cur);
    }
    void simTime; void wallTime;
  };

  // ---------- 工具栏 ----------
  const playBtn = el('button', { class: 'primary' }, ['⏸ 暂停']);
  playBtn.onclick = () => {
    renderer!.clock.paused = !renderer!.clock.paused;
    playBtn.textContent = renderer!.clock.paused ? '▶ 继续' : '⏸ 暂停';
  };
  const rates: [number, string][] = [[1, '1×'], [0.2, '0.2×'], [0.05, '0.05×']];
  const rateRow = el('span', {});
  rates.forEach(([r, label]) => {
    const b = el('button', {}, [label]);
    b.onclick = () => { renderer!.clock.rate = r; };
    rateRow.append(b);
  });
  const shotBtn = el('button', {}, ['📷 截图(带参数)']);
  shotBtn.onclick = async () => {
    const cur = getCurrentMovement();
    if (!cur) return;
    const train = computeTrain(cur.gears);
    const lines = [
      `${cur.name} · ${cur.frequency} vph · ${cur.gears.length} 轮`,
      `轮系:${cur.gears.map(g => `${g.name} ${g.teeth}/${g.pinionTeeth}`).join(' → ')}`,
      `推算摆频 ${train.impliedVph ? train.impliedVph.toFixed(0) : '—'} vph · 秒针 60.000s/圈 · ${new Date().toLocaleString()}`,
    ];
    const blob = await renderer!.captureWithOverlay(lines);
    if (blob) {
      const a = el('a', { href: URL.createObjectURL(blob), download: `${cur.name}-机芯.png` }) as HTMLAnchorElement;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }
  };
  toolbar.append(playBtn, rateRow, shotBtn);

  // ---------- 侧栏 ----------
  const renderSide = () => {
    side.innerHTML = '';
    side.append(el('h3', {}, [m.name]));
    side.append(el('div', { class: 'muted', style: 'margin-bottom:10px' }, [
      `摆频 ${m.frequency} vph · 拖动旋转视角,滚轮缩放,点击齿轮查看参数`,
    ]));
    const train = computeTrain(m.gears);
    const t = el('table', { class: 'data' });
    t.append(el('tr', {}, [el('th', {}, ['齿轮']), el('th', {}, ['齿数']), el('th', {}, ['转速'])]));
    for (const e of train.entries) {
      t.append(el('tr', {}, [
        el('td', {}, [e.gear.name]),
        el('td', {}, [`${e.gear.teeth}/${e.gear.pinionTeeth}`]),
        el('td', {}, [`${Math.abs(e.rpm).toFixed(3)} rpm`]),
      ]));
    }
    side.append(t);
  };
  renderSide();

  // ---------- 走时 HUD ----------
  hud.style.display = settings.showTimingHud ? 'block' : 'none';
  const fmt = (s: number) => {
    const mm = Math.floor(s / 60), ss = s % 60;
    return `${String(mm).padStart(2, '0')}:${ss.toFixed(3).padStart(6, '0')}`;
  };
  clearInterval(hudTimer);
  hudTimer = window.setInterval(() => {
    if (!renderer) return;
    const sim = renderer.clock.time, wall = renderer.clock.wallTime;
    const drift = sim - wall * renderer.clock.rate;
    hud.textContent =
      `模拟走时 ${fmt(sim)}   墙钟 ${fmt(wall)}\n` +
      `秒针相位 ${(sim % 60).toFixed(3)}s / 60s   倍率 ${renderer.clock.rate}×\n` +
      `累计误差 ${(drift * 1000).toFixed(1)} ms(10 分钟指标 < 100 ms)`;
  }, 250);

  // ---------- 交互:旋转 / 缩放 / 拾取 ----------
  let dragging = false, moved = false, lx = 0, ly = 0;
  canvas.addEventListener('pointerdown', e => {
    dragging = true; moved = false; lx = e.clientX; ly = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (dragging) {
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      renderer!.azimuth += dx * 0.008;
      renderer!.polar = Math.min(1.35, Math.max(0.05, renderer!.polar + dy * 0.006));
      lx = e.clientX; ly = e.clientY;
    }
  });
  canvas.addEventListener('pointerup', e => {
    dragging = false;
    if (!moved && renderer) {
      const hit = renderer.pick(e.clientX, e.clientY);
      if (hit) {
        const cur = getCurrentMovement();
        const train = cur ? computeTrain(cur.gears) : null;
        const entry = hit.gearIndex !== undefined && train ? train.entries[hit.gearIndex] : null;
        const g = entry?.gear;
        tooltip.textContent = g
          ? `${hit.label}\n模数 ${g.module} mm · 齿数 ${g.teeth}/${g.pinionTeeth}\n转速 ${Math.abs(entry!.rpm).toFixed(3)} rpm · 一圈 ${entry!.periodSec >= 60 ? (entry!.periodSec / 60).toFixed(2) + ' min' : entry!.periodSec.toFixed(2) + ' s'}`
          : `${hit.label}\n(非轮系零件)`;
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX - wrap.getBoundingClientRect().left + 14}px`;
        tooltip.style.top = `${e.clientY - wrap.getBoundingClientRect().top + 14}px`;
        setTimeout(() => { tooltip.style.display = 'none'; }, 4000);
      } else {
        tooltip.style.display = 'none';
      }
    }
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    renderer!.dist = Math.min(140, Math.max(18, renderer!.dist * (1 + e.deltaY * 0.001)));
  }, { passive: false });

  const ro = new ResizeObserver(() => renderer?.resize());
  ro.observe(wrap);

  renderer.start();

  // 页面卸载清理(由路由调用 cleanupDisplay)
  cleanupFns.push(() => {
    clearInterval(hudTimer);
    ro.disconnect();
    renderer?.stop();
  });
}

// 路由离开时调用
const cleanupFns: (() => void)[] = [];
export function cleanupDisplay(): void {
  while (cleanupFns.length) cleanupFns.pop()!();
}

function showWebGpuFallback(wrap: HTMLElement): void {
  const box = el('div', { id: 'webgpu-fallback' });
  const isSecure = window.isSecureContext;
  box.append(el('div', { class: 'box' }, [
    el('h2', {}, ['⚠ 当前环境不支持 WebGPU']),
    el('p', {}, ['本系统的机芯 3D 透视展示需要 WebGPU 支持。请尝试:']),
    el('ul', { style: 'text-align:left;line-height:2' }, [
      el('li', {}, ['使用 Chrome / Edge 113+ 或 Safari 18+(macOS / iOS)']),
      el('li', {}, ['确认显卡驱动为最新,未禁用硬件加速']),
      isSecure ? el('li', {}, ['当前为安全上下文 ✓']) : el('li', { class: 'bad' }, ['当前不是安全上下文(需 https 或 localhost)']),
      el('li', {}, ['仍不行可在 chrome://flags 搜索 "WebGPU" 手动开启']),
    ]),
    el('p', { class: 'muted' }, ['机芯列表、轮系编辑、打磨装饰等其他页面不受影响,可正常使用。']),
  ]));
  wrap.append(box);
}
