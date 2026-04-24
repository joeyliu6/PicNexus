/**
 * useMirrorFallback - 灯箱镜像 fallback 管理
 *
 * 职责：根据 HistoryItem.results + linkCheckStatus 推导出镜像管理所需的视图数据
 * （主图是否失效、是否有可用替代、每条镜像的状态），并提供"切换主服务"、
 * "删除镜像"两个动作的 composable 封装——统一处理缓存失效、跨窗口事件、
 * toast 反馈，调用方（灯箱）不用自己拼装副作用链。
 */
import { computed, type Ref } from 'vue';
import type { HistoryItem } from '../../config/types';
import { historyDB } from '../../services/HistoryDatabase';
import { emitHistoryUpdated } from '../../events/cacheEvents';
import { useHistoryManager } from '../useHistory';
import { useToast } from '../useToast';
import { useConfirm } from '../useConfirm';
import { createLogger } from '../../utils/logger';

const log = createLogger('MirrorFallback');

/**
 * 单条镜像的派生状态
 * - valid: linkCheck 通过
 * - invalid: linkCheck 明确失效
 * - unchecked: 还没跑过 linkCheck，或状态记录丢失
 */
export type MirrorCheckState = 'valid' | 'invalid' | 'unchecked';

export interface MirrorInfo {
  serviceId: string;
  url: string;
  isPrimary: boolean;
  checkState: MirrorCheckState;
  lastCheckTime?: number;
}

export function useMirrorFallback(item: Ref<HistoryItem | null>) {
  const toast = useToast();
  const { confirmDelete } = useConfirm();
  const historyManager = useHistoryManager();

  /** 全部成功上传的镜像 + 各自的 linkCheck 状态（主服务排首位） */
  const mirrors = computed<MirrorInfo[]>(() => {
    const cur = item.value;
    if (!cur) return [];
    const statusMap = cur.linkCheckStatus ?? {};
    const list: MirrorInfo[] = [];
    let primaryEntry: MirrorInfo | undefined;
    for (const r of cur.results) {
      if (r.status !== 'success' || !r.result?.url) continue;
      const status = statusMap[r.serviceId];
      const checkState: MirrorCheckState = status
        ? (status.isValid ? 'valid' : 'invalid')
        : 'unchecked';
      const info: MirrorInfo = {
        serviceId: r.serviceId,
        url: r.result.url,
        isPrimary: r.serviceId === cur.primaryService,
        checkState,
        lastCheckTime: status?.lastCheckTime,
      };
      if (info.isPrimary && !primaryEntry) {
        primaryEntry = info;
      } else {
        list.push(info);
      }
    }
    return primaryEntry ? [primaryEntry, ...list] : list;
  });

  /** 主图在 linkCheck 中被标记为失效（未检测不算） */
  const isPrimaryBroken = computed(() => {
    const primary = mirrors.value.find(m => m.isPrimary);
    return primary?.checkState === 'invalid';
  });

  /** 是否有至少一条非主服务的成功镜像——没有就没必要展示"管理镜像"按钮 */
  const hasAlternatives = computed(() => mirrors.value.some(m => !m.isPrimary));

  /** 所有镜像均已失效（包括主图）。用于触发"整条记录失效"提示 */
  const allMirrorsBroken = computed(() => {
    const list = mirrors.value;
    return list.length > 0 && list.every(m => m.checkState === 'invalid');
  });

  /**
   * 推荐切换到的镜像：优先选 linkCheck 通过的，其次选未检测的
   * 全部失效或没有备选时返回 undefined
   */
  const suggestedMirror = computed<MirrorInfo | undefined>(() => {
    const nonPrimary = mirrors.value.filter(m => !m.isPrimary);
    return (
      nonPrimary.find(m => m.checkState === 'valid') ??
      nonPrimary.find(m => m.checkState === 'unchecked')
    );
  });

  async function notifyUpdated(id: string): Promise<void> {
    historyManager.invalidateCache();
    try {
      await emitHistoryUpdated([id]);
    } catch (e) {
      log.warn('history-updated 事件发送失败:', e);
    }
  }

  /** 切换主服务到指定镜像 */
  async function switchPrimary(newServiceId: string): Promise<void> {
    const cur = item.value;
    if (!cur) return;
    if (cur.primaryService === newServiceId) return;

    try {
      await historyDB.switchPrimaryService(cur.id, newServiceId);
      await notifyUpdated(cur.id);
      toast.success('已切换主图床', '主图链接已更新为新镜像');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('切换主服务失败:', err);
      toast.error('切换失败', msg);
    }
  }

  /**
   * 删除某条镜像
   * - 若目标是当前主服务：先引导用户切换主服务（抛错由 UI 呈现）
   * - 带二次确认对话框
   */
  async function removeMirror(serviceId: string): Promise<void> {
    const cur = item.value;
    if (!cur) return;
    const target = mirrors.value.find(m => m.serviceId === serviceId);
    if (!target) return;

    if (target.isPrimary) {
      toast.warn('无法删除主服务', '请先切换到其他镜像再删除当前链接');
      return;
    }

    confirmDelete(
      `确定要删除此镜像链接吗？记录本身会保留，但 ${serviceId} 上的链接将从本条历史中移除。`,
      async () => {
        try {
          await historyDB.removeMirror(cur.id, serviceId);
          await notifyUpdated(cur.id);
          toast.success('镜像已删除', `${serviceId} 链接已从此记录中移除`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error('删除镜像失败:', err);
          toast.error('删除失败', msg);
        }
      }
    );
  }

  return {
    mirrors,
    isPrimaryBroken,
    hasAlternatives,
    allMirrorsBroken,
    suggestedMirror,
    switchPrimary,
    removeMirror,
  };
}
