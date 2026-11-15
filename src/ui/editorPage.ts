// 轮系编辑页:齿轮参数编辑 + 传动比自动计算
import { computeTrain, autoLayout, pitchRadius, pinionRadius } from '../train';
import { upsertMovement } from '../store';
import { getCurrentMovement, bumpSceneVersion, updateHeaderLabel } from '../appState';
import { el, numberInput, selectInput } from './dom';
import { GearType, uid } from '../types';

const GEAR_TYPES: { value: GearType; label: string }[] = [
  { value: 'barrel', label: '发条盒' },
  { value: 'center', label: '中心轮' },
  { value: 'third', label: '三轮' },
  { value: 'fourth', label: '秒轮(四轮)' },
  { value: 'escape', label: '擒纵轮' },
  { value: 'custom', label: '自定义' },
];

export function renderEditorPage(root: HTMLElement): void {
  const page = el('div', { class: 'page' });
  root.append(page);

  const redraw = () => {
    page.innerHTML = '';
    const m = getCurrentMovement();
    if (!m) {
      page.append(el('div', { class: 'empty-hint' }, ['请先在「机芯列表」创建或选择一个机芯']));
      return;
    }
    const mv = m; // 供闭包使用(TS 对函数声明内的捕获不做收窄)
    page.append(el('h2', {}, [`轮系编辑 — ${m.name}`]));

    // 基本参数
    const basic = el('div', { class: 'card' });
    basic.append(
      el('div', { class: 'row' }, [
        el('span', {}, ['摆频:']),
        selectInput(String(m.frequency) as '21600' | '28800', [
          { value: '21600', label: '21600 vph(3 Hz)' },
          { value: '28800', label: '28800 vph(4 Hz)' },
        ], v => { m.frequency = Number(v) as 21600 | 28800; save(); }),
        el('span', { class: 'muted' }, ['摆轮与擒纵按此频率摆动']),
      ]),
    );
    page.append(basic);

    // 齿轮表
    const table = el('table', { class: 'data' });
    table.append(el('tr', {}, ['名称', '类型', '模数 m', '轮片齿数', '齿轴齿数', '节圆⌀', 'X', 'Y', '秒轮', ''].map(t => el('th', {}, [t]))));
    m.gears.forEach((g, i) => {
      const tr = el('tr');
      const save1 = () => save();
      tr.append(
        el('td', {}, [(() => {
          const inp = el('input', { type: 'text', value: g.name, style: 'width:100px' }) as HTMLInputElement;
          inp.addEventListener('change', () => { g.name = inp.value; save1(); });
          return inp;
        })()]),
        el('td', {}, [selectInput(g.type, GEAR_TYPES, v => { g.type = v; save1(); })]),
        el('td', {}, [numberInput(g.module, v => { g.module = clamp(v, 0.05, 1); save1(); }, { min: 0.05, max: 1, step: 0.01 })]),
        el('td', {}, [numberInput(g.teeth, v => { g.teeth = Math.round(clamp(v, 6, 200)); save1(); }, { min: 6, max: 200, step: 1 })]),
        el('td', {}, [numberInput(g.pinionTeeth, v => { g.pinionTeeth = Math.round(clamp(v, 4, 30)); save1(); }, { min: 4, max: 30, step: 1 })]),
        el('td', { class: 'muted' }, [`${(pitchRadius(g) * 2).toFixed(2)} / ${(pinionRadius(g) * 2).toFixed(2)} mm`]),
        el('td', {}, [numberInput(g.x, v => { g.x = v; save1(); }, { step: 0.5 })]),
        el('td', {}, [numberInput(g.y, v => { g.y = v; save1(); }, { step: 0.5 })]),
        el('td', {}, [(() => {
          const radio = el('input', { type: 'radio', name: 'seconds-wheel' }) as HTMLInputElement;
          radio.checked = g.isSecondsWheel;
          radio.addEventListener('change', () => {
            m.gears.forEach(x => { x.isSecondsWheel = x.id === g.id; });
            save1();
          });
          return radio;
        })()]),
        el('td', {}, [(() => {
          const b = el('button', { class: 'danger' }, ['删']);
          b.onclick = () => { m.gears.splice(i, 1); save(); };
          return b;
        })()]),
      );
      table.append(tr);
    });
    const addRow = el('div', { class: 'row', style: 'margin-top:10px' }, [
      (() => { const b = el('button', {}, ['+ 添加齿轮']); b.onclick = () => {
        m.gears.push({
          id: uid(), name: `齿轮 ${m.gears.length + 1}`, type: 'custom',
          module: 0.14, teeth: 60, pinionTeeth: 10, x: 0, y: 0, isSecondsWheel: false,
        });
        save();
      }; return b; })(),
      (() => { const b = el('button', {}, ['自动布局']); b.onclick = () => { autoLayout(m.gears); save(); }; return b; })(),
      el('span', { class: 'muted' }, ['传动方向:列表自上而下为增速方向(前一级轮片驱动后一级齿轴)']),
    ]);
    page.append(el('div', { class: 'card', style: 'padding:0;overflow-x:auto' }, [table]), addRow);

    // 传动比计算结果
    const train = computeTrain(m.gears);
    const result = el('div', { class: 'card' });
    result.append(el('h3', {}, ['传动比计算(秒轮锚定 60s/圈)']));
    const rt = el('table', { class: 'data' });
    rt.append(el('tr', {}, ['齿轮', '转速 rpm', '转一圈耗时', '相对上级增速比', '转向'].map(t => el('th', {}, [t]))));
    for (const e of train.entries) {
      rt.append(el('tr', {}, [
        el('td', {}, [e.gear.name + (e.gear.isSecondsWheel ? ' ⏱' : '')]),
        el('td', {}, [Math.abs(e.rpm) < 0.01 ? e.rpm.toExponential(2) : Math.abs(e.rpm).toFixed(4)]),
        el('td', {}, [formatPeriod(e.periodSec)]),
        el('td', {}, [e.ratioToPrevious ? `×${e.ratioToPrevious.toFixed(3)}` : '—']),
        el('td', {}, [e.omega < 0 ? '顺时针' : '逆时针']),
      ]));
    }
    result.append(rt);

    // 摆频一致性校验
    const check = el('div', { style: 'margin-top:12px' });
    if (train.impliedVph !== null) {
      const diff = Math.abs(train.impliedVph - m.frequency) / m.frequency;
      const cls = diff < 0.005 ? 'ok' : diff < 0.03 ? 'warn' : 'bad';
      check.append(
        el('div', { class: cls }, [
          `轮系推算摆频:${train.impliedVph.toFixed(0)} vph,设定摆频:${m.frequency} vph,偏差 ${(diff * 100).toFixed(2)}%`,
        ]),
      );
      if (diff >= 0.005) {
        // 建议:调整擒纵轮齿轴齿数
        const escIdx = m.gears.findIndex(g => g.type === 'escape');
        if (escIdx > 0) {
          const need = train.impliedVph / m.frequency;
          const cur = m.gears[escIdx].pinionTeeth;
          const suggest = Math.max(4, Math.round(cur * need));
          check.append(el('div', { class: 'muted' }, [
            `建议:擒纵轮齿轴齿数由 ${cur} 改为 ${suggest}(当前秒轮→擒纵轮增速比 ×${(train.entries[escIdx].ratioToPrevious ?? 0).toFixed(2)})`,
          ]));
        }
      }
    } else {
      check.append(el('div', { class: 'muted' }, ['没有擒纵轮,无法校验摆频一致性']));
    }
    check.append(el('div', { class: 'ok' }, [`✓ 秒针一圈正好 ${train.secondsPeriod} 秒(解析锚定,与帧率无关)`]));
    result.append(check);
    page.append(result);

    function save(): void {
      upsertMovement(mv);
      bumpSceneVersion();
      updateHeaderLabel();
      redraw();
    }
  };
  redraw();
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function formatPeriod(sec: number): string {
  if (!Number.isFinite(sec)) return '—';
  if (sec < 1) return `${(sec * 1000).toFixed(0)} ms`;
  if (sec < 120) return `${sec.toFixed(2)} s`;
  if (sec < 7200) return `${(sec / 60).toFixed(2)} min`;
  return `${(sec / 3600).toFixed(2)} h`;
}
