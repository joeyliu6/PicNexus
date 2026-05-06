import { getRequiredFields } from '../../constants/serviceRequiredFields';
import { assertAllowedExternalUrl } from '../../security/networkPolicy';

export function validateS3Config(serviceId: string, config: Record<string, unknown>): string | null {
  const fields = getRequiredFields(serviceId);
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
