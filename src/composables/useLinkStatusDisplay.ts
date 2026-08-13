// 链接状态展示辅助 - 从 MdRescueInline.vue 提取
// 纯函数，无 Vue 响应式依赖，可跨组件复用

import type { CheckLinkResult } from '../types/linkCheck';

export interface StatusDisplay {
  color: string;
  label: string;
}

const STATUS_DISPLAY_MAP: Record<string, StatusDisplay> = {
  timeout: { color: 'amber', label: '超时' },
  suspicious: { color: 'purple', label: '疑似' },
  redirect: { color: 'purple', label: '跳转' },
  network: { color: 'red', label: '网络' },
  blocked: { color: 'red', label: '拦截' },
  http_4xx: { color: 'red', label: '404' },
  http_5xx: { color: 'red', label: '500' },
};

export function getStatusDisplay(cr: CheckLinkResult | null | undefined): StatusDisplay {
  if (!cr) return { color: 'red', label: '失败' };
  if (cr.is_valid) return { color: 'green', label: '正常' };
  // redirect 要抢在 browser_might_work 前面：3xx 两个标志都置了，
  // 落到通用的「疑似」上会丢掉「这只是个跳转」这条最有用的信息
  if (cr.error_type === 'redirect') return STATUS_DISPLAY_MAP.redirect;
  if (cr.browser_might_work) return { color: 'purple', label: '疑似' };
  return STATUS_DISPLAY_MAP[cr.error_type] ?? { color: 'red', label: '失效' };
}

export function statusBadgeLabel(cr: CheckLinkResult | null | undefined): string {
  if (!cr) return '失败';
  if (cr.is_valid) return cr.status_code ? String(cr.status_code) : '200';
  if (cr.status_code) return String(cr.status_code);
  if (cr.error_type === 'timeout') return '超时';
  if (cr.error_type === 'network') return '网络';
  if (cr.error_type === 'blocked') return '拦截';
  if (cr.error_type === 'redirect') return '跳转';
  if (cr.error_type === 'suspicious' || cr.browser_might_work) return '疑似';
  return '失效';
}

export function statusDotColor(cr: CheckLinkResult | null | undefined): string {
  if (!cr) return 'var(--error)';
  if (cr.is_valid) return 'var(--success)';
  if (cr.error_type === 'timeout') return 'var(--warning)';
  if (cr.error_type === 'suspicious' || cr.browser_might_work) return 'var(--pending)';
  return 'var(--error)';
}

const STATUS_DESC: Record<number, string> = {
  400: '请求异常 · 链接格式可能有误',
  401: '需要认证 · 图床要求登录才能访问',
  403: '禁止访问 · 可能触发了防盗链',
  404: '图片不存在 · 可能已被删除或链接失效',
  405: '请求方式不允许 · 图床不支持 HEAD 请求',
  408: '请求超时 · 图床响应过慢',
  410: '已永久移除 · 图片已被图床永久删除',
  429: '请求过频 · 检测速度过快被限流，稍后重试',
  500: '服务器内部错误 · 图床服务异常',
  502: '网关错误 · 图床服务可能正在维护',
  503: '服务不可用 · 图床暂时下线，稍后重试',
  504: '网关超时 · 图床上游服务响应超时',
};

export function statusTooltip(cr: CheckLinkResult | null | undefined): string {
  if (!cr || cr.is_valid) return '';
  const parts: string[] = [];
  if (cr.status_code) {
    // redirect 必须先判：3xx 也置了 browser_might_work，
    // 落到下面的防盗链分支会给出「防盗链限制 (301)」这种指错方向的解释
    if (cr.error_type === 'redirect') {
      parts.push(`跳转链接 (${cr.status_code}) · 浏览器会自动跟随，通常可正常显示；检测器出于安全不跟随`);
    } else if (cr.browser_might_work) {
      parts.push(`防盗链限制 (${cr.status_code}) · 浏览器直接打开可正常显示`);
    } else {
      const desc = STATUS_DESC[cr.status_code];
      if (desc) parts.push(`${desc} (${cr.status_code})`);
      else {
        const prefix = cr.error_type === 'http_5xx' ? '服务器错误' : '请求失败';
        parts.push(`${prefix} (${cr.status_code})`);
      }
    }
  } else {
    const fallback: Record<string, string> = {
      timeout: '检测超时 · 网络延迟或图床响应过慢',
      network: '网络不通 · 无法连接到图床服务器',
      suspicious: '疑似异常 · 返回了内容但不像是图片（类型或体积异常）',
      blocked: cr.error ? `策略拦截 · ${cr.error}` : '策略拦截 · 请求未发出',
    };
    // 兜底顺序不能反：只在 fallback 表命中不到时才用后端的 error。
    // 后端给 timeout / network 的 error 是裸的「请求超时」「连接失败」，
    // 甚至可能是 reqwest 的 Debug 串，比上面这几条文案差。
    parts.push(fallback[cr.error_type] || cr.error || '链接失效');
  }
  if (cr.response_time) parts.push(`${cr.response_time}ms`);
  return parts.join(' · ');
}

export function extractHost(url: string): string {
  try { return new URL(url).host; }
  catch { return ''; }
}

export function isDefunctHost(url: string): boolean {
  const host = extractHost(url);
  return host.endsWith('.sinaimg.cn') || host === 'sinaimg.cn';
}

export function extractFilenameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return decodeURIComponent(last);
    return u.hostname;
  } catch {
    const tail = url.split('/').pop() || url;
    return tail.split('?')[0] || url;
  }
}

export function formatTimeRemaining(ms: number): string {
  const secs = Math.ceil(ms / 1000);
  if (secs < 60) return `${secs} 秒`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  return remainSecs > 0 ? `${mins} 分 ${remainSecs} 秒` : `${mins} 分钟`;
}
