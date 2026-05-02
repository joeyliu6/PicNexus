import type { AppErrorType } from '../types/errors';
import { isAppError } from '../types/errors';

interface NormalizedError {
  type?: AppErrorType | string;
  code?: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function tryParseJson(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function readMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return typeof value.message === 'string' ? value.message : null;
}

function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return normalizeError(error.message);
  }

  if (typeof error === 'string') {
    const trimmed = error.trim();
    const parsed = tryParseJson(trimmed);
    if (parsed) return normalizeError(parsed);
    return { message: trimmed };
  }

  if (isAppError(error)) {
    return {
      type: error.type,
      message: error.data.message,
      code: 'code' in error.data && error.data.code !== null ? String(error.data.code) : undefined,
    };
  }

  if (isRecord(error)) {
    const type = typeof error.type === 'string' ? error.type : undefined;
    const code = typeof error.code === 'string' || typeof error.code === 'number'
      ? String(error.code)
      : undefined;

    const dataMessage = readMessage(error.data);
    if (dataMessage) return { type, code, message: dataMessage };

    if (typeof error.message === 'string') {
      const nested = normalizeError(error.message);
      return {
        type: nested.type ?? type,
        code: nested.code ?? code,
        message: nested.message,
      };
    }

    if (typeof error.error === 'string') return { type, code, message: error.error };
    return { type, code, message: '' };
  }

  return { message: error === null || error === undefined ? '' : String(error) };
}

export function extractErrorMessage(error: unknown, fallback = '未知错误'): string {
  return normalizeError(error).message || fallback;
}

export function formatServiceHealthErrorMessage(error: unknown): string {
  const normalized = normalizeError(error);
  const message = normalized.message.trim();
  const type = normalized.type?.toUpperCase();
  const code = normalized.code?.toUpperCase();
  const lower = message.toLowerCase();

  if (!message) return '检测失败，请检查配置';

  if (type === 'CONFIG' || type === 'VALIDATION') {
    return '配置不完整，请检查必填项';
  }

  if (code?.includes('TOKEN') || /token|client[-_\s]*id|令牌/iu.test(lower)) {
    return 'Token 无效或已过期';
  }

  if (
    code?.includes('COOKIE')
    || code === 'AUTH_FAILED'
    || type === 'AUTH'
    || /cookie|subp?\b|sessdata|z_c0|登录|未登录/iu.test(message)
  ) {
    return 'Cookie 无效或已过期';
  }

  if (type === 'NETWORK' || /network|timeout|timed out|超时|连接失败|连接异常|请求失败|无法连接|网络/iu.test(message)) {
    return '网络连接异常，请稍后重试';
  }

  if (code === 'BUCKET_NOT_FOUND' || type === 'STORAGE' || /bucket|storage|存储|oss|s3|access denied|forbidden|403|权限/iu.test(message)) {
    return '存储配置异常，请检查 Bucket 或访问权限';
  }

  if (
    code?.includes('CONFIG')
    || code === 'DOMAIN_INVALID'
    || /config|缺少|不能为空|必填|未配置|格式(?:无效|不正确|错误)|invalid|missing|required|account id/iu.test(message)
  ) {
    return '配置不完整，请检查必填项';
  }

  if (/当前不可用|服务不可用|service unavailable|temporarily unavailable|502|503|504/iu.test(message)) {
    return '图床服务暂时不可用，请稍后重试';
  }

  return '检测失败，请检查配置';
}
