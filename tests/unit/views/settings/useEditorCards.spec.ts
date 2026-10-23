// 编辑器与命令行：Obsidian 四种探测结果；命令行加入 / 移除 PATH 与启用的先后
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computed } from 'vue';
import { DEFAULT_CONFIG, type UserConfig } from '@/config/types';
import { getInvokeMock, resetTauriMocks, setupInvokeHandler } from '../../helpers/tauriMock';

const m = vi.hoisted(() => ({
  config: { value: null as unknown as UserConfig },
  patch: vi.fn(),
  apply: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/views/settings/useSettingsConfig', () => ({ useSettingsConfig: () => ({ config: m.config, patch: m.patch }) }));
vi.mock('@/composables/settings/editorSync', () => ({ applyEditorConfig: m.apply }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: m.toastError }) }));
vi.mock('@/composables/upload/useUploadController', () => ({
  useUploadController: () => ({ hosts: computed(() => [{ id: 'jd', name: '京东' }, { id: 'qiyu', name: '七鱼' }]) }),
}));

import { isValidPort, useEditorCards } from '@/views/settings/useEditorCards';

beforeEach(() => {
  resetTauriMocks();
  m.config.value = structuredClone(DEFAULT_CONFIG);
  m.patch.mockReset().mockImplementation(async (_row: string, mutate: (c: UserConfig) => void) => { mutate(m.config.value); return true; });
  m.apply.mockReset().mockResolvedValue({ ok: true });
  m.toastError.mockReset();
});

describe('useEditorCards', () => {
  it('offers only hosts editors can use (七鱼 needs a browser)', () => {
    expect(useEditorCards().hosts.value).toEqual([{ id: 'jd', name: '京东' }]);
  });

  it('picking a host for Obsidian turns the local service on, applies it, then probes', async () => {
    setupInvokeHandler(async (cmd) => (cmd === 'check_editor_server_status' ? JSON.stringify({ app: 'PicNexus' }) : undefined));
    const cards = useEditorCards();
    await cards.setObsidian('jd');
    expect(m.config.value.editorServer).toMatchObject({ enabled: true, obsidianService: 'jd' });
    expect(m.apply).toHaveBeenCalled();
    expect(cards.obsidian.value).toBe('ok');
  });

  it.each([
    [{ app: 'PicGo' }, true, 'notPicnexus'],
    [null, false, 'portBusy'],
    [null, true, 'down'],
  ])('probe: status %j, port free %s → %s', async (status, free, expected) => {
    m.config.value.editorServer = { ...DEFAULT_CONFIG.editorServer!, enabled: true, obsidianService: 'jd' };
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'check_editor_server_status') {
        if (!status) throw new Error('connection refused');
        return JSON.stringify(status);
      }
      if (cmd === 'check_port_free') return free;
      return undefined;
    });
    const cards = useEditorCards();
    await cards.testObsidian();
    expect(cards.obsidian.value).toBe(expected);
  });

  it('加入 PATH: turns the CLI on first so the command has config to read', async () => {
    const order: string[] = [];
    m.patch.mockImplementation(async (_row: string, mutate: (c: UserConfig) => void) => { mutate(m.config.value); order.push(`cliEnabled=${m.config.value.editorServer?.cliEnabled}`); return true; });
    setupInvokeHandler(async (cmd) => {
      order.push(cmd);
      return { supported: true, inPath: cmd === 'add_cli_to_path', executableDir: 'C:/PicNexus', needsTerminalRestart: false };
    });
    const cards = useEditorCards();
    await cards.load();
    order.length = 0;
    await cards.setCli(true);
    expect(order).toEqual(['cliEnabled=true', 'add_cli_to_path']);
    expect(cards.cliPath.value?.inPath).toBe(true);
  });

  // 每次切到这一组都是一套新的卡片（组件随分组卸载）；读到的状态要留到下次，进组时第一帧就对
  describe('entering the group (each visit mounts a new card set)', () => {
    const OBSIDIAN_ON = { ...DEFAULT_CONFIG.editorServer!, enabled: true, obsidianService: 'jd', cliEnabled: true };
    const CLI = { supported: true, inPath: true, executableDir: 'C:/PicNexus', needsTerminalRestart: false };
    const neverAnswers = () => new Promise<never>(() => {});

    async function visitWithAnswers(): Promise<void> {
      setupInvokeHandler(async (cmd) => {
        if (cmd === 'check_editor_server_status') return JSON.stringify({ app: 'PicNexus' });
        if (cmd === 'get_executable_path') return 'C:/PicNexus/picnexus.exe';
        return CLI;
      });
      await useEditorCards().load();
    }

    it('Obsidian just turned on: says 检测中… from the first frame, never 尚未配置', async () => {
      m.config.value.editorServer = { ...DEFAULT_CONFIG.editorServer!, enabled: false };
      await visitWithAnswers();
      m.config.value.editorServer = OBSIDIAN_ON;
      setupInvokeHandler(async () => neverAnswers());
      const cards = useEditorCards();
      void cards.load();
      expect(cards.obsidian.value).toBe('checking');
    });

    it('a later visit keeps showing the last results while it checks again quietly', async () => {
      m.config.value.editorServer = OBSIDIAN_ON;
      await visitWithAnswers();
      setupInvokeHandler(async () => neverAnswers());
      const again = useEditorCards();
      void again.load();
      expect(again.obsidian.value).toBe('ok');
      expect(again.executablePath.value).toBe('C:/PicNexus/picnexus.exe');
      expect(again.cliPath.value).toEqual(CLI);
    });

    it('a later visit after Obsidian was turned off says 尚未配置 at once, not the old result', async () => {
      m.config.value.editorServer = OBSIDIAN_ON;
      await visitWithAnswers();
      m.config.value.editorServer = { ...DEFAULT_CONFIG.editorServer!, enabled: false };
      setupInvokeHandler(async () => neverAnswers());
      const again = useEditorCards();
      void again.load();
      expect(again.obsidian.value).toBe('off');
    });

    it('测试连接 still shows 检测中… while it checks', async () => {
      m.config.value.editorServer = OBSIDIAN_ON;
      await visitWithAnswers();
      setupInvokeHandler(async () => neverAnswers());
      const cards = useEditorCards();
      void cards.testObsidian();
      expect(cards.obsidian.value).toBe('checking');
    });
  });

  it('从 PATH 移除 that fails keeps the CLI on and says so in red', async () => {
    m.config.value.editorServer = { ...DEFAULT_CONFIG.editorServer!, cliEnabled: true };
    setupInvokeHandler(async (cmd) => {
      if (cmd === 'get_cli_path_status') return { supported: true, inPath: true, executableDir: 'C:/PicNexus', needsTerminalRestart: false };
      if (cmd === 'remove_cli_from_path') throw new Error('拒绝访问');
      return '';
    });
    const cards = useEditorCards();
    await cards.load();
    await cards.setCli(false);
    expect(m.toastError).toHaveBeenCalledWith('未能从 PATH 移除', '拒绝访问，请重试');
    expect(m.config.value.editorServer?.cliEnabled).toBe(true);
    expect(getInvokeMock()).toHaveBeenCalledWith('remove_cli_from_path');
  });
});

describe('isValidPort', () => {
  it('只收 1024–65535 的整数（系统保留端口、小数、超范围都不收）', () => {
    expect(isValidPort(36677)).toBe(true);
    expect(isValidPort(1024)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
    expect(isValidPort(1023)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(3667.5)).toBe(false);
    expect(isValidPort(Number.NaN)).toBe(false);
  });
});
