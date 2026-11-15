// localStorage 持久化 + 导入导出
import type { AppSettings, MovementConfig } from './types';
import { DEFAULT_SETTINGS } from './types';
import { createDefaultMovement } from './train';

const KEY_MOVEMENTS = 'mw.movements.v1';
const KEY_SETTINGS = 'mw.settings.v1';
const KEY_CURRENT = 'mw.current.v1';

function readJson<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function loadMovements(): MovementConfig[] {
  const list = readJson<MovementConfig[]>(KEY_MOVEMENTS);
  if (list && Array.isArray(list) && list.length > 0) return list;
  // 首次使用:内置一个默认机芯
  const def = createDefaultMovement();
  saveMovements([def]);
  return [def];
}

export function saveMovements(list: MovementConfig[]): void {
  localStorage.setItem(KEY_MOVEMENTS, JSON.stringify(list));
}

export function upsertMovement(m: MovementConfig): void {
  const list = loadMovements();
  const i = list.findIndex(x => x.id === m.id);
  m.updatedAt = Date.now();
  if (i >= 0) list[i] = m; else list.push(m);
  saveMovements(list);
}

export function deleteMovement(id: string): void {
  saveMovements(loadMovements().filter(m => m.id !== id));
  if (getCurrentId() === id) setCurrentId(null);
}

export function getMovement(id: string | null): MovementConfig | null {
  if (!id) return null;
  return loadMovements().find(m => m.id === id) ?? null;
}

export function getCurrentId(): string | null {
  return readJson<string>(KEY_CURRENT);
}
export function setCurrentId(id: string | null): void {
  if (id === null) localStorage.removeItem(KEY_CURRENT);
  else localStorage.setItem(KEY_CURRENT, JSON.stringify(id));
}

export function loadSettings(): AppSettings {
  return { ...DEFAULT_SETTINGS, ...(readJson<Partial<AppSettings>>(KEY_SETTINGS) ?? {}) };
}
export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY_SETTINGS, JSON.stringify(s));
}

// ---------- 导入导出 ----------

export function exportMovement(m: MovementConfig): void {
  downloadJson(m, `${m.name.replace(/[\\/:*?"<>|]/g, '_')}.movement.json`);
}

export function exportAll(): void {
  downloadJson({ format: 'movement-explorer-backup', version: 1, movements: loadMovements(), settings: loadSettings() }, 'movements-backup.json');
}

function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** 解析导入的 JSON,返回导入的机芯列表(校验基本字段) */
export function parseImport(text: string): MovementConfig[] {
  const data = JSON.parse(text);
  const arr: unknown[] = Array.isArray(data) ? data
    : Array.isArray(data?.movements) ? data.movements
    : data?.gears ? [data]
    : [];
  const out: MovementConfig[] = [];
  for (const item of arr) {
    const m = item as MovementConfig;
    if (m && typeof m.name === 'string' && Array.isArray(m.gears) && typeof m.frequency === 'number') {
      // 重新分配 id 避免冲突
      out.push({ ...m, id: m.id || crypto.randomUUID() });
    }
  }
  if (out.length === 0) throw new Error('文件中没有可识别的机芯数据');
  return out;
}

export function importMovements(list: MovementConfig[]): number {
  const existing = loadMovements();
  const ids = new Set(existing.map(m => m.id));
  let n = 0;
  for (const m of list) {
    if (ids.has(m.id)) m.id = crypto.randomUUID();
    existing.push(m); n++;
  }
  saveMovements(existing);
  return n;
}
