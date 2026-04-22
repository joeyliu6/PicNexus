/**
 * 批量迁移 · 单状态 chip 元数据映射
 *
 * 替代原 MigrateActiveCard.buildPipeline 的三段式管道，
 * 根据 MigrateItemStatus 产出单个 chip 的 { variant, label, icon, tone }。
 *
 * - tone：驱动背景/文字色 token（active=primary，success=绿，warning=黄，error=红，pending=灰）
 * - variant：稳定 key，让 Vue transition 不会在帧刷新时误判
 * - spinning：true 时图标旋转（active-* 三态）
 *
 * done 行、CSV 导出、active 行共用此函数。
 */
import type { MigrateItemStatus } from '../../../../../types/batchMigrate';

export type StatusChipTone = 'pending' | 'active' | 'success' | 'warning' | 'error';

export type StatusChipVariant =
  | 'pending'
  | 'downloading'
  | 'converting'
  | 'uploading'
  | 'success'
  | 'success-converted'
  | 'skipped'
  | 'fail-download'
  | 'fail-upload'
  | 'failed';

export interface StatusChipMeta {
  variant: StatusChipVariant;
  label: string;
  icon: string;
  tone: StatusChipTone;
  spinning: boolean;
}

type StatusChipInput = Pick<MigrateItemStatus, 'status' | 'errorType' | 'convertedFormat'>;

export function getStatusChipMeta(item: StatusChipInput): StatusChipMeta {
  switch (item.status) {
    case 'pending':
      return { variant: 'pending', label: '等待', icon: 'pi pi-circle', tone: 'pending', spinning: false };
    case 'downloading':
      return { variant: 'downloading', label: '下载中', icon: 'pi pi-spin pi-sync', tone: 'active', spinning: true };
    case 'converting':
      return { variant: 'converting', label: '转换中', icon: 'pi pi-spin pi-sync', tone: 'active', spinning: true };
    case 'uploading':
      return { variant: 'uploading', label: '上传中', icon: 'pi pi-spin pi-sync', tone: 'active', spinning: true };
    case 'success':
      if (item.convertedFormat) {
        return {
          variant: 'success-converted',
          label: `已转 ${item.convertedFormat.toUpperCase()}`,
          icon: 'pi pi-check',
          tone: 'success',
          spinning: false,
        };
      }
      return { variant: 'success', label: '已完成', icon: 'pi pi-check', tone: 'success', spinning: false };
    case 'skipped':
      return { variant: 'skipped', label: '已存在', icon: 'pi pi-eye-slash', tone: 'warning', spinning: false };
    case 'failed':
      if (item.errorType === 'download') {
        return { variant: 'fail-download', label: '下载失败', icon: 'pi pi-times', tone: 'warning', spinning: false };
      }
      if (item.errorType === 'upload') {
        return { variant: 'fail-upload', label: '上传失败', icon: 'pi pi-times', tone: 'error', spinning: false };
      }
      // errorType 缺失兜底：按 error tone 处理
      return { variant: 'failed', label: '失败', icon: 'pi pi-times', tone: 'error', spinning: false };
  }
}
