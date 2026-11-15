// 打磨装饰页:夹板纹饰、拉丝、倒角、蓝钢螺丝、红宝石
import { upsertMovement } from '../store';
import { getCurrentMovement, bumpSceneVersion } from '../appState';
import { el, fieldRow, selectInput, rangeInput, numberInput, checkboxInput } from './dom';
import { BridgeFinish, WheelFinish } from '../types';

export function renderFinishPage(root: HTMLElement): void {
  const m = getCurrentMovement();
  if (!m) {
    root.append(el('div', { class: 'page' }, [el('div', { class: 'empty-hint' }, ['请先在「机芯列表」创建或选择一个机芯'])]));
    return;
  }
  const fin = m.finishing;
  const save = () => { upsertMovement(m); bumpSceneVersion(); };
  const redraw = () => { root.innerHTML = ''; renderFinishPage(root); };

  const page = el('div', { class: 'page' });
  page.append(el('h2', {}, [`打磨装饰 — ${m.name}`]),
    el('p', { class: 'muted' }, ['调整后到「展示」页查看效果;拉丝反光在物体局部空间解析计算,随零件旋转,转动时不会闪烁。']));

  // 夹板
  const bridge = el('div', { class: 'card' });
  bridge.append(el('h3', {}, ['夹板纹饰']));
  bridge.append(fieldRow('纹饰工艺', selectInput(fin.bridgeFinish, [
    { value: 'geneva', label: '日内瓦波纹(Côtes de Genève)' },
    { value: 'perlage', label: '珍珠圆点纹(Perlage)' },
    { value: 'brushedCircular', label: '环形拉丝' },
    { value: 'brushedLinear', label: '直线拉丝' },
    { value: 'polished', label: '镜面抛光' },
  ], (v: BridgeFinish) => { fin.bridgeFinish = v; save(); redraw(); })));
  if (fin.bridgeFinish === 'geneva') {
    bridge.append(
      fieldRow(`条纹宽度 ${fin.genevaStripeWidth.toFixed(1)} mm`, rangeInput(fin.genevaStripeWidth, 1, 8, 0.1, v => { fin.genevaStripeWidth = v; save(); redraw(); })),
      fieldRow(`条纹角度 ${fin.genevaAngle.toFixed(0)}°`, rangeInput(fin.genevaAngle, -45, 45, 1, v => { fin.genevaAngle = v; save(); redraw(); })),
    );
  }
  if (fin.bridgeFinish === 'perlage') {
    bridge.append(fieldRow(`圆点直径 ${fin.perlageSize.toFixed(1)} mm`, rangeInput(fin.perlageSize, 0.6, 4, 0.1, v => { fin.perlageSize = v; save(); redraw(); })));
  }
  if (fin.bridgeFinish === 'brushedLinear') {
    bridge.append(fieldRow(`拉丝方向 ${fin.brushAngle.toFixed(0)}°`, rangeInput(fin.brushAngle, 0, 180, 1, v => { fin.brushAngle = v; save(); redraw(); })));
  }
  bridge.append(
    fieldRow(`各向异性强度 ${(fin.anisotropy * 100).toFixed(0)}%`, rangeInput(fin.anisotropy, 0, 1, 0.01, v => { fin.anisotropy = v; save(); })),
    fieldRow('倒角抛光(镜面倒角边)', checkboxInput(fin.chamferPolished, v => { fin.chamferPolished = v; save(); })),
  );

  // 齿轮
  const wheels = el('div', { class: 'card' });
  wheels.append(el('h3', {}, ['齿轮']));
  wheels.append(fieldRow('轮片表面', selectInput(fin.wheelFinish, [
    { value: 'brushedCircular', label: '环形拉丝' },
    { value: 'sunray', label: '太阳放射纹' },
    { value: 'polished', label: '镜面抛光' },
  ], (v: WheelFinish) => { fin.wheelFinish = v; save(); })));

  // 细节
  const detail = el('div', { class: 'card' });
  detail.append(el('h3', {}, ['细节']));
  detail.append(
    fieldRow('蓝钢螺丝(回火色)', checkboxInput(fin.bluedScrews, v => { fin.bluedScrews = v; save(); })),
    fieldRow('红宝石轴承(透光)', checkboxInput(fin.rubyJewels, v => { fin.rubyJewels = v; save(); })),
    fieldRow(`表镜反光强度 ${(fin.glassReflection * 100).toFixed(0)}%`, rangeInput(fin.glassReflection, 0, 1, 0.01, v => { fin.glassReflection = v; save(); })),
  );

  // 摆轮位置
  const layout = el('div', { class: 'card' });
  layout.append(el('h3', {}, ['布局']));
  layout.append(
    fieldRow('摆轮 X (mm)', numberInput(m.balancePosition.x, v => { m.balancePosition.x = v; save(); }, { step: 0.5 })),
    fieldRow('摆轮 Y (mm)', numberInput(m.balancePosition.y, v => { m.balancePosition.y = v; save(); }, { step: 0.5 })),
  );

  page.append(el('div', { class: 'grid2' }, [bridge, wheels, detail, layout]));
  root.append(page);
}
