/**
 * useMirrorFallback - 灯箱多图床备份管理
 *
 * 职责：把 HistoryItem.results + linkCheckStatus 推导成"图床备份列表"视图数据
 * （哪个是主图床、每条备份的链接是否有效），并封装"切换主图床 / 移除此链接
 * / 重新检测此链接"三个动作——统一处理 DB 写入、缓存失效、跨窗口事件和
 * toast 反馈。
 *
 * 命名：对外文案用"图床/备份"口径；内部类型名和函数名保留 mirror 词源，
 * 和 docs/flows/mirror-fallback-flow.md 的技术术语一致。
 */
import { computed, ref, watch, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { HistoryItem } from '../../config/types';
import type { CheckLinkResult } from '../../types/linkCheck';
import { historyDB } from '../../services/HistoryDatabase';
import { recomputeLinkCheckSummary } from '../../types/linkCheckSummary';
import { emitHistoryUpdated } from '../../events/cacheEvents';
import { useHistoryManager } from '../useHistory';
import { useToast } from '../useToast';
import { useConfirm } from '../useConfirm';
import { createLogger } from '../../utils/logger';

const log = createLogger('MirrorFallback');

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

  /** 正在检测的 serviceId 集合（UI 用来把 chip 切成 loading 态） */
  const checkingServices = ref<Set<string>>(new Set());

  /**
   * 切主图床的乐观主图床 ID。
   * 点击"设为主"后立即写入，让 mirrors 计算态把圆点移到目标行（无须等 DB 落库
   * + emitHistoryUpdated + 父组件 props 刷新一整圈）。DB 写成功后、props 更新到
   * 一致状态时清空；写失败则清空回退到旧主图床。
   */
  const optimisticPrimary = ref<string | null>(null);

  /**
   * 本地 linkCheck 状态覆盖层。
   * 父组件传入的 props.item 是个 snapshot ref，并不监听 history-updated 事件，
   * 因此 DB 写完后 props.item.linkCheckStatus 不会自动刷新——单条重新检测的结果
   * 也就反映不到 chip 上。这里维护一份"checkMirror 刚刚跑出来"的本地结果，
   * mirrors 计算态优先用它。等 props.item 真的追上同样的状态时，watch 自动清掉。
   */
  type LinkCheckEntry = NonNullable<HistoryItem['linkCheckStatus']>[string];
  const localStatusOverride = ref<Record<string, LinkCheckEntry>>({});

  // props.item 刷新到目标主图床（DB 已落库回流）后清掉乐观态，避免它残留干扰后续切换。
  // 切到下一张图（item.id 变）时也立即清空。
  watch(
    () => [item.value?.id, item.value?.primaryService] as const,
    ([, primary], [prevId]) => {
      if (item.value?.id !== prevId) {
        optimisticPrimary.value = null;
        return;
      }
      if (optimisticPrimary.value && primary === optimisticPrimary.value) {
        optimisticPrimary.value = null;
      }
    },
  );

  // props.item 跟上 localStatusOverride 后逐条清掉本地副本；切到下一张图整体清空。
  watch(
    () => [item.value?.id, item.value?.linkCheckStatus] as const,
    ([currentId, statusMap], [prevId]) => {
      if (currentId !== prevId) {
        localStatusOverride.value = {};
        return;
      }
      const overrides = localStatusOverride.value;
      const overrideKeys = Object.keys(overrides);
      if (overrideKeys.length === 0) return;
      const next: Record<string, LinkCheckEntry> = {};
      let changed = false;
      for (const sid of overrideKeys) {
        const incoming = statusMap?.[sid];
        const local = overrides[sid];
        // 同时间戳同 isValid 视为 props 已追上 → 这条 override 失效
        if (incoming
          && incoming.lastCheckTime === local.lastCheckTime
          && incoming.isValid === local.isValid) {
          changed = true;
          continue;
        }
        next[sid] = local;
      }
      if (changed) localStatusOverride.value = next;
    },
    { deep: true },
  );

  /**
   * checkMirror 的 DB 写入串行队列。
   * 不同 serviceId 的 invoke('check_image_link') 仍然并行（网络无序），但落库前
   * 通过这条链排队。原因：historyDB.update 内部是 read-modify-write + 浅合并，
   * 两个并发回写都拿同一份 baseline 后写回，会让先写的那条结果被后写的整体覆盖。
   */
  let dbWriteQueue: Promise<unknown> = Promise.resolve();

  /**
   * 全部成功上传的图床备份 + 各自 linkCheck 状态。
   * 顺序严格按 results 原序——切换主图床时行不动位，仅圆点跳到目标行。
   * 状态优先取 localStatusOverride（刚刚单条检测的结果），其次取 props 上的 linkCheckStatus。
   */
  const mirrors = computed<MirrorInfo[]>(() => {
    const cur = item.value;
    if (!cur) return [];
    const propsStatus = cur.linkCheckStatus ?? {};
    const overrides = localStatusOverride.value;
    // 乐观主图床仅在它确实存在于成功镜像中时生效（防止陈旧 ID 让所有行都不是主）
    const successIds = new Set(
      cur.results.filter(r => r.status === 'success' && r.result?.url).map(r => r.serviceId),
    );
    const effectivePrimary = optimisticPrimary.value && successIds.has(optimisticPrimary.value)
      ? optimisticPrimary.value
      : cur.primaryService;
    const list: MirrorInfo[] = [];
    for (const r of cur.results) {
      if (r.status !== 'success' || !r.result?.url) continue;
      const status = overrides[r.serviceId] ?? propsStatus[r.serviceId];
      const checkState: MirrorCheckState = status
        ? (status.isValid ? 'valid' : 'invalid')
        : 'unchecked';
      list.push({
        serviceId: r.serviceId,
        url: r.result.url,
        isPrimary: r.serviceId === effectivePrimary,
        checkState,
        lastCheckTime: status?.lastCheckTime,
      });
    }
    return list;
  });

  /** 主图床在 linkCheck 中被标记为失效（未检测不算） */
  const isPrimaryBroken = computed(() => {
    const primary = mirrors.value.find(m => m.isPrimary);
    return primary?.checkState === 'invalid';
  });

  /** 是否有至少一条非主图床的成功备份——没有就没必要展示"图床管理"按钮 */
  const hasAlternatives = computed(() => mirrors.value.some(m => !m.isPrimary));

  /** 全部图床链接均已失效（包括主图床）。用于触发"整条记录失效"提示 */
  const allMirrorsBroken = computed(() => {
    const list = mirrors.value;
    return list.length > 0 && list.every(m => m.checkState === 'invalid');
  });

  /**
   * 推荐接班的图床：优先 linkCheck 通过的，其次未检测的
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

  function findSuccessResult(record: HistoryItem, serviceId: string) {
    return record.results.find(
      r => r.serviceId === serviceId && r.status === 'success' && r.result?.url,
    );
  }

  function applyCurrentItemPatch(patch: Partial<HistoryItem>): void {
    const cur = item.value;
    if (!cur) return;
    item.value = { ...cur, ...patch };
  }

  function applyPrimaryToCurrent(newServiceId: string): void {
    const cur = item.value;
    if (!cur) return;
    const target = findSuccessResult(cur, newServiceId);
    if (!target?.result?.url) return;
    applyCurrentItemPatch({
      primaryService: newServiceId,
      generatedLink: target.result.url,
    });
  }

  function applyMirrorRemovalToCurrent(serviceId: string): void {
    const cur = item.value;
    if (!cur) return;
    const nextResults = cur.results.filter(r => r.serviceId !== serviceId);
    let nextStatus = cur.linkCheckStatus;
    if (cur.linkCheckStatus && serviceId in cur.linkCheckStatus) {
      const { [serviceId]: _removed, ...rest } = cur.linkCheckStatus;
      nextStatus = rest;
    }
    applyCurrentItemPatch({
      results: nextResults,
      linkCheckStatus: nextStatus,
      linkCheckSummary: recomputeLinkCheckSummary(nextResults, nextStatus, cur.linkCheckSummary),
    });
  }

  /**
   * 切换主图床到指定备份
   * - 乐观更新：立即把 optimisticPrimary 设到目标 sid，UI 圆点同步跳过去
   * - DB 写成功：等 emitHistoryUpdated 让 item.primaryService 跟上后清空乐观态
   * - DB 写失败：清空乐观态回滚 + 错误 toast
   */
  async function switchPrimary(newServiceId: string): Promise<void> {
    const cur = item.value;
    if (!cur) return;
    // 比对 effective primary，而不是 props.primaryService。后者是 snapshot 不刷新，
    // 连续切换时（jd → qiyu → jd）会让"切回原主"被误当 no-op，UI 与 DB 永久错位。
    const currentEffective = optimisticPrimary.value ?? cur.primaryService;
    if (currentEffective === newServiceId) return;

    optimisticPrimary.value = newServiceId;

    try {
      await historyDB.switchPrimaryService(cur.id, newServiceId);
      applyPrimaryToCurrent(newServiceId);
      await notifyUpdated(cur.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('切换主图床失败:', err);
      optimisticPrimary.value = null;
      toast.error('切换失败', msg);
    }
  }

  /**
   * 移除某条图床链接
   * - 非主图床：二次确认后直接删
   * - 主图床：若有备选（valid/unchecked）→ 确认后先切到备选再删原主；
   *          若无备选 → 提示用户整条记录走"删除历史"入口
   */
  async function removeMirror(serviceId: string): Promise<void> {
    const cur = item.value;
    if (!cur) return;
    const target = mirrors.value.find(m => m.serviceId === serviceId);
    if (!target) return;

    if (target.isPrimary) {
      const successor = suggestedMirror.value;
      if (!successor) {
        toast.warn('这是唯一剩下的链接', '请直接删除整条历史记录');
        return;
      }
      confirmDelete(
        `删除当前主图床链接后，将自动切换到 ${successor.serviceId} 作为新主图床。确认继续？`,
        async () => {
          let switched = false;
          try {
            await historyDB.switchPrimaryService(cur.id, successor.serviceId);
            switched = true;
            applyPrimaryToCurrent(successor.serviceId);
            await historyDB.removeMirror(cur.id, serviceId);
            applyMirrorRemovalToCurrent(serviceId);
            await notifyUpdated(cur.id);
            toast.success('已移除原主链接', `已切换到 ${successor.serviceId} 作为主图床`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.error('删除主图床失败:', err);
            if (switched) {
              // 切换主图床已落库但移除原条目失败：刷新 UI 反映已切换的新主图床，
              // 并明确告诉用户"主图床已迁但旧链接还在"，避免菜单显示和实际状态错位
              await notifyUpdated(cur.id);
              toast.warn(
                '主图床已切换，但旧链接未移除',
                `已切到 ${successor.serviceId}，请重试移除：${msg}`,
              );
            } else {
              toast.error('删除失败', msg);
            }
          }
        },
      );
      return;
    }

    confirmDelete(
      `确定要移除此图床链接吗？记录本身会保留，但 ${serviceId} 上的链接将从本条中抹除。`,
      async () => {
        try {
          await historyDB.removeMirror(cur.id, serviceId);
          applyMirrorRemovalToCurrent(serviceId);
          await notifyUpdated(cur.id);
          toast.success('链接已移除', `${serviceId} 的链接已从此记录中移除`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error('移除图床链接失败:', err);
          toast.error('移除失败', msg);
        }
      },
    );
  }

  /**
   * 重新检测某条图床链接的有效性
   * - 直接走 Rust 的 check_image_link 命令（不依赖 LinkCheckView 的 checkRows）
   * - 结果先写入 localStatusOverride，让 chip 立即变色；再串行落库 + emit 事件
   * - 并发守卫：同一 serviceId 已在检测中时直接忽略重复触发
   * - 不弹 toast：菜单内 chip 变色就是结果反馈，无需打断用户
   */
  async function checkMirror(serviceId: string): Promise<void> {
    const cur = item.value;
    if (!cur) return;
    const target = mirrors.value.find(m => m.serviceId === serviceId);
    if (!target) return;
    if (checkingServices.value.has(serviceId)) return;

    const next = new Set(checkingServices.value);
    next.add(serviceId);
    checkingServices.value = next;

    try {
      const result = await invoke<CheckLinkResult>('check_image_link', {
        link: target.url,
        fallbackUrl: null,
      });

      const entry: LinkCheckEntry = {
        isValid: result.is_valid,
        lastCheckTime: Date.now(),
        statusCode: result.status_code,
        errorType: result.error_type as
          | 'success' | 'http_4xx' | 'http_5xx' | 'timeout' | 'network' | 'pending',
        responseTime: result.response_time,
        error: result.error || undefined,
      };

      // 先把 chip 状态写到本地 override，UI 立即看到结果
      localStatusOverride.value = { ...localStatusOverride.value, [serviceId]: entry };
      applyCurrentItemPatch({
        linkCheckStatus: {
          ...(item.value?.linkCheckStatus ?? {}),
          [serviceId]: entry,
        },
      });

      // 串行化 DB 写入：等上一笔回写完成再读 → 合并 → 写。
      // 失败也要继续放行队列，避免一次抛错导致所有后续写永远卡住。
      const writeTask = dbWriteQueue.then(async () => {
        const latest = await historyDB.getById(cur.id);
        if (!latest) return false;
        const linkCheckStatus = { ...(latest.linkCheckStatus ?? {}) };
        linkCheckStatus[serviceId] = entry;
        await historyDB.update(cur.id, { linkCheckStatus });
        return true;
      });
      dbWriteQueue = writeTask.catch(() => undefined);
      const written = await writeTask;
      if (!written) return;

      await notifyUpdated(cur.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error('检测图床链接失败:', err);
      toast.error('检测失败', msg);
    } finally {
      const after = new Set(checkingServices.value);
      after.delete(serviceId);
      checkingServices.value = after;
    }
  }

  return {
    mirrors,
    isPrimaryBroken,
    hasAlternatives,
    allMirrorsBroken,
    suggestedMirror,
    checkingServices,
    switchPrimary,
    removeMirror,
    checkMirror,
  };
}
