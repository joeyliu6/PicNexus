import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEmitMock, getListenMock, getTauriWindowMocks, resetTauriMocks } from '../../helpers/tauriMock';
import { DEFAULT_CONFIG, makeCustomS3Id, type UserConfig } from '../../../config/types';
import TrayMenuWindow from '../../../components/tray/TrayMenuWindow.vue';

const mockState = vi.hoisted(() => ({
  configGet: vi.fn(),
  configSet: vi.fn(),
  configSave: vi.fn(),
}));

vi.mock('../../../store/instances', () => ({
  configStore: {
    get: mockState.configGet,
    set: mockState.configSet,
    save: mockState.configSave,
  },
  syncStatusStore: {
    get: vi.fn(),
    set: vi.fn(),
  },
}));

import {
  buildTrayMenuItems,
  formatCurrentServicesLabel,
  getTrayServiceGroups,
  requiresPublicServiceRiskAcknowledgement,
  revealMainWindow,
  setupTrayMenu,
  toggleTrayService,
  type TrayMenuActions,
  type TrayMenuItem,
} from '../../../services/trayMenu';

type CommandItem = Extract<TrayMenuItem, { id: string; text: string }>;

const noopActions: TrayMenuActions = {
  openWindow: vi.fn(),
  uploadClipboard: vi.fn(),
  selectUploadFiles: vi.fn(),
  toggleService: vi.fn(),
  openHistory: vi.fn(),
  quit: vi.fn(),
};

function makeConfig(overrides: Partial<UserConfig> = {}): UserConfig {
  const config = structuredClone(DEFAULT_CONFIG) as UserConfig;

  config.availableServices = ['jd', 'qiyu', 'weibo', 'zhihu', 'r2', makeCustomS3Id('archive')];
  config.enabledServices = ['jd', 'qiyu'];
  config.publicServiceRiskAccepted = true;
  config.services = {
    ...config.services,
    weibo: { enabled: true, cookie: 'SUB=_token' },
    r2: {
      enabled: true,
      accountId: 'account-id',
      accessKeyId: 'access-key',
      secretAccessKey: 'secret-key',
      bucketName: 'bucket',
      path: '',
      publicDomain: 'https://r2.example.com',
    },
    zhihu: { enabled: true, cookie: '' },
  };
  config.custom_s3_profiles = [{
    id: 'archive',
    name: 'Archive S3',
    endpoint: 'https://s3.example.com',
    accessKeyId: 'access-key',
    secretAccessKey: 'secret-key',
    region: 'auto',
    bucket: 'archive',
    path: '',
    publicDomain: 'https://archive.example.com',
  }];

  return {
    ...config,
    ...overrides,
  };
}

function topItems(config = makeConfig()): TrayMenuItem[] {
  return buildTrayMenuItems(config, noopActions);
}

function currentServiceSubmenu(config = makeConfig()): CommandItem & { items: TrayMenuItem[] } {
  return topItems(config).find((item): item is CommandItem & { items: TrayMenuItem[] } =>
    'id' in item && item.id === 'current_service' && 'items' in item,
  )!;
}

function flattenText(items: TrayMenuItem[]): string[] {
  return items.map((item) => ('item' in item ? item.item : item.text));
}

function commandByText(items: TrayMenuItem[], text: string): CommandItem {
  const item = items.find((entry): entry is CommandItem => !('item' in entry) && entry.text === text);
  expect(item, `menu item text: ${text}`).toBeTruthy();
  return item!;
}

function findButton(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text().includes(text));
  expect(button, `button text: ${text}`).toBeTruthy();
  return button!;
}

