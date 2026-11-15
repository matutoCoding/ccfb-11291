// 跨页面共享状态
import type { MovementConfig } from './types';
import { getCurrentId, getMovement, setCurrentId, loadMovements } from './store';
import type { MovementRenderer } from './renderer';

let sceneVersion = 0;
export function bumpSceneVersion(): void { sceneVersion++; }
export function getSceneVersion(): number { return sceneVersion; }

// 渲染器单例(展示页持有,离开页面仅停帧不销毁)
export const rendererHolder: { current: MovementRenderer | null } = { current: null };

export function getCurrentMovement(): MovementConfig | null {
  const cur = getMovement(getCurrentId());
  if (cur) return cur;
  const list = loadMovements();
  if (list.length > 0) {
    setCurrentId(list[0].id);
    return list[0];
  }
  return null;
}

export function setCurrentMovement(id: string): void {
  setCurrentId(id);
  bumpSceneVersion();
  updateHeaderLabel();
}

export function updateHeaderLabel(): void {
  const el = document.getElementById('current-movement-label');
  if (!el) return;
  const m = getCurrentMovement();
  el.innerHTML = m ? `当前机芯:<b>${escapeHtml(m.name)}</b> · ${m.frequency} vph` : '尚未选择机芯';
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
