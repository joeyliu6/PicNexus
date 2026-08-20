import { getRestChainRequiredFields } from '../../constants/serviceRequiredFields';
import { assertAllowedExternalUrl, isHttpDomainConfirmed, isLoopbackHost } from '../../security/networkPolicy';
import type { HttpDomainConfirmable } from '../../config/types';

/**
 * 这份配置是否正卡在「公开域名是明文 HTTP、但用户还没确认」这一档
 *
 * 供「测试连接」判断该弹逃生舱还是照常报错——两者的处理方式完全不同：
 * 前者是等用户拍板，后者是配置真的填错了。
 */
export function needsHttpDomainConsent(config: Record<string, unknown>): boolean {
  const raw = config.publicDomain;
  if (typeof raw !== 'string' || !raw.trim()) return false;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:') return false;
    if (isLoopbackHost(url.hostname)) return false;  // 回环本来就放行，不需要确认
    return !isHttpDomainConfirmed(config as HttpDomainConfirmable, raw);
  } catch {
    return false;  // 连 URL 都不合法：交给下面的通用校验去报格式错
  }
}

/**
 * 「测试连接」前的配置预校验
 *
 * 用 REST 口径而不是 GUI 口径。注意这**不是**说测试连接只验 REST——2026-08-20 起
 * 又拍云的 `test_upyun_connection` 会 REST + S3 两条链路各验一次。这里之所以仍然
 * 只卡 REST 那几个字段，是因为**缺 S3 凭证这件事交给 Rust 报更合适**：
 *
 * - Rust 的 `UPYUN_S3_CREDENTIAL_MISSING` 会告诉用户去「操作员授权 → S3 访问凭证」
 *   生成，而这里只能吐一句 `s3AccessKey 格式无效（至少 2 个字符）`——用户读完
 *   仍然不知道那把钥匙在哪个页面里。老用户升级后**必然**撞上这一句，措辞是关键。
 * - 不存在多跑一趟网络的代价：Rust 侧取凭证在发任何请求之前，缺了就地返回。
 *
 * 其余图床两个口径完全一致，行为不变。
 */
export function validateS3Config(serviceId: string, config: Record<string, unknown>): string | null {
  const fields = getRestChainRequiredFields(serviceId);
  for (const field of fields) {
    const val = config[field];
    if (!val || String(val).trim().length < 2) {
      return `${field} 格式无效（至少 2 个字符）`;
    }
  }

  if (serviceId === 'r2' && config.accountId && !/^[a-f0-9]{32}$/.test(String(config.accountId))) {
    return 'Account ID 格式不正确（应为 32 位十六进制字符串）';
  }

  try {
    // Endpoint 不吃明文 HTTP 的逃生舱，也不该吃：请求里带着 AK/SK 签名，
    // 明文传输等于把凭证摊在链路上。公开域名只是取图，风险量级不同。
    if (config.endpoint) {
      assertAllowedExternalUrl(String(config.endpoint), { label: 'Endpoint' });
    }
    if (config.publicDomain) {
      assertAllowedExternalUrl(String(config.publicDomain), {
        label: '公开访问域名',
        allowConfirmedHttp: isHttpDomainConfirmed(config as HttpDomainConfirmable, String(config.publicDomain)),
      });
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return null;
}
