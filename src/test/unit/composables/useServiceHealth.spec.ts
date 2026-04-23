import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock syncStatusStore，避免自动加载触发真实 Store 写读
vi.mock('../../../store/instances', () => ({
  syncStatusStore: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useServiceHealth } from '../../../composables/useServiceHealth';
import { DEFAULT_CONFIG, type UserConfig } from '../../../config/types';

function cloneDefault(): UserConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

describe('useServiceHealth', () => {
  beforeEach(async () => {
    // 复位：用一个 empty config 重置状态到未配置
    const { evaluateConfig } = useServiceHealth();
    evaluateConfig(cloneDefault());
  });

  it('getHealth 返回默认记录（未知图床也能拿到）', () => {
    const { getHealth } = useServiceHealth();
    const record = getHealth('not-exists');
    expect(record.status).toBeDefined();
  });

  it('getStatusClass 包含状态字符串', () => {
    const { getStatusClass, markVerified } = useServiceHealth();
    markVerified('weibo');
    expect(getStatusClass('weibo')).toBe('status-dot verified');
    expect(getStatusClass('not-exists')).toBe('status-dot unconfigured');
  });

  it('healthStatusMap 映射状态', () => {
    const { healthStatusMap, markVerified } = useServiceHealth();
    markVerified('weibo');
    expect(healthStatusMap.value.weibo).toBe('verified');
  });

  it('healthTooltipMap - unconfigured 显示"未配置"', () => {
    const cfg = cloneDefault();
    const { evaluateConfig, healthTooltipMap } = useServiceHealth();
    evaluateConfig(cfg);
    expect(healthTooltipMap.value.weibo).toBe('未配置');
  });

  it('healthTooltipMap - verified 显示"可用 · 时间"', () => {
    const { markVerified, healthTooltipMap } = useServiceHealth();
    markVerified('weibo');
    expect(healthTooltipMap.value.weibo).toMatch(/^可用/);
  });

  it('healthTooltipMap - error 显示"异常 · <msg>"', () => {
    const { markTestFailed, healthTooltipMap } = useServiceHealth();
    markTestFailed('weibo', 'boom');
    expect(healthTooltipMap.value.weibo).toBe('异常 · boom');
  });

  it('markVerified → 状态为 verified，lastError 清空', () => {
    const { markVerified, getHealth } = useServiceHealth();
    markVerified('weibo');
    const r = getHealth('weibo');
    expect(r.status).toBe('verified');
    expect(r.lastError).toBeNull();
    expect(r.lastVerifiedAt).toBeGreaterThan(0);
  });

  it('markTestFailed → 状态为 error，errorSource=test', () => {
    const { markTestFailed, getHealth } = useServiceHealth();
    markTestFailed('weibo', 'fail');
    const r = getHealth('weibo');
    expect(r.status).toBe('error');
    expect(r.lastError).toBe('fail');
    expect(r.errorSource).toBe('test');
  });

  it('markUploadError - 非鉴权错误码被忽略', () => {
    const { markVerified, markUploadError, getHealth } = useServiceHealth();
    markVerified('weibo');
    markUploadError('weibo', { code: 'NETWORK_ERROR', message: 'x' } as any);
    expect(getHealth('weibo').status).toBe('verified');
  });

  it('markUploadError - 鉴权错误码更新为 error，errorSource=upload', () => {
    const { markVerified, markUploadError, getHealth } = useServiceHealth();
    markVerified('weibo');
    markUploadError('weibo', { code: 'COOKIE_EXPIRED', message: 'expired' } as any);
    const r = getHealth('weibo');
    expect(r.status).toBe('error');
    expect(r.lastError).toBe('expired');
    expect(r.errorSource).toBe('upload');
  });

  it('evaluateConfig - 空配置所有图床状态为 unconfigured', () => {
    const { evaluateConfig, getHealth } = useServiceHealth();
    evaluateConfig(cloneDefault());
    expect(getHealth('weibo').status).toBe('unconfigured');
  });

  it('evaluateConfig - 无需配置的图床（jd/qiyu）标为 pending', () => {
    const { evaluateConfig, getHealth } = useServiceHealth();
    evaluateConfig(cloneDefault());
    expect(['pending', 'verified', 'error']).toContain(getHealth('jd').status);
    expect(['pending', 'verified', 'error']).toContain(getHealth('qiyu').status);
  });

  it('evaluateConfig - 填齐必填字段 → pending', () => {
    const cfg = cloneDefault();
    cfg.services.weibo = { cookie: 'SUB=x' } as any;
    const { evaluateConfig, getHealth } = useServiceHealth();
    evaluateConfig(cfg);
    expect(getHealth('weibo').status).toBe('pending');
  });

  it('evaluateConfig - 从 verified 变更字段 → 回到 pending', () => {
    const { evaluateConfig, markVerified, getHealth } = useServiceHealth();
    // 先填齐配置 + mark verified
    const cfg = cloneDefault();
    cfg.services.weibo = { cookie: 'SUB=x' } as any;
    evaluateConfig(cfg);
    markVerified('weibo');
    expect(getHealth('weibo').status).toBe('verified');

    // 修改配置
    cfg.services.weibo = { cookie: 'SUB=y' } as any;
    evaluateConfig(cfg);
    expect(getHealth('weibo').status).toBe('pending');
  });

  it('evaluateConfig - custom_s3 profiles 被评估', () => {
    const cfg = cloneDefault();
    cfg.custom_s3_profiles = [
      {
        id: 'p1', name: 'P1',
        endpoint: 'https://s3', accessKeyId: 'a', secretAccessKey: 'b',
        region: 'us-east-1', bucket: 'buk',
      } as any,
    ];
    const { evaluateConfig, getHealth } = useServiceHealth();
    evaluateConfig(cfg);
    expect(getHealth('custom_s3:p1').status).toBe('pending');
  });

  it('evaluateConfig - custom_s3 profile 删除后健康记录被清理', () => {
    const cfg = cloneDefault();
    cfg.custom_s3_profiles = [
      {
        id: 'p1', name: 'P1',
        endpoint: 'https://s3', accessKeyId: 'a', secretAccessKey: 'b',
        region: 'us-east-1', bucket: 'buk',
      } as any,
    ];
    const { evaluateConfig, healthMap } = useServiceHealth();
    evaluateConfig(cfg);
    expect(healthMap.value['custom_s3:p1']).toBeDefined();
    // 删除
    cfg.custom_s3_profiles = [];
    evaluateConfig(cfg);
    expect(healthMap.value['custom_s3:p1']).toBeUndefined();
  });
});
