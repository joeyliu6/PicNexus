import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  saveConfig: vi.fn(),
  openCookieWebView: vi.fn(),
  listener: null as null | ((serviceId: string, cookie: string) => Promise<void>),
  fresh: {} as Record<string, unknown>,
}));

vi.mock('@/composables/useConfig', () => ({
  useConfigManager: () => ({
    saveConfig: state.saveConfig,
    openCookieWebView: state.openCookieWebView,
    setupCookieListener: vi.fn(async (handler: (serviceId: string, cookie: string) => Promise<void>) => {
      state.listener = handler;
      return vi.fn();
    }),
  }),
}));

vi.mock('@/store/instances', () => ({
  readFreshConfig: vi.fn(async () => state.fresh),
}));

import { __resetCookieLoginForTests, applyCookie, useCookieLogin } from '@/composables/useCookieLogin';

describe('useCookieLogin', () => {
  beforeEach(() => {
    __resetCookieLoginForTests();
    state.saveConfig.mockReset().mockResolvedValue(undefined);
    state.openCookieWebView.mockReset().mockResolvedValue(undefined);
    state.listener = null;
    state.fresh = { services: { weibo: { enabled: true, cookie: 'old' }, zhihu: { cookie: 'z-old' } } };
  });

  it('writes the weibo cookie into services.weibo and keeps it enabled', () => {
    const next = applyCookie({ services: {} } as never, 'weibo', 'SUB=new');
    expect(next.services.weibo).toEqual({ enabled: true, cookie: 'SUB=new' });
  });

  it('saves the cookie from the login window and then runs whoever was waiting for it', async () => {
    const { install, login } = useCookieLogin();
    await install();
    const retry = vi.fn();

    await login('weibo', retry);
    expect(state.openCookieWebView).toHaveBeenCalledWith('weibo');
    expect(retry).not.toHaveBeenCalled();

    await state.listener!('weibo', 'SUB=new');

    expect(state.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({ services: expect.objectContaining({ weibo: { enabled: true, cookie: 'SUB=new' } }) }),
      true,
    );
    expect(retry).toHaveBeenCalledTimes(1);

    await state.listener!('weibo', 'SUB=again');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('does not run a waiter for a different host', async () => {
    const { install, login } = useCookieLogin();
    await install();
    const retry = vi.fn();
    await login('weibo', retry);

    await state.listener!('zhihu', 'z-new');

    expect(retry).not.toHaveBeenCalled();
  });
});
