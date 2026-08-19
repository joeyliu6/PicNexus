import { getRestChainRequiredFields } from '../../constants/serviceRequiredFields';
import { assertAllowedExternalUrl } from '../../security/networkPolicy';

/**
 * 「测试连接」前的配置预校验
 *
 * 用 REST 口径而不是 GUI 口径：又拍云的 `test_upyun_connection` 打的是自家 REST API，
 * 只用得上 operator/password。拿 GUI 那对 S3 凭证卡这里，会让一个明明能跑的检测
 * 因为缺一把它用不到的钥匙而拒绝执行。其余图床两个口径完全一致，行为不变。
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
    if (config.endpoint) {
      assertAllowedExternalUrl(String(config.endpoint), { label: 'Endpoint' });
    }
    if (config.publicDomain) {
      assertAllowedExternalUrl(String(config.publicDomain), { label: '公开访问域名' });
    }
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return null;
}
