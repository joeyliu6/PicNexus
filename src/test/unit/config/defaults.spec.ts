import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../config/types';

describe('DEFAULT_CONFIG', () => {
  it('默认启用京东和七鱼图床', () => {
    expect(DEFAULT_CONFIG.enabledServices).toEqual(['jd', 'qiyu']);
    expect(DEFAULT_CONFIG.services.jd?.enabled).toBe(true);
    expect(DEFAULT_CONFIG.services.qiyu?.enabled).toBe(true);
  });
});
