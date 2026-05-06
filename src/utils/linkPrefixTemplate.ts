// 链接前缀模板引擎
//
// 支持的占位符：
//   {url}           完整原 URL
//   {url_no_scheme} 去掉 https:// / http:// 的 URL
//   {path}          去掉协议和域名，仅保留路径（不含前导斜杠）
//   {url_encoded}   encodeURIComponent(完整URL)
//
// 若 template 不含任何占位符，自动在末尾追加 {url}，等价于旧版纯前缀拼接。

export const KNOWN_PLACEHOLDERS = ['url', 'url_no_scheme', 'path', 'url_encoded'] as const;

const PLACEHOLDER_RE = /\{(url|url_no_scheme|path|url_encoded)\}/g;
/** 宽松匹配任意 {xxx} 占位符片段，用于检测未知占位符 */
const ANY_PLACEHOLDER_RE = /\{([a-zA-Z_][\w-]*)\}/g;

/**
 * 找出模板中不在已知白名单内的占位符（去重，原样不含花括号）
 * 用于 UI 层校验：允许保存，但提示这些字面量不会被替换
 */
export function findUnknownPlaceholders(template: string): string[] {
  const known = new Set<string>(KNOWN_PLACEHOLDERS);
  const unknown = new Set<string>();
  ANY_PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ANY_PLACEHOLDER_RE.exec(template)) !== null) {
    if (!known.has(m[1])) unknown.add(m[1]);
  }
  return [...unknown];
}

function stripScheme(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

function extractPath(url: string): string {
  const noScheme = stripScheme(url);
  const slashIdx = noScheme.indexOf('/');
  return slashIdx >= 0 ? noScheme.slice(slashIdx + 1) : '';
}

function computePlaceholder(token: string, originalUrl: string): string {
  switch (token) {
    case 'url':
      return originalUrl;
    case 'url_no_scheme':
      return stripScheme(originalUrl);
    case 'path':
      return extractPath(originalUrl);
    case 'url_encoded':
      return encodeURIComponent(originalUrl);
    default:
      return '';
  }
}

/**
 * 检查模板是否包含任何占位符
 */
export function hasPlaceholder(template: string): boolean {
  PLACEHOLDER_RE.lastIndex = 0;
  return PLACEHOLDER_RE.test(template);
}

/**
 * 应用模板得到最终 URL
 * - template 含占位符：逐个替换
 * - template 不含占位符：当作纯前缀，末尾追加 originalUrl
 */
export function applyPrefixTemplate(template: string, originalUrl: string): string {
  if (!template) return originalUrl;
  if (!hasPlaceholder(template)) {
    return `${template}${originalUrl}`;
  }
  return template.replace(PLACEHOLDER_RE, (_, token) => computePlaceholder(token, originalUrl));
}

/**
 * 反向解析：从最终 URL 剥离模板，还原原始 URL
 * - 命中返回原始 URL
 * - 不命中返回 null
 *
 * 策略：将 template 按占位符切分成字面量片段，在最终 URL 里依次匹配，
 * 提取出 {url} 槽位的值。{url_encoded} 的槽位会做 decodeURIComponent。
 */
export function stripPrefixTemplate(finalUrl: string, template: string): string | null {
  if (!template) return null;

  // 无占位符：退化为纯前缀匹配
  if (!hasPlaceholder(template)) {
    return finalUrl.startsWith(template) ? finalUrl.slice(template.length) : null;
  }

  // 将模板拆分为 [literal, token, literal, token, ...]
  const parts: Array<{ kind: 'literal' | 'token'; value: string }> = [];
  let lastIdx = 0;
  PLACEHOLDER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PLACEHOLDER_RE.exec(template)) !== null) {
    if (m.index > lastIdx) {
      parts.push({ kind: 'literal', value: template.slice(lastIdx, m.index) });
    }
    parts.push({ kind: 'token', value: m[1] });
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < template.length) {
    parts.push({ kind: 'literal', value: template.slice(lastIdx) });
  }

  // 依次在 finalUrl 里消费
  let cursor = 0;
  const captured: Record<string, string> = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.kind === 'literal') {
      if (finalUrl.slice(cursor, cursor + part.value.length) !== part.value) {
        return null;
      }
      cursor += part.value.length;
    } else {
      // token：贪婪匹配到下一个 literal（或末尾）
      const next = parts[i + 1];
      let slot: string;
      if (next && next.kind === 'literal') {
        const nextIdx = finalUrl.lastIndexOf(next.value);
        if (nextIdx < cursor) return null;
        slot = finalUrl.slice(cursor, nextIdx);
        cursor = nextIdx;
      } else {
        slot = finalUrl.slice(cursor);
        cursor = finalUrl.length;
      }
      captured[part.value] = slot;
    }
  }

  // 根据捕获重建原 URL
  if (captured.url !== undefined) return captured.url;
  if (captured.url_encoded !== undefined) {
    try {
      return decodeURIComponent(captured.url_encoded);
    } catch {
      return null;
    }
  }
  if (captured.url_no_scheme !== undefined) {
    return `https://${captured.url_no_scheme}`;
  }
  if (captured.path !== undefined) {
    // path 无法还原完整 URL（域名信息已丢失），返回 null 让调用方跳过此模板
    return null;
  }
  return null;
}
