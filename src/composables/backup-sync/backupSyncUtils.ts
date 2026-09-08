// 备份与同步 - 纯工具函数（无状态依赖）

import { WebDAVClient, WEBDAV_AUTH_FAILED_MESSAGE, WEBDAV_FORBIDDEN_MESSAGE } from '../../utils/webdav';
import { historyDB, type SyncLogOperation } from '../../services/HistoryDatabase';
import { useToast } from '../useToast';
import { TOAST_MESSAGES } from '../../constants';
import type { WebDAVProfile, HistoryItem } from '../../config/types';
import { getErrorMessage } from '../../types/errors';
import { createLogger } from '../../utils/logger';
import { formatTimestampFull } from '../../utils/formatters';

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
  return formatTimestampFull();
}

/**
 * 提取错误信息并翻译为用户友好的中文提示
 */
export function extractErrorCode(error: unknown): string {
  // Why getErrorMessage 而不是 `String(error)`：Tauri command 失败时 reject 的是 AppError
  // 序列化后的普通对象 `{type, data:{message}}`，不是 Error 实例。主链路的解包已经在
  // `src/utils/webdav.ts` 做掉了，这里是兜底——任何将来直接把 invoke 错误丢进来的调用方，
  // 都不会再退化成 `[object Object]`。
  const msg = getErrorMessage(error);

  // HTTP 状态码
  // Why: 原 fallback `/\b([45]\d{2})\b/` 会把任何含 4xx/5xx 数字的错误误判为 HTTP 状态码，
  // 比如 "Cannot connect to port 443"、"timeout after 500ms"、"parse error at column 502"
  // 都会被翻译成"服务器返回错误 4xx"，误导用户排障。这里只匹配明确带 HTTP/status 上下文
  // 或以 4xx/5xx + 空白 + 含义文本起始的错误体（如 "404 Not Found" / "501: ..."）。
  const httpMatch =
    msg.match(/(?:HTTP|status(?:\s*code)?)[:\s]*(\d{3})/i)
    || msg.match(/(?:^|[\s(])([45]\d{2})(?=[\s:,)\-—]|\s*[A-Z])/);
  if (httpMatch) {
    const code = httpMatch[1];
    const statusTexts: Record<string, string> = {
      '401': WEBDAV_AUTH_FAILED_MESSAGE,
      '403': WEBDAV_FORBIDDEN_MESSAGE,
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
 * 判断 WebDAV 拉取失败是否等价于"远端文件不存在"。
 *
 * getFile 对标准 404 会返回 null；这里兜住少数服务/插件把不存在包装成异常的情况。
 * 非 404 错误必须向外抛，避免把认证失败、网络错误、JSON 损坏误当作空云端后覆盖上传。
 */
export function isWebDAVNotFoundError(error: unknown): boolean {
  const msg = getErrorMessage(error);
  return (
    /\b404\b/.test(msg) ||
    /not\s*found/i.test(msg) ||
    /file.*not.*exist/i.test(msg) ||
    msg.includes('文件不存在')
  );
}

/**
 * 拉取云端历史后的判定结果
 *
 * 三态而不是「有内容 / 没内容」两态，是因为两态会把**云端文件根本不存在**（首次同步的
 * 正常路径）和**云端文件存在但读不出可用数据**（0 字节、内容不是数组）混为一谈——而这两者
 * 在「上传方向」的后果天差地别：前者应该继续全量上传，后者继续上传就等于拿本地把云端清了。
 */
export type CloudHistoryPayload =
  /** `getFile` 返回 null（HTTP 404）：云端还没有这个文件，首次同步的正常路径 */
  | { kind: 'absent' }
  /** 正常解析出数组 */
  | { kind: 'items'; items: HistoryItem[] }
  /** 文件在，但拿不到可用数据（0 字节 / 合法 JSON 但不是数组），必须中止 */
  | { kind: 'unusable'; reason: string };

/**
 * 「云端数据不可用、已中止」的统一标记
 *
 * HistorySync 的「上传失败」toast 据此决定**不再拼**「请检查网络或 WebDAV 配置后重试」——
 * 那是对网络故障的通用指引，拼在中止文案后面会让用户以为问题出在网络/配置，转而忽略
 * 文案里的自愈指引（改用「强制覆盖云端」）。ConfigSync 的同步失败 toast 本就不拼后缀，
 * 无需此标记；但它的空配置文案也复用同一标记（见 `CLOUD_CONFIG_EMPTY_REASON`），
 * 确保两处「已中止…」措辞不会各写各的跑偏。
 */
export const CLOUD_DATA_ABORT_MARKER = '已中止以避免覆盖云端数据';

/** 云端 history.json 为 0 字节时的中止原因；措辞刻意避开「文件不存在」/`404`/`not found`
 * （isWebDAVNotFoundError 按子串匹配，命中会把中止当「首次同步」吞掉），并给出唯一逃生舱。 */
export const CLOUD_HISTORY_EMPTY_REASON =
  `云端历史文件为空，${CLOUD_DATA_ABORT_MARKER}；若确认云端本就无数据，请改用「强制覆盖云端」`;

/** 云端 history.json 是合法 JSON 但不是数组时的中止原因 */
export const CLOUD_HISTORY_NON_ARRAY_REASON =
  `云端历史数据格式错误：期望数组格式，${CLOUD_DATA_ABORT_MARKER}`;

/** 云端 settings.json 为 0 字节时的中止原因（ConfigSync 用；逃生舱是「上传到云端」） */
export const CLOUD_CONFIG_EMPTY_REASON =
  `云端配置文件为空，${CLOUD_DATA_ABORT_MARKER}；若确认云端本就无数据，请改用「上传到云端」`;

export function isCloudDataAbortReason(errorCode: string): boolean {
  return errorCode.includes(CLOUD_DATA_ABORT_MARKER);
}

/**
 * 解析「上传前拉取的云端历史」
 *
 * ⚠️ **只给上传方向用**（当前唯一调用点是 `syncHistory` 第一步）。
 * 下载方向（`downloadHistoryOverwrite`）**绝不能用**：那边 `absent`
 * 的正确含义是「没东西可恢复，必须中止」，若照本函数把 `absent` 当成空数组继续走，
 * `importFromJSON(空, 'replace')` 会把本地历史整库清空——比原缺陷更致命。
 *
 * 本函数**不抛异常**（`JSON.parse` 失败除外，那属于真·解析错误，交由调用方的 catch 处理）。
 * 不可用状态以 `kind: 'unusable'` 返回，由调用方在 catch 块**之外**再抛——因为调用点的
 * 内层 catch 要过一道 `isWebDAVNotFoundError`，而它是**子串匹配**：只要错误文案里出现
 * 「文件不存在」/`404`/`not found`，就会被当成「云端没这个文件」吞掉，中止逻辑静默退化成
 * 原来的覆盖行为。把 throw 挪出 catch 范围，这条路就与文案措辞彻底解耦了。
 */
export function parseCloudHistoryForUpload(content: string | null | undefined): CloudHistoryPayload {
  // 用 == 而非 ===：测试桩里未设默认返回值的 `vi.fn()` 会给出 undefined，
  // 落进 JSON.parse(undefined) 会抛出难懂的 SyntaxError。
  if (content == null) return { kind: 'absent' };

  if (content.trim() === '') {
    return { kind: 'unusable', reason: CLOUD_HISTORY_EMPTY_REASON };
  }

  const parsed: unknown = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    return { kind: 'unusable', reason: CLOUD_HISTORY_NON_ARRAY_REASON };
  }

  return { kind: 'items', items: parsed as HistoryItem[] };
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
