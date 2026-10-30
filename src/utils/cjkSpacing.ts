// 拼中文句子时，在中文与英文 / 数字的交界处补一个空格（「复制到 Cloudflare R2」「GitHub 连不上」）

const CJK = /[一-鿿]/;
const LATIN = /[A-Za-z0-9]/;

/**
 * 按片段拼句子：只看片段交界，不碰片段内部
 *
 * 图床名可能是用户自己起的（「家里NAS盘」），整句做正则替换会把它改写成「家里 NAS 盘」。
 */
export function joinCjk(...parts: string[]): string {
  let out = '';
  for (const part of parts) {
    if (!part) continue;
    const prev = out[out.length - 1] ?? '';
    if ((CJK.test(prev) && LATIN.test(part[0])) || (LATIN.test(prev) && CJK.test(part[0]))) out += ' ';
    out += part;
  }
  return out;
}
