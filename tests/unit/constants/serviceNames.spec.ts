import { describe, it, expect, afterEach } from 'vitest';
import type { UserConfig } from '@/config/types';
import {
  getServiceDisplayName,
  registerProfileNameSource,
  resetProfileNameSource,
} from '@/constants/serviceNames';

function makeConfig(): UserConfig {
  return {
    custom_s3_profiles: [{ id: 's3a', name: '我的 MinIO' }],
    webdav_profiles: [{ id: 'davA', name: 'dufs 本地' }],
  } as unknown as UserConfig;
}

afterEach(() => {
  resetProfileNameSource();
});

describe('getServiceDisplayName', () => {
  it('maps builtin services from the static table', () => {
    expect(getServiceDisplayName('r2')).toBe('Cloudflare R2');
    expect(getServiceDisplayName('smms')).toBe('SM.MS');
    // 未知 ID 原样返回，不要凭空造名字
    expect(getServiceDisplayName('unknown-service')).toBe('unknown-service');
  });

  // 回归护栏：上传队列里 WebDAV 显示成 `WebDAV (msrlkrjz3...`。
  // 病因是调用点没传 config —— 全仓 31 处都没传，所以默认行为必须能查到名字。
  it('resolves multi-instance profile names without an explicit config argument', () => {
    registerProfileNameSource(() => makeConfig());

    expect(getServiceDisplayName('webdav:davA')).toBe('dufs 本地');
    expect(getServiceDisplayName('custom_s3:s3a')).toBe('我的 MinIO');
  });

  it('falls back to the id-bearing label when no source is registered', () => {
    // 没注册来源时不能抛错，只是查不到名字
    expect(getServiceDisplayName('webdav:davA')).toBe('WebDAV (davA)');
    expect(getServiceDisplayName('custom_s3:s3a')).toBe('自定义 S3 (s3a)');
  });

  it('keeps the id in the label when the profile is genuinely gone', () => {
    // 「没去查」要修，「查了但确实不存在」（profile 已删、历史记录仍引用）
    // 保留 ID 反而有助于排查，不能一并抹掉
    registerProfileNameSource(() => makeConfig());

    expect(getServiceDisplayName('webdav:deleted')).toBe('WebDAV (deleted)');
    expect(getServiceDisplayName('custom_s3:deleted')).toBe('自定义 S3 (deleted)');
  });

  it('prefers an explicitly passed config over the registered source', () => {
    // 调用方明确给了 config 就按它的来，不能被全局值覆盖
    registerProfileNameSource(() => makeConfig());
    const override = {
      webdav_profiles: [{ id: 'davA', name: '传入的名字' }],
    } as unknown as UserConfig;

    expect(getServiceDisplayName('webdav:davA', override)).toBe('传入的名字');
  });

  it('reads the source lazily so later config changes are picked up', () => {
    // 来源是个 getter 而不是快照：profile 改名后界面要能跟着变
    let current = makeConfig();
    registerProfileNameSource(() => current);
    expect(getServiceDisplayName('webdav:davA')).toBe('dufs 本地');

    current = {
      webdav_profiles: [{ id: 'davA', name: '改名后的 NAS' }],
    } as unknown as UserConfig;
    expect(getServiceDisplayName('webdav:davA')).toBe('改名后的 NAS');
  });
});
