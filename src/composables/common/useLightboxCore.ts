/**
 * useLightboxCore - 通用灯箱状态与公共操作
 *
 * 灯箱实现的差异主要在「索引/导航」逻辑（见 useTimelineLightbox 的日内 + 跨日导航），
 * 共有的部分很稳定：
 *   - 可见性 / 当前项的响应式状态
 *   - 加载详情 → 显示 / 失败 toast 的标准模式
 *
 * 调用方只关心「下一项是哪一项」。
 */

import { ref, type Ref } from 'vue';
import { useToast } from '@/composables/useToast';
import type { HistoryItem } from '@/config/types';

interface ToastLike {
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

  return {
    lightboxVisible,
    lightboxItem,
    closeLightbox,
    showItem,
    loadItem,
  };
}
