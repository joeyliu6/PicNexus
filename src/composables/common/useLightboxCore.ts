/**
 * useLightboxCore - 通用灯箱状态与公共操作
 *
 * 各视图（历史/收藏/时间轴）的灯箱实现差异主要在「索引/导航」逻辑，
 * 但共有的部分非常稳定：
 *   - 可见性 / 当前项的响应式状态
 *   - 加载详情 → 显示 / 失败 toast 的标准模式
 *   - 删除当前项 → 关灯箱 → toast 的标准模式
 *
 * 把这些公共部分集中到一处，确保未来调整 toast 文案、错误处理、关闭
 * 时机时只需改一处。各视图自己只关心「下一项是哪一项」。
 */

import { ref, type Ref } from 'vue';
import { useToast } from '../useToast';
import type { HistoryItem } from '../../config/types';

interface ToastLike {
  success: (msg: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
}

interface UseLightboxCoreOptions {
  /** 加载失败时是否吞掉异常（true：仅 toast，不向外抛） */
  silentLoadError?: boolean;
  /**
   * 自定义 toast（默认走全局 useToast）。
   * 用于父组件已经持有 toast 实例并希望统一传入时（例如 timeline 视图），
   * 避免二次 inject 或单元测试 mock 困难。
   */
  toast?: ToastLike;
}

export interface LightboxCoreApi {
  lightboxVisible: Ref<boolean>;
  lightboxItem: Ref<HistoryItem | null>;
  /** 关闭灯箱 */
  closeLightbox: () => void;
  /** 加载详情并打开灯箱（用于初次进入） */
  showItem: (loader: () => Promise<HistoryItem>) => Promise<void>;
  /** 仅加载详情、保持灯箱打开（用于翻页等场景） */
  loadItem: (loader: () => Promise<HistoryItem>) => Promise<void>;
  /** 标准删除流程：执行 → 关灯箱 → 成功 toast；失败 toast 不关 */
  deleteCurrent: (item: HistoryItem, deleteFn: (id: string) => Promise<unknown>) => Promise<void>;
}

export function useLightboxCore(options: UseLightboxCoreOptions = {}): LightboxCoreApi {
  const toast: ToastLike = options.toast ?? useToast();
  const lightboxVisible = ref(false);
  const lightboxItem = ref<HistoryItem | null>(null);

  function closeLightbox() {
    lightboxVisible.value = false;
  }

  async function showItem(loader: () => Promise<HistoryItem>): Promise<void> {
    try {
      lightboxItem.value = await loader();
      lightboxVisible.value = true;
    } catch (e) {
      toast.error('加载失败', String(e));
      if (!options.silentLoadError) throw e;
    }
  }

  async function loadItem(loader: () => Promise<HistoryItem>): Promise<void> {
    try {
      lightboxItem.value = await loader();
    } catch (e) {
      toast.error('加载失败', String(e));
      if (!options.silentLoadError) throw e;
    }
  }

  async function deleteCurrent(
    item: HistoryItem,
    deleteFn: (id: string) => Promise<unknown>,
  ): Promise<void> {
    try {
      await deleteFn(item.id);
      lightboxVisible.value = false;
      toast.success('已删除');
    } catch (e) {
      toast.error('删除失败', String(e));
    }
  }

  return {
    lightboxVisible,
    lightboxItem,
    closeLightbox,
    showItem,
    loadItem,
    deleteCurrent,
  };
}
