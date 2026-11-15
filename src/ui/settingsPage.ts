// 设置页:WebGPU 状态、渲染质量、走时精度自检、数据管理
import { loadSettings, saveSettings, exportAll, parseImport, importMovements } from '../store';
import { bumpSceneVersion } from '../appState';
import { el, fieldRow, selectInput, rangeInput, checkboxInput } from './dom';
import { resetToDefault } from './listPage';

export function renderSettingsPage(root: HTMLElement): void {
  const settings = loadSettings();
  const save = () => saveSettings(settings);

  const page = el('div', { class: 'page' });
  page.append(el('h2', {}, ['设置']));

  // WebGPU 状态
  const gpu = el('div', { class: 'card' });
  gpu.append(el('h3', {}, ['WebGPU 状态']));
  const statusEl = el('div', {}, ['检测中…']);
  gpu.append(statusEl);
  (async () => {
    if (!navigator.gpu) {
      statusEl.innerHTML = '<span class="bad">✗ 浏览器不支持 WebGPU(navigator.gpu 不存在)</span>';
      return;
    }
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) {
        statusEl.innerHTML = '<span class="bad">✗ 无法获取 WebGPU 适配器</span>';
        return;
      }
      const info = (adapter as unknown as { info?: { vendor?: string; architecture?: string; description?: string } }).info;
      statusEl.innerHTML = `<span class="ok">✓ WebGPU 可用</span> <span class="muted">${info?.vendor ?? ''} ${info?.architecture ?? ''} ${info?.description ?? ''}</span>`;
    } catch (e) {
      statusEl.innerHTML = `<span class="bad">✗ ${e instanceof Error ? e.message : String(e)}</span>`;
    }
  })();

  // 渲染质量
  const quality = el('div', { class: 'card' });
  quality.append(el('h3', {}, ['渲染质量(重新进入「展示」页生效)']));
  quality.append(
    fieldRow('抗锯齿 MSAA', selectInput(String(settings.msaa) as '1' | '4', [
      { value: '4', label: '4×(推荐,防高光闪烁)' },
      { value: '1', label: '关闭(低性能设备)' },
    ], v => { settings.msaa = Number(v) as 1 | 4; save(); })),
    fieldRow(`渲染分辨率 ${(settings.resolutionScale * 100).toFixed(0)}%`, rangeInput(settings.resolutionScale, 0.5, 2, 0.1, v => { settings.resolutionScale = v; save(); })),
    fieldRow('显示走时精度 HUD', checkboxInput(settings.showTimingHud, v => { settings.showTimingHud = v; save(); })),
  );

  // 走时精度自检
  const timing = el('div', { class: 'card' });
  timing.append(el('h3', {}, ['走时精度自检']));
  timing.append(el('p', { class: 'muted' }, [
    '原理:模拟时间直接由 performance.now() 单调时钟驱动,所有轮系角度为时间的解析函数,不逐帧积分,因此不存在累积漂移。下面实测本机 performance.now() 与系统时钟(Date.now)的相对偏差,并推算 10 分钟误差。',
  ]));
  const testOut = el('div', {}, ['']);
  const testBtn = el('button', { class: 'primary' }, ['开始 10 秒实测']);
  testBtn.onclick = () => {
    testBtn.disabled = true;
    const p0 = performance.now(), d0 = Date.now();
    const samples: string[] = [];
    const timer = setInterval(() => {
      const p = performance.now(), d = Date.now();
      const perfElapsed = p - p0;
      const dateElapsed = d - d0;
      const driftMs = dateElapsed - perfElapsed;
      samples.push(`+${(perfElapsed / 1000).toFixed(1)}s  偏差 ${driftMs.toFixed(1)} ms`);
      testOut.textContent = samples.join('\n');
      if (perfElapsed >= 10000) {
        clearInterval(timer);
        const ppm = (driftMs / perfElapsed) * 1e6;
        const projected10min = Math.abs(driftMs) * 60; // 10s → 600s
        testOut.textContent = samples.join('\n') +
          `\n\n相对偏差 ${ppm.toFixed(1)} ppm,推算 10 分钟误差约 ${projected10min.toFixed(0)} ms` +
          (projected10min < 100 ? '\n✓ 满足 10 分钟 < 100 ms 指标' : '\n⚠ 超出指标(系统时钟源异常,建议更换浏览器/设备复测)');
        testBtn.disabled = false;
      }
    }, 1000);
  };
  testOut.style.whiteSpace = 'pre';
  testOut.style.fontFamily = 'ui-monospace, Consolas, monospace';
  testOut.style.fontSize = '12px';
  timing.append(testBtn, testOut);

  // 数据管理
  const data = el('div', { class: 'card' });
  data.append(el('h3', {}, ['数据管理']));
  const fileInput = el('input', { type: 'file', accept: '.json', style: 'display:none' }) as HTMLInputElement;
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const n = importMovements(parseImport(await f.text()));
      alert(`成功导入 ${n} 个机芯`);
      bumpSceneVersion();
    } catch (e) {
      alert(`导入失败:${e instanceof Error ? e.message : String(e)}`);
    }
    fileInput.value = '';
  });
  const exportBtn = el('button', {}, ['导出全部备份']);
  exportBtn.onclick = () => exportAll();
  const importBtn = el('button', {}, ['导入备份 / 机芯']);
  importBtn.onclick = () => fileInput.click();
  const resetBtn = el('button', { class: 'danger' }, ['清空并恢复默认']);
  resetBtn.onclick = () => {
    if (confirm('将删除所有机芯方案并恢复出厂默认,确定?')) {
      localStorage.clear();
      resetToDefault();
      location.reload();
    }
  };
  data.append(el('div', { class: 'row' }, [exportBtn, importBtn, resetBtn]), fileInput,
    el('p', { class: 'muted' }, ['所有数据仅保存在本浏览器 localStorage,清除浏览器数据会丢失,请定期导出备份。']));

  page.append(gpu, quality, timing, data);
  root.append(page);
}
