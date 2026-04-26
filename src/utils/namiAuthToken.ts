// 纳米图床 Auth-Token 提取
// Why: 历史上四个文件各写一套正则（/token=/、/auth-token=/、/Auth-Token=/），
//   且实际 Cookie 中字段名是 `Auth-Token=`（区分大小写），多数旧正则都匹配不到，
//   或误命中 csrf_token=、login_token= 等无关字段，导致自动获取 Cookie 后
//   authToken 写入磁盘为空 / 错值，进而上传时被 NamiUploader 拒绝。
// 这里统一用大小写不敏感的 Auth-Token=…；以及空字段保护。

const AUTH_TOKEN_REGEX = /Auth-Token=([^;]+)/i;

/**
 * 从 Nami Cookie 字符串中提取 Auth-Token 值
 * @param cookie 完整 Cookie 字符串
 * @returns Auth-Token 值（去掉首尾空白），未找到时返回空字符串
 */
export function extractNamiAuthToken(cookie: string | undefined | null): string {
  if (!cookie) return '';
  const match = cookie.match(AUTH_TOKEN_REGEX);
  return match ? match[1].trim() : '';
}