describe('trayMenu', () => {
  beforeEach(() => {
    resetTauriMocks();
    vi.clearAllMocks();
    mockState.configGet.mockReset();
    mockState.configSet.mockReset();
    mockState.configSave.mockReset();
    mockState.configSet.mockResolvedValue(undefined);
    mockState.configSave.mockResolvedValue(undefined);
  });

  it('builds the requested top-level tray menu without copy latest link', () => {
    const labels = flattenText(topItems());

    expect(labels).toEqual([
      '打开界面',
      'Separator',
      '上传剪贴板',
      '选择图片…',
      '当前图床：京东、七鱼',
      'Separator',
      '历史记录',
      'Separator',
      '退出',
    ]);
    expect(labels).not.toContain('复制最近链接');
    expect(labels).not.toContain('退出 PicNexus');
  });

  it('lists configured services in upload-page group order with check states', () => {
    const items = currentServiceSubmenu().items;

    expect(flattenText(items)).toEqual([
      '微博',
      '七鱼',
      '京东',
      'Separator',
      'Cloudflare R2',
      'Separator',
      'Archive S3',
    ]);

    expect(commandByText(items, '京东').checked).toBe(true);
    expect(commandByText(items, '七鱼').checked).toBe(true);
    expect(commandByText(items, '微博').checked).toBe(false);
    expect(commandByText(items, 'Archive S3').checked).toBe(false);
    expect(flattenText(items)).not.toContain('知乎');
  });

  it('formats current service labels for zero, one, two, and many selections', () => {
    expect(formatCurrentServicesLabel(makeConfig({ enabledServices: [] }))).toBe('当前图床：未选择');
    expect(formatCurrentServicesLabel(makeConfig({ enabledServices: ['jd'] }))).toBe('当前图床：京东');
    expect(formatCurrentServicesLabel(makeConfig({ enabledServices: ['jd', 'qiyu'] }))).toBe('当前图床：京东、七鱼');
    expect(formatCurrentServicesLabel(makeConfig({ enabledServices: ['jd', 'qiyu', 'weibo'] }))).toBe('当前图床：京东等 3 个');
    expect(formatCurrentServicesLabel(makeConfig({
      enabledServices: ['jd', 'qiyu', 'weibo', 'r2', makeCustomS3Id('archive')],
    }))).toBe('当前图床：京东等 5 个');
  });

  it('returns visible configured service groups only', () => {
    const groups = getTrayServiceGroups(makeConfig({
      availableServices: ['jd', 'zhihu', makeCustomS3Id('archive')],
    }));

    expect(groups.publicServices.map((service) => service.id)).toEqual(['jd']);
    expect(groups.privateServices).toEqual([]);
    expect(groups.customS3Services.map((service) => service.label)).toEqual(['Archive S3']);
  });

  it('updates enabledServices when selecting or unselecting tray service items', async () => {
    mockState.configGet.mockResolvedValue(makeConfig({ enabledServices: ['jd', 'qiyu'] }));

    await toggleTrayService('qiyu');

    expect(mockState.configSet).toHaveBeenCalledWith('config', expect.objectContaining({
      enabledServices: ['jd'],
    }));
    expect(mockState.configSave).toHaveBeenCalled();
    expect(getEmitMock()).toHaveBeenCalledWith('config-updated', expect.objectContaining({ source: 'tray-menu' }));

    mockState.configSet.mockClear();
    mockState.configGet.mockResolvedValue(makeConfig({ enabledServices: ['jd'] }));

    await toggleTrayService('weibo');

    expect(mockState.configSet).toHaveBeenCalledWith('config', expect.objectContaining({
      enabledServices: ['jd', 'weibo'],
    }));
  });

  it('blocks tray enabling public risk services until the acknowledgement is recorded', async () => {
    const unacceptedConfig = makeConfig({
      enabledServices: ['jd'],
      publicServiceRiskAccepted: false,
    });
    expect(requiresPublicServiceRiskAcknowledgement('weibo', unacceptedConfig)).toBe(true);
    mockState.configGet.mockResolvedValue(unacceptedConfig);

    const blockedServices = await toggleTrayService('weibo');

    expect(blockedServices).toEqual(['jd']);
    expect(mockState.configSet).not.toHaveBeenCalled();
    expect(mockState.configSave).not.toHaveBeenCalled();

    const acceptedConfig = makeConfig({
      enabledServices: ['jd'],
      publicServiceRiskAccepted: false,
    });
    mockState.configGet.mockResolvedValue(acceptedConfig);

    const nextServices = await toggleTrayService('weibo', { acceptPublicServiceRisk: true });

    expect(nextServices).toEqual(['jd', 'weibo']);
    expect(mockState.configSet).toHaveBeenCalledWith('config', expect.objectContaining({
      enabledServices: ['jd', 'weibo'],
      publicServiceRiskAccepted: true,
    }));
  });

  it('allows all services to be unchecked', async () => {
    mockState.configGet.mockResolvedValue(makeConfig({ enabledServices: ['jd'] }));

    const nextServices = await toggleTrayService('jd');

    expect(nextServices).toEqual([]);
    expect(mockState.configSet).toHaveBeenCalledWith('config', expect.objectContaining({
      enabledServices: [],
    }));
  });

  it('keeps the custom tray menu and service submenu visible after toggling a service', async () => {
    let storedConfig = makeConfig({ enabledServices: ['jd', 'qiyu'] });
    mockState.configGet.mockImplementation(async () => storedConfig);
    mockState.configSet.mockImplementation(async (_key, value: UserConfig) => {
      storedConfig = value;
    });

    const wrapper = mount(TrayMenuWindow);
    await flushPromises();

    await findButton(wrapper, '当前图床').trigger('click');
    await flushPromises();
    await findButton(wrapper, '微博').trigger('click');

    await vi.waitFor(() => {
      expect(mockState.configSet).toHaveBeenCalledWith('config', expect.objectContaining({
        enabledServices: ['jd', 'qiyu', 'weibo'],
      }));
    });
    await flushPromises();

    expect(wrapper.find('.main-menu').exists()).toBe(true);
    expect(wrapper.find('.service-menu').exists()).toBe(true);
    expect(findButton(wrapper, '微博').attributes('aria-checked')).toBe('true');
    expect(getTauriWindowMocks().currentWindow.hide).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('routes unacknowledged public risk service toggles to hosting settings', async () => {
    mockState.configGet.mockResolvedValue(makeConfig({
      enabledServices: ['jd'],
      publicServiceRiskAccepted: false,
    }));

    const wrapper = mount(TrayMenuWindow);
    await flushPromises();

    await findButton(wrapper, '当前图床').trigger('click');
    await flushPromises();
    await findButton(wrapper, '微博').trigger('click');

    await vi.waitFor(() => {
      expect(getTauriWindowMocks().currentWindow.hide).toHaveBeenCalled();
      expect(getEmitMock()).toHaveBeenCalledWith('navigate-to', {
        view: 'settings',
        tab: 'hosting',
        section: 'weibo',
      });
    });
    expect(mockState.configSet).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('grants the tray menu window APIs needed to show the service flyout', () => {
    const capability = JSON.parse(
      readFileSync(resolve(process.cwd(), 'src-tauri/capabilities/default.json'), 'utf8'),
    ) as { windows: string[]; permissions: Array<string | object> };

    expect(capability.windows).toContain('tray-menu');
    expect(capability.permissions).toEqual(expect.arrayContaining([
      'core:window:allow-set-min-size',
      'core:window:allow-set-max-size',
      'core:window:allow-set-size',
      'core:window:allow-set-position',
    ]));
  });

  it('creates the custom tray menu window with a transparent background', () => {
    const mainRs = readFileSync(resolve(process.cwd(), 'src-tauri/src/main.rs'), 'utf8');

    expect(mainRs).toMatch(/WebviewWindowBuilder::new\([\s\S]*TRAY_MENU_WINDOW_LABEL[\s\S]*\)\s*[\s\S]*\.transparent\(true\)/);
  });

  it('sizes the tray window to its real content height instead of keeping extra blank space', async () => {
    mockState.configGet.mockResolvedValue(makeConfig());

    const wrapper = mount(TrayMenuWindow, {
      attachTo: document.body,
    });
    await flushPromises();

    const setSizeCalls = getTauriWindowMocks().currentWindow.setSize.mock.calls;
    expect(setSizeCalls.length).toBeGreaterThan(0);
    const lastSize = setSizeCalls.at(-1)?.[0] as { width: number; height: number };
    expect(lastSize.width).toBe(240);
    expect(lastSize.height).toBeLessThan(300);
    expect(lastSize.height).toBeGreaterThan(180);

    wrapper.unmount();
  });

  it('repositions the tray window leftward when the service flyout would overflow the right edge', async () => {
    mockState.configGet.mockResolvedValue(makeConfig());

    const { currentWindow, monitorFromPoint } = getTauriWindowMocks();
    currentWindow.outerPosition.mockResolvedValue({ x: 1700, y: 500 });
    currentWindow.scaleFactor.mockResolvedValue(1);
    monitorFromPoint.mockResolvedValue({
      name: 'Right Monitor',
      scaleFactor: 1,
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      workArea: {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1040 },
      },
    } as never);

    const wrapper = mount(TrayMenuWindow, {
      attachTo: document.body,
    });
    await flushPromises();

    await findButton(wrapper, '当前图床').trigger('click');
    await flushPromises();

    await vi.waitFor(() => {
      expect(currentWindow.setPosition).toHaveBeenCalled();
    });

    const lastPosition = currentWindow.setPosition.mock.calls.at(-1)?.[0] as { x: number; y: number };
    expect(lastPosition.x).toBe(1500);
    expect(lastPosition.y).toBe(500);
    expect(wrapper.find('.service-menu').exists()).toBe(true);

    wrapper.unmount();
  });

  it('repositions the tray window upward when the service flyout would overflow the bottom edge', async () => {
    mockState.configGet.mockResolvedValue(makeConfig());

    const { currentWindow, monitorFromPoint } = getTauriWindowMocks();
    currentWindow.outerPosition.mockResolvedValue({ x: 1200, y: 900 });
    currentWindow.scaleFactor.mockResolvedValue(1);
    monitorFromPoint.mockResolvedValue({
      name: 'Bottom Monitor',
      scaleFactor: 1,
      position: { x: 0, y: 0 },
      size: { width: 1920, height: 1080 },
      workArea: {
        position: { x: 0, y: 0 },
        size: { width: 1920, height: 1040 },
      },
    } as never);

    const wrapper = mount(TrayMenuWindow, {
      attachTo: document.body,
    });
    await flushPromises();

    await findButton(wrapper, '当前图床').trigger('click');
    await flushPromises();

    await vi.waitFor(() => {
      expect(currentWindow.setPosition).toHaveBeenCalled();
    });

    const lastPosition = currentWindow.setPosition.mock.calls.at(-1)?.[0] as { x: number; y: number };
    expect(lastPosition.x).toBe(1200);
    expect(lastPosition.y).toBeLessThan(900);
    expect(lastPosition.y).toBeGreaterThanOrEqual(0);
    expect(wrapper.find('.service-menu').exists()).toBe(true);

    wrapper.unmount();
  });

  it('hides the custom tray menu and dispatches upload commands for non-service actions', async () => {
    mockState.configGet.mockResolvedValue(makeConfig());

    const wrapper = mount(TrayMenuWindow);
    await flushPromises();

    await findButton(wrapper, '上传剪贴板').trigger('click');

    await vi.waitFor(() => {
      expect(getTauriWindowMocks().currentWindow.hide).toHaveBeenCalled();
      expect(getEmitMock()).toHaveBeenCalledWith('navigate-to', 'upload');
      expect(getEmitMock()).toHaveBeenCalledWith('tray-action', 'upload_clipboard');
    });

    wrapper.unmount();
  });

  it('continues showing the main window when unminimize is denied', async () => {
    const { labeledWindow } = getTauriWindowMocks();
    labeledWindow.unminimize.mockRejectedValueOnce(new Error('window.unminimize not allowed'));

    await expect(revealMainWindow()).resolves.toBeUndefined();

    expect(labeledWindow.unminimize).toHaveBeenCalled();
    expect(labeledWindow.show).toHaveBeenCalled();
    expect(labeledWindow.setFocus).toHaveBeenCalled();
  });

  it('refreshes the custom tray menu when configuration updates outside the tray menu', async () => {
    const handlers: Record<string, Array<(event: { payload?: unknown }) => void>> = {};
    getListenMock().mockImplementation(async (event, handler) => {
      handlers[event] ??= [];
      handlers[event].push(handler as (event: { payload?: unknown }) => void);
      return vi.fn();
    });

    let storedConfig = makeConfig({ enabledServices: ['jd'] });
    mockState.configGet.mockImplementation(async () => storedConfig);

    const wrapper = mount(TrayMenuWindow);
    await flushPromises();

    expect(wrapper.text()).toContain('当前图床：京东');

    storedConfig = makeConfig({ enabledServices: ['jd', 'qiyu', 'weibo'] });
    handlers['config-updated'][0]?.({ payload: { source: 'settings' } });
    await flushPromises();

    expect(wrapper.text()).toContain('当前图床：京东等 3 个');

    wrapper.unmount();
  });

  it('keeps setupTrayMenu as a compatibility cleanup hook', async () => {
    const cleanup = await setupTrayMenu();

    expect(cleanup).toEqual(expect.any(Function));
    expect(getListenMock()).not.toHaveBeenCalled();
  });
});
