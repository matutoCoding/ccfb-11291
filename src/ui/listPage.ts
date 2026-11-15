// 机芯列表页:增删改、设为当前、导入导出
import { loadMovements, deleteMovement, upsertMovement, exportMovement, exportAll, parseImport, importMovements, saveMovements } from '../store';
import { createDefaultMovement } from '../train';
import { setCurrentMovement, getCurrentMovement, updateHeaderLabel, bumpSceneVersion } from '../appState';
import { el } from './dom';
import { uid } from '../types';

export function renderListPage(root: HTMLElement): void {
  const page = el('div', { class: 'page' });
  root.append(page);

  const redraw = () => {
    page.innerHTML = '';
    const list = loadMovements();
    const current = getCurrentMovement();

    const toolbar = el('div', { class: 'row' }, [
      (() => { const b = el('button', { class: 'primary' }, ['+ 新建机芯']); b.onclick = () => {
        const m = createDefaultMovement(`Cal. 新机芯 ${list.length + 1}`);
        upsertMovement(m);
        setCurrentMovement(m.id);
        redraw();
      }; return b; })(),
      (() => { const b = el('button', {}, ['导入 JSON']); b.onclick = () => fileInput.click(); return b; })(),
      (() => { const b = el('button', {}, ['导出全部备份']); b.onclick = () => exportAll(); return b; })(),
      el('span', { class: 'muted' }, ['数据保存在浏览器 localStorage,可导出 JSON 备份']),
    ]);
    const fileInput = el('input', { type: 'file', accept: '.json', style: 'display:none' }) as HTMLInputElement;
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      try {
        const n = importMovements(parseImport(await f.text()));
        alert(`成功导入 ${n} 个机芯`);
        bumpSceneVersion();
        redraw();
      } catch (e) {
        alert(`导入失败:${e instanceof Error ? e.message : String(e)}`);
      }
      fileInput.value = '';
    });
    page.append(el('h2', {}, ['机芯方案']), toolbar, fileInput);

    if (list.length === 0) {
      page.append(el('div', { class: 'empty-hint' }, ['还没有机芯方案,点击"新建机芯"开始']));
      return;
    }

    const table = el('table', { class: 'data' });
    table.append(el('tr', {}, ['名称', '摆频', '齿轮数', '打磨', '更新时间', '操作'].map(t => el('th', {}, [t]))));
    for (const m of list) {
      const tr = el('tr', m.id === current?.id ? { class: 'current' } : {});
      const nameCell = el('td', {});
      const nameInput = el('input', { type: 'text', value: m.name, style: 'width:160px' }) as HTMLInputElement;
      nameInput.addEventListener('change', () => {
        m.name = nameInput.value.trim() || m.name;
        upsertMovement(m); bumpSceneVersion(); updateHeaderLabel();
      });
      nameCell.append(nameInput);

      const ops = el('td', {});
      const mkBtn = (label: string, fn: () => void, cls = '') => {
        const b = el('button', cls ? { class: cls } : {}, [label]);
        b.style.marginRight = '6px';
        b.onclick = fn;
        return b;
      };
      ops.append(
        mkBtn(m.id === current?.id ? '✓ 当前' : '设为当前', () => { setCurrentMovement(m.id); redraw(); }),
        mkBtn('编辑轮系', () => { setCurrentMovement(m.id); location.hash = '#/editor'; }),
        mkBtn('复制', () => {
          const copy = { ...JSON.parse(JSON.stringify(m)), id: uid(), name: m.name + ' 副本' };
          copy.gears.forEach((g: { id: string }) => { g.id = uid(); });
          upsertMovement(copy); redraw();
        }),
        mkBtn('导出', () => exportMovement(m)),
        mkBtn('删除', () => {
          if (confirm(`确定删除「${m.name}」?`)) { deleteMovement(m.id); bumpSceneVersion(); updateHeaderLabel(); redraw(); }
        }, 'danger'),
      );
      tr.append(
        nameCell,
        el('td', {}, [String(m.frequency)]),
        el('td', {}, [String(m.gears.length)]),
        el('td', {}, [finishLabel(m.finishing.bridgeFinish)]),
        el('td', { class: 'muted' }, [new Date(m.updatedAt).toLocaleString()]),
        ops,
      );
      table.append(tr);
    }
    page.append(el('div', { class: 'card', style: 'margin-top:16px;padding:0;overflow:hidden' }, [table]));
    updateHeaderLabel();
  };
  redraw();
}

function finishLabel(f: string): string {
  return { geneva: '日内瓦波纹', perlage: '珍珠圆点', brushedCircular: '环形拉丝', brushedLinear: '直线拉丝', polished: '镜面抛光' }[f] ?? f;
}

// 供设置页清空数据后重置
export function resetToDefault(): void {
  saveMovements([createDefaultMovement()]);
  bumpSceneVersion();
}
