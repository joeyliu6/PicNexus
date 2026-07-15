import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@/config/types';

describe('DEFAULT_CONFIG', () => {
  it('默认不选中需要风险确认的公共图床', () => {
    expect(DEFAULT_CONFIG.enabledServices).toEqual([]);
    expect(DEFAULT_CONFIG.availableServices).not.toContain('jd');
    expect(DEFAULT_CONFIG.availableServices).not.toContain('qiyu');
    expect(DEFAULT_CONFIG.services.jd?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.services.qiyu?.enabled).toBe(true);
  });
});
