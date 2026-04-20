// MD 文档救援 — 最近打开列表（MRU）
// 数据存在 localStorage，最多保留 5 项，可丢失不影响功能

import { ref, onMounted, onActivated } from 'vue';
import { createLogger } from '../../utils/logger';

const log = createLogger('MdRescue:MRU');

export interface MruEntry {
  path: string;
  kind: 'file' | 'folder';
  ts: number;
}

const STORAGE_KEY = 'mru.md-rescue';
const MAX_ENTRIES = 5;

function readStorage(): MruEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter((e): e is MruEntry =>
        !!e && typeof e.path === 'string' && (e.kind === 'file' || e.kind === 'folder') && typeof e.ts === 'number',
      )
      .slice(0, MAX_ENTRIES);
  } catch (err) {
    log.warn('读取 MRU 失败', err);
    return [];
  }
}

function writeStorage(list: MruEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    log.warn('写入 MRU 失败', err);
  }
}

// 模块级共享 ref：所有 useMdRescueMru() 调用共享同一引用
// 保证"清空最近打开"等操作在所有消费方之间同步
const sharedEntries = ref<MruEntry[]>([]);
let sharedInitialized = false;

function refreshShared(): void {
  sharedEntries.value = readStorage();
}

/**
 * 记录一条 MRU：已存在则前移，新项置顶，超上限截尾
 */
export function recordMruEntry(path: string, kind: 'file' | 'folder'): void {
  const list = readStorage();
  const filtered = list.filter((e) => e.path !== path);
  filtered.unshift({ path, kind, ts: Date.now() });
  writeStorage(filtered.slice(0, MAX_ENTRIES));
  refreshShared();
}

/**
 * 删除一条 MRU（用于"该路径已失效"的清理）
 */
export function removeMruEntry(path: string): void {
  const list = readStorage();
  const filtered = list.filter((e) => e.path !== path);
  writeStorage(filtered);
  refreshShared();
}

/**
 * 清空全部 MRU（用户主动点击"清空"触发）
 */
export function clearAllMruEntries(): void {
  writeStorage([]);
  refreshShared();
}

/**
 * 组件内使用：挂载 / 激活时读取 MRU
 */
export function useMdRescueMru() {
  if (!sharedInitialized) {
    refreshShared();
    sharedInitialized = true;
  }

  onMounted(refreshShared);
  onActivated(refreshShared);

  return { entries: sharedEntries, refresh: refreshShared };
}
