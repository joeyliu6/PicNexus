import type { Ref } from 'vue';
import type { HistoryItem, ServiceType } from '../../config/types';
import { useToast } from '../useToast';
import { useCopyLink } from '../useCopyLink';
import { useConfirm } from '../useConfirm';
import { createLogger } from '../../utils/logger';

const logger = createLogger('LightboxActions');

interface LightboxActionsOptions {
  item: Ref<HistoryItem | null>;
  resetZoom: () => void;
  onDelete: (item: HistoryItem) => void;
}

export function useLightboxActions({ item, resetZoom, onDelete }: LightboxActionsOptions) {
  const toast = useToast();
  const { copyLink: copyLinkAction, applyPrefix } = useCopyLink();
  const { confirmDelete } = useConfirm();

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
    await copyLinkAction({
      url: ctx.link,
      fileName: ctx.record.localFileName,
      serviceId: ctx.record.primaryService as ServiceType,
      width: ctx.record.width,
      height: ctx.record.height,
    });
  }

  async function openInBrowser() {
    const ctx = requireLink();
    if (!ctx) return;
    try {
      const { open } = await import('@tauri-apps/plugin-shell');
      const finalUrl = applyPrefix(ctx.link, ctx.record.primaryService as ServiceType);
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

  return { handleCopyLink, openInBrowser, handleDelete };
}
