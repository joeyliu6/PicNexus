import { describe, it, expect } from 'vitest';
import { LinkGenerator } from '../../../core/LinkGenerator';
import { DEFAULT_CONFIG } from '../../../config/types';
import type { UserConfig } from '../../../config/types';
import type { UploadResult } from '../../../uploaders/base/types';

function makeResult(serviceId: string, url = 'https://example.com/img.jpg'): UploadResult {
  return { serviceId, fileKey: 'test-key', url };
}

function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  return { ...DEFAULT_CONFIG, ...overrides };
}

describe('LinkGenerator.generate', () => {
  describe('微博 + baidu-proxy 模式', () => {
    it('有激活前缀 → 加前缀', () => {
      const config = makeConfig({
        weiboProxyMode: 'baidu-proxy',
        linkPrefixConfig: {
          enabled: true,
          selectedIndex: 0,
          prefixList: [{ name: 'Proxy', template: 'https://proxy.example.com/' }],
        },
      });
      const result = makeResult('weibo');
      expect(LinkGenerator.generate(result, config)).toBe(
        'https://proxy.example.com/https://example.com/img.jpg'
      );
    });

    it('前缀功能禁用 → 返回原始 URL', () => {
      const config = makeConfig({
        weiboProxyMode: 'baidu-proxy',
        linkPrefixConfig: {
          enabled: false,
          selectedIndex: 0,
          prefixList: [{ name: 'Proxy', template: 'https://proxy.example.com/' }],
        },
      });
      const result = makeResult('weibo');
      expect(LinkGenerator.generate(result, config)).toBe('https://example.com/img.jpg');
    });
  });

  describe('微博 + direct 模式', () => {
    it('→ 返回原始 URL（不加前缀）', () => {
      const config = makeConfig({
        weiboProxyMode: 'direct',
        linkPrefixConfig: {
          enabled: true,
          selectedIndex: 0,
          prefixList: [{ name: 'Proxy', template: 'https://proxy.example.com/' }],
        },
      });
      const result = makeResult('weibo');
      expect(LinkGenerator.generate(result, config)).toBe('https://example.com/img.jpg');
    });
  });

  describe('其他图床服务', () => {
    const otherServices = ['r2', 'github', 'tencent', 'aliyun', 'qiniu', 'upyun', 'smms', 'imgur'] as const;

    otherServices.forEach(serviceId => {
      it(`${serviceId} → 返回原始 URL`, () => {
        const config = makeConfig({
          weiboProxyMode: 'baidu-proxy',
          linkPrefixConfig: {
            enabled: true,
            selectedIndex: 0,
            prefixList: [{ name: 'Proxy', template: 'https://proxy.example.com/' }],
          },
        });
        const result = makeResult(serviceId);
        expect(LinkGenerator.generate(result, config)).toBe('https://example.com/img.jpg');
      });
    });
  });
});
