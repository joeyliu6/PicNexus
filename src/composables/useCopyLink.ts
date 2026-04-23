// 统一复制链接 composable
// 所有复制链接入口共享此逻辑，确保格式、前缀、Toast 行为一致

import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useConfigManager } from './useConfig';
import { useToast } from './useToast';
import { getActivePrefix } from '../config/types';
import type { UserConfig } from '../config/types';
import { applyPrefixTemplate } from '../utils/linkPrefixTemplate';
import { formatLink, FORMAT_NAMES, type LinkFormat } from '../utils/linkFormatter';
import { createLogger } from '../utils/logger';

const log = createLogger('CopyLink');

export interface CopyLinkItem {
  url: string;
  fileName: string;
  serviceId?: string;
  width?: number;
  height?: number;
}

interface CopyLinkOptions {
  format?: LinkFormat;
  /** 兼容旧参数：同时控制成功/失败提示 */
  showToast?: boolean;
  /** 是否显示成功提示 */
  showSuccessToast?: boolean;
  /** 是否显示失败/警告提示 */
  showErrorToast?: boolean;
}

const TOAST_DURATION = 1500;

export interface CopyLinkResult {
  ok: boolean;
  copiedCount: number;
  format: LinkFormat;
  error?: string;
}

// ==================== 纯函数（不依赖 Vue context）====================

/**
 * 对 URL 应用微博前缀（纯函数版本，直接传入 config）
 */
export function applyLinkPrefix(url: string, serviceId: string | undefined, config: UserConfig): string {
  if (serviceId !== 'weibo') return url;
  const prefix = getActivePrefix(config);
  return prefix ? applyPrefixTemplate(prefix.template, url) : url;
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

  function applyPrefix(url: string, serviceId?: string): string {
    return applyLinkPrefix(url, serviceId, configManager.config.value);
  }

  function getFormatConfig() {
    return getLinkFormatConfig(configManager.config.value);
  }

  function formatSingleLink(item: CopyLinkItem, format?: LinkFormat): string {
    return formatLinkWithConfig(item, configManager.config.value, format);
  }

  function resolveToastOptions(options?: CopyLinkOptions) {
    const base = options?.showToast ?? true;
    return {
      showSuccessToast: options?.showSuccessToast ?? base,
      showErrorToast: options?.showErrorToast ?? base,
    };
  }

  /**
   * 复制单个链接
   */
  async function copyLink(item: CopyLinkItem, options?: CopyLinkOptions): Promise<CopyLinkResult> {
    const { format } = options || {};
    const { format: defaultFormat } = getFormatConfig();
    const finalFormat = format || defaultFormat;
    const { showSuccessToast, showErrorToast } = resolveToastOptions(options);

    try {
      const formatted = formatSingleLink(item, format);
      if (!formatted) {
        if (showErrorToast) {
          toast.warn('无可用链接', '没有可复制的链接');
        }
        return {
          ok: false,
          copiedCount: 0,
          format: finalFormat,
          error: '没有可复制的链接',
        };
      }

      await writeText(formatted);
      if (showSuccessToast) {
        toast.success('已复制', `${FORMAT_NAMES[finalFormat]} 链接已复制`, TOAST_DURATION);
      }

      return {
        ok: true,
        copiedCount: 1,
        format: finalFormat,
      };
    } catch (error) {
      log.error('失败:', error);
      const errorMsg = String(error);
      if (showErrorToast) {
        toast.error('复制失败', errorMsg);
      }

      return {
        ok: false,
        copiedCount: 0,
        format: finalFormat,
        error: errorMsg,
      };
    }
  }

  /**
   * 批量复制链接
   */
  async function copyLinks(items: CopyLinkItem[], options?: CopyLinkOptions): Promise<CopyLinkResult> {
    const { format } = options || {};
    const { format: defaultFormat } = getFormatConfig();
    const finalFormat = format || defaultFormat;
    const { showSuccessToast, showErrorToast } = resolveToastOptions(options);

    if (items.length === 0) {
      if (showErrorToast) {
        toast.warn('无可用链接', '没有可复制的链接');
      }
      return {
        ok: false,
        copiedCount: 0,
        format: finalFormat,
        error: '没有可复制的链接',
      };
    }

    try {
      const formattedLinks = items
        .map(item => formatSingleLink(item, format))
        .filter(Boolean);

      if (formattedLinks.length === 0) {
        if (showErrorToast) {
          toast.warn('无可用链接', '没有可复制的链接');
        }
        return {
          ok: false,
          copiedCount: 0,
          format: finalFormat,
          error: '没有可复制的链接',
        };
      }

      await writeText(formattedLinks.join('\n'));
      if (showSuccessToast) {
        toast.success('已复制', `${formattedLinks.length} 个 ${FORMAT_NAMES[finalFormat]} 链接已复制`, TOAST_DURATION);
      }

      return {
        ok: true,
        copiedCount: formattedLinks.length,
        format: finalFormat,
      };
    } catch (error) {
      log.error('批量复制失败:', error);
      const errorMsg = String(error);
      if (showErrorToast) {
        toast.error('复制失败', errorMsg);
      }
      return {
        ok: false,
        copiedCount: 0,
        format: finalFormat,
        error: errorMsg,
      };
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
