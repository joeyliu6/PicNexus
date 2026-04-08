// 备份与同步 - 纯工具函数（无状态依赖）

import { WebDAVClient } from '../../utils/webdav';
import { historyDB, type SyncLogOperation } from '../../services/HistoryDatabase';
import { useToast } from '../useToast';
import { TOAST_MESSAGES } from '../../constants';
import type { WebDAVProfile } from '../../config/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('BackupSync');

/**
 * 写入同步操作日志（静默失败，不影响主流程）
 */
export async function writeSyncLog(
  operation: SyncLogOperation,
  result: 'success' | 'failed',
  details?: string,
  profile?: WebDAVProfile | null
): Promise<void> {
  try {
    await historyDB.addSyncLog({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      operation,
      result,
      details,
      profileId: profile?.id ?? undefined,
      profileName: profile?.name ?? undefined,
    });
  } catch (e) {
    log.warn('写入同步日志失败:', e);
  }
}

/**
 * 获取当前时间的完整格式字符串
 */
export function getFullTimestamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}

/**
 * 提取错误信息并翻译为用户友好的中文提示
 */
export function extractErrorCode(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);

  // HTTP 状态码
  const httpMatch = msg.match(/(?:HTTP|status(?:\s*code)?)[:\s]*(\d{3})/i)
    || msg.match(/\b([45]\d{2})\b/);
  if (httpMatch) {
    const code = httpMatch[1];
    const statusTexts: Record<string, string> = {
      '401': '认证失败，请检查用户名和密码',
      '403': '访问被拒绝，权限不足',
      '404': '远程路径不存在，请检查路径设置',
      '405': '服务器不支持此操作，请确认 WebDAV 地址',
      '500': '服务器内部错误，请稍后重试',
      '502': '网关错误，请稍后重试',
      '503': '服务暂时不可用，请稍后重试',
      '507': '云端存储空间不足',
    };
    return statusTexts[code] || `服务器返回错误 ${code}`;
  }

  // 网络错误
  if (msg.includes('ECONNREFUSED')) return '连接被拒绝，请检查服务器地址和端口';
  if (msg.includes('ETIMEDOUT') || msg.includes('timeout')) return '连接超时，请检查网络或服务器状态';
  if (msg.includes('ENOTFOUND')) return '域名解析失败，请检查服务器地址';
  if (msg.includes('ECONNRESET')) return '连接被重置，请检查网络连接';
  if (msg.includes('fetch')) return '无法连接服务器，请检查网络';

  // Tauri 权限/作用域错误
  if (msg.includes('not allowed on the configured scope') || msg.includes('url not allowed'))
    return 'URL 不在允许范围内，请检查 WebDAV 地址格式';

  // WebDAV 特定错误
  if (msg.includes('XML') || msg.includes('parse')) return '服务器响应格式异常，请确认 WebDAV 地址';
  if (msg.includes('decrypt') || msg.includes('解密')) return '数据解密失败，请检查备份密码';
  if (msg.includes('locked') || msg.includes('423')) return '文件被锁定，请稍后重试';
  if (msg.includes('insufficient') || msg.includes('quota')) return '云端存储空间不足';
  if (msg.includes('certificate') || msg.includes('SSL') || msg.includes('TLS'))
    return 'SSL 证书错误，请检查服务器证书配置';

  // 通用中文错误直接返回
  if (/^[\u4e00-\u9fa5]/.test(msg)) return msg.length > 100 ? msg.substring(0, 100) + '…' : msg;

  // 其他英文错误截取关键部分
  return msg.length > 100 ? msg.substring(0, 100) + '…' : msg;
}

/**
 * 获取 WebDAV 客户端和远程路径
 */
export async function getWebDAVClientAndPath(
  profile: WebDAVProfile | null,
  fileType: 'settings' | 'history',
  toast: ReturnType<typeof useToast>
): Promise<{ client: WebDAVClient; remotePath: string } | null> {
  if (!profile || !profile.url || !profile.username || (!profile.password && !profile.passwordEncrypted)) {
    toast.showConfig('warn', TOAST_MESSAGES.sync.noWebDAV);
    return null;
  }

  const client = await WebDAVClient.fromEncryptedConfig({
    url: profile.url,
    username: profile.username,
    password: profile.password,
    passwordEncrypted: profile.passwordEncrypted,
    remotePath: profile.remotePath,
  });

  let remotePath = profile.remotePath || '/PicNexus/';
  if (remotePath.endsWith('/')) {
    remotePath += `${fileType}.json`;
  } else if (!remotePath.toLowerCase().endsWith('.json')) {
    remotePath += `/${fileType}.json`;
  } else {
    remotePath = remotePath.replace(/[^/]+\.json$/i, `${fileType}.json`);
  }

  return { client, remotePath };
}
