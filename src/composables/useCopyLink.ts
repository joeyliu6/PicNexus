// 统一复制链接 composable
// 所有复制链接入口共享此逻辑，确保格式、前缀、Toast 行为一致

import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useConfigManager } from './useConfig';
import { useToast } from './useToast';
import { getActivePrefix } from '../config/types';
import type { ServiceType, UserConfig } from '../config/types';
import { formatLink, FORMAT_NAMES, type LinkFormat } from '../utils/linkFormatter';

export interface CopyLinkItem {
  url: string;
  fileName: string;
  serviceId?: ServiceType;
  width?: number;
  height?: number;
}

interface CopyLinkOptions {
  format?: LinkFormat;
  showToast?: boolean;
}

const TOAST_DURATION = 1500;

// ==================== 纯函数（不依赖 Vue context）====================

/**
 * 对 URL 应用微博前缀（纯函数版本，直接传入 config）
 */
export function applyLinkPrefix(url: string, serviceId: ServiceType | undefined, config: UserConfig): string {
  if (serviceId !== 'weibo') return url;
  const prefix = getActivePrefix(config);
  return prefix ? `${prefix}${url}` : url;
}

/**
 * 从 config 中提取格式配置
 */
export function getLinkFormatConfig(config: UserConfig) {
  const linkOutput = config.linkOutput;
  return {
    format: (linkOutput?.defaultFormat || 'url') as LinkFormat,
    customTemplate: linkOutput?.customTemplate,
  };
}

/**
 * 格式化单个链接（纯函数版本，不依赖 Vue context）
 * 可在非组件环境中使用（如全局快捷键）
 */
export function formatLinkWithConfig(
  item: CopyLinkItem,
  config: UserConfig,
  format?: LinkFormat
): string {
  const { format: defaultFormat, customTemplate } = getLinkFormatConfig(config);
  const finalFormat = format || defaultFormat;
  const finalUrl = applyLinkPrefix(item.url, item.serviceId, config);
  return formatLink(finalUrl, item.fileName, finalFormat, customTemplate, {
    width: item.width,
    height: item.height,
  });
}

// ==================== Vue Composable ====================

/**
 * 统一复制链接 composable
 * 所有入口使用同一套逻辑：默认格式、微博前缀、Toast 反馈
 */
export function useCopyLink() {
  const configManager = useConfigManager();
  const toast = useToast();

  function applyPrefix(url: string, serviceId?: ServiceType): string {
    return applyLinkPrefix(url, serviceId, configManager.config.value);
  }

  function getFormatConfig() {
    return getLinkFormatConfig(configManager.config.value);
  }

  function formatSingleLink(item: CopyLinkItem, format?: LinkFormat): string {
    return formatLinkWithConfig(item, configManager.config.value, format);
  }

  /**
   * 复制单个链接
   */
  async function copyLink(item: CopyLinkItem, options?: CopyLinkOptions): Promise<void> {
    const { format, showToast = true } = options || {};
    try {
      const formatted = formatSingleLink(item, format);
      await writeText(formatted);
      if (showToast) {
        const { format: defaultFormat } = getFormatConfig();
        const finalFormat = format || defaultFormat;
        toast.success('已复制', `${FORMAT_NAMES[finalFormat]} 链接已复制`, TOAST_DURATION);
      }
    } catch (error) {
      console.error('[复制链接] 失败:', error);
      toast.error('复制失败', String(error));
    }
  }

  /**
   * 批量复制链接
   */
  async function copyLinks(items: CopyLinkItem[], options?: CopyLinkOptions): Promise<void> {
    if (items.length === 0) return;

    const { format, showToast = true } = options || {};
    try {
      const formattedLinks = items
        .map(item => formatSingleLink(item, format))
        .filter(Boolean);

      if (formattedLinks.length === 0) {
        toast.warn('无可用链接', '没有可复制的链接');
        return;
      }

      await writeText(formattedLinks.join('\n'));
      if (showToast) {
        const { format: defaultFormat } = getFormatConfig();
        const finalFormat = format || defaultFormat;
        toast.success('已复制', `${formattedLinks.length} 个 ${FORMAT_NAMES[finalFormat]} 链接已复制`, TOAST_DURATION);
      }
    } catch (error) {
      console.error('[批量复制] 失败:', error);
      toast.error('复制失败', String(error));
    }
  }

  return {
    copyLink,
    copyLinks,
    formatSingleLink,
    applyPrefix,
    getFormatConfig,
  };
}
