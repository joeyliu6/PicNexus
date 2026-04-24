import { ref, watch, onUnmounted, type Ref } from 'vue';
import type { HistoryItem, ServiceType } from '../../config/types';
import { useToast } from '../useToast';
import { useCopyLink } from '../useCopyLink';
import { useConfirm } from '../useConfirm';
import { createLogger } from '../../utils/logger';

const logger = createLogger('LightboxActions');
const COPY_FEEDBACK_DURATION = 2000;

interface LightboxActionsOptions {
  item: Ref<HistoryItem | null>;
  resetZoom: () => void;
  onDelete: (item: HistoryItem) => void;
}

export function useLightboxActions({ item, resetZoom, onDelete }: LightboxActionsOptions) {
  const toast = useToast();
  const { copyLink: copyLinkAction, applyConfiguredUrl } = useCopyLink();
  const { confirmDelete } = useConfirm();
  const copySuccess = ref(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  // 切换图片时重置反馈状态
  watch(item, () => {
    copySuccess.value = false;
    if (copyTimer) {
      clearTimeout(copyTimer);
      copyTimer = null;
    }
  });

  function showCopyFeedback() {
    copySuccess.value = true;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      copySuccess.value = false;
      copyTimer = null;
    }, COPY_FEEDBACK_DURATION);
  }

  function requireLink(): { link: string; record: HistoryItem } | null {
    const link = item.value?.generatedLink;
    if (!link || !item.value) {
      toast.warn('无可用链接', '该项目没有可用的链接');
      return null;
    }
    return { link, record: item.value };
  }

  async function handleCopyLink() {
    const ctx = requireLink();
    if (!ctx) return;
    const result = await copyLinkAction({
      url: ctx.link,
      fileName: ctx.record.localFileName,
      serviceId: ctx.record.primaryService as ServiceType,
      width: ctx.record.width,
      height: ctx.record.height,
    }, { showSuccessToast: false });
    if (result.ok) showCopyFeedback();
  }

  async function handleCopyServiceLink(serviceId: string) {
    if (!item.value) return;
    const serviceResult = item.value.results.find(
      r => r.serviceId === serviceId && r.status === 'success',
    );
    if (!serviceResult?.result?.url) {
      toast.warn('无可用链接', '该图床没有可用的链接');
      return;
    }
    const result = await copyLinkAction({
      url: serviceResult.result.url,
      fileName: item.value.localFileName,
      serviceId: serviceId as ServiceType,
      width: item.value.width,
      height: item.value.height,
    }, { showSuccessToast: false });
    if (result.ok) showCopyFeedback();
  }

  async function openInBrowser() {
    const ctx = requireLink();
    if (!ctx) return;
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      const finalUrl = applyConfiguredUrl(ctx.link, ctx.record.primaryService as ServiceType);
      await open(finalUrl);
    } catch (err) {
      logger.error('打开链接失败:', err);
      toast.error('打开失败', String(err));
    }
  }

  function handleDelete() {
    if (!item.value) return;
    resetZoom();
    const current = item.value;
    confirmDelete('确定要删除这条历史记录吗？此操作不可撤销。', () => {
      onDelete(current);
    });
  }

  onUnmounted(() => {
    if (copyTimer) { clearTimeout(copyTimer); copyTimer = null; }
  });

  return { handleCopyLink, handleCopyServiceLink, copySuccess, openInBrowser, handleDelete };
}
