/**
 * `getWebDAVClientAndPath` 的独立测试
 *
 * Why 单独一份：这个函数是备份/同步链路真正建连的地方，但 `configSync.spec.ts`、
 * `historySync.spec.ts` 等每一处都把它 `vi.mock` 掉了——于是「密文密码能不能解开、
 * 解不开会怎样」这一环在自动化里恰好是个洞，只能靠人工去真机点。
 *
 * 所以这份 spec 反着来：**不 mock** `backupSyncUtils`、`@/security/crypto`、
 * `@/utils/webdav`，让真的 `WebDAVClient` 带着真的 AES-GCM 密文跑起来，
 * 只在最外层（Tauri 的 `webdav_request`）换成假 fetch。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getWebDAVClientAndPath } from '@/composables/backup-sync/backupSyncUtils';
import { secureStorage } from '@/security/crypto';
import type { WebDAVProfile } from '@/config/types';
import type { useToast } from '@/composables/useToast';
import {
  getHttpFetchMock,
  mockInvokeResponse,
  resetTauriMocks,
} from '../../helpers/tauriMock';

/** 固定的 32 字节测试主密钥（Base64） */
function testKey(fill: number): string {
  const bytes = new Uint8Array(32).fill(fill);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const showConfigMock = vi.fn();

/** 只提供被测代码真正用到的那一个方法 */
function fakeToast(): ReturnType<typeof useToast> {
  return { showConfig: showConfigMock } as unknown as ReturnType<typeof useToast>;
}

function profile(overrides: Partial<WebDAVProfile> = {}): WebDAVProfile {
  return {
    id: 'p1',
    name: '测试服务器',
    // 用 https + 示例域名：备份链路的 URL 策略只放行 https 主机名与私网 IP 字面量
    url: 'https://dav.example.com/',
    username: 'user',
    remotePath: '/PicNexus/',
    ...overrides,
  };
}

/** 让 client 真的发一次请求，把它带上的请求头捞出来 */
async function captureAuthHeader(client: { testConnection: () => Promise<boolean> }) {
  getHttpFetchMock().mockResolvedValue({
    status: 207,
    text: async () => '',
  } as unknown as Response);

  await client.testConnection();

  const [, init] = getHttpFetchMock().mock.calls.at(-1) ?? [];
  return (init as { headers?: Record<string, string> } | undefined)?.headers?.Authorization;
}

beforeEach(async () => {
  resetTauriMocks();
  showConfigMock.mockReset();
  // resetTauriMocks 装的默认实现负责把 webdav_request 转发给假 fetch，
  // mockInvokeResponse 只在它前面插一条，不会顶掉转发
  mockInvokeResponse('get_or_create_secure_key', testKey(0x42));
  await secureStorage.forceReinit();
});

describe('getWebDAVClientAndPath · 密码解密', () => {
  /**
   * TODO.md 里那条「验证 backupSyncUtils 走密文确实通」的自动化版本
   *
   * 判据从「人去 GUI 点一次同步」变成「密文进去、正确的 Basic 头出来」——
   * 中间跨了真实的 AES-GCM 解密与 base64 编码两步。
   */
  it('用密文密码建连，发出的 Basic 头里是解密后的明文', async () => {
    const passwordEncrypted = await secureStorage.encrypt('nas-secret');
    expect(passwordEncrypted.startsWith('PNXENC:')).toBe(true);

    const result = await getWebDAVClientAndPath(
      profile({ passwordEncrypted }),
      'settings',
      fakeToast(),
    );

    expect(result).not.toBeNull();
    const authorization = await captureAuthHeader(result!.client);
    expect(authorization).toBe(`Basic ${btoa('user:nas-secret')}`);
  });

  /** 解不开必须响，不能静默降级成空密码——那会变成一个查不出原因的 401 */
  it('密文解不开时抛出可操作的错误，而不是悄悄用空密码', async () => {
    await expect(
      getWebDAVClientAndPath(
        profile({ passwordEncrypted: 'PNXENC:这不是合法密文' }),
        'settings',
        fakeToast(),
      ),
    ).rejects.toThrow('WebDAV 密码解密失败，请重新配置');
  });

  /** 老配置里还是明文密码：兼容分支要继续能用，否则升级即断连 */
  it('只有明文密码的老配置仍然能建连', async () => {
    const result = await getWebDAVClientAndPath(
      profile({ password: 'legacy-plain' }),
      'settings',
      fakeToast(),
    );

    expect(result).not.toBeNull();
    const authorization = await captureAuthHeader(result!.client);
    expect(authorization).toBe(`Basic ${btoa('user:legacy-plain')}`);
  });
});

describe('getWebDAVClientAndPath · 远程路径推导', () => {
  const cases: Array<{ remotePath: string; fileType: 'settings' | 'history'; expected: string }> = [
    { remotePath: '/PicNexus/', fileType: 'settings', expected: '/PicNexus/settings.json' },
    { remotePath: '/PicNexus', fileType: 'history', expected: '/PicNexus/history.json' },
    // 已经指向某个 .json 时，替换文件名而不是继续往后拼
    { remotePath: '/PicNexus/backup.json', fileType: 'settings', expected: '/PicNexus/settings.json' },
  ];

  it.each(cases)('$remotePath + $fileType → $expected', async ({ remotePath, fileType, expected }) => {
    const passwordEncrypted = await secureStorage.encrypt('pw');

    const result = await getWebDAVClientAndPath(
      profile({ passwordEncrypted, remotePath }),
      fileType,
      fakeToast(),
    );

    expect(result?.remotePath).toBe(expected);
  });

  it('remotePath 为空时回落到 /PicNexus/', async () => {
    const passwordEncrypted = await secureStorage.encrypt('pw');

    const result = await getWebDAVClientAndPath(
      profile({ passwordEncrypted, remotePath: '' }),
      'settings',
      fakeToast(),
    );

    expect(result?.remotePath).toBe('/PicNexus/settings.json');
  });
});

describe('getWebDAVClientAndPath · 配置不完整', () => {
  const incomplete: Array<{ name: string; value: WebDAVProfile | null }> = [
    { name: 'profile 为 null', value: null },
    { name: '缺 url', value: profile({ url: '', passwordEncrypted: 'PNXENC:x' }) },
    { name: '缺用户名', value: profile({ username: '', passwordEncrypted: 'PNXENC:x' }) },
    { name: '两种密码都没有', value: profile() },
  ];

  it.each(incomplete)('$name → 返回 null 并提示一次', async ({ value }) => {
    const result = await getWebDAVClientAndPath(value, 'settings', fakeToast());

    expect(result).toBeNull();
    expect(showConfigMock).toHaveBeenCalledTimes(1);
    expect(showConfigMock).toHaveBeenCalledWith(
      'warn',
      expect.objectContaining({ summary: '请先配置 WebDAV 连接' }),
    );
  });

  /** 早退必须发生在建连之前，别让一份残缺配置先去敲网络 */
  it('配置不全时不会发出任何请求', async () => {
    await getWebDAVClientAndPath(null, 'settings', fakeToast());

    expect(getHttpFetchMock()).not.toHaveBeenCalled();
  });
});
