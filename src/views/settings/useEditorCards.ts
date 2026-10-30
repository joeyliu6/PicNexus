// 编辑器与命令行（S04）三张卡的状态：Typora / Obsidian 各用一个图床（Rust 侧上传只认一个），命令行在命令里用 --service 指定。
// 选了图床 = 接入（Obsidian 起本机服务），选「不使用」= 停用。编辑器服务的图床凭证由 editorSync 从配置里取并下发。
// Obsidian 进入这一组时静默探测一次；测试结果四种：连接正常 / 端口被占用 / 不是 PicNexus 服务 / 服务未启动（STATES S04）。
import { computed, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_CONFIG, type EditorServerConfig } from '@/config/types';
import { useUploadController } from '@/composables/upload/useUploadController';
import { applyEditorConfig } from '@/composables/settings/editorSync';
import { EDITOR_UNSUPPORTED_SERVICES } from '@/composables/settings/editorServiceConfig';
import { useToast } from '@/composables/useToast';
import { getErrorMessage, isAppError } from '@/types/errors';
import { createLogger } from '@/utils/logger';
import { useSettingsConfig } from './useSettingsConfig';

const log = createLogger('EditorCards');

type ObsidianState = 'off' | 'checking' | 'ok' | 'portBusy' | 'notPicnexus' | 'down';

export interface CliPathStatus {
  supported: boolean;
  inPath: boolean;
  executableDir: string;
  needsTerminalRestart: boolean;
  message?: string;
}

/** 端口范围（与 Rust 侧 / 旧设置页一致：避开系统保留端口） */
export function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1024 && value <= 65535;
}

/** 可执行文件路径带空格时加引号 */
export function quotePath(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path;
}

function messageOf(error: unknown): string {
  if (isAppError(error)) return error.data.message;
  return getErrorMessage(error) || '操作失败';
}

// 读到的状态留在模块里（同 settingsEffects 的开机自启）：这一组随切换分组重新挂载，
// 再进来时第一帧就是上次的结果，后台重读、变了才换，不先闪「尚未配置」「检测中…」再变回来
const executablePath = ref('');
const obsidian = ref<ObsidianState>('off');
const cliPath = ref<CliPathStatus | null>(null);

export function useEditorCards() {
  const settings = useSettingsConfig();
  const upload = useUploadController();
  const toast = useToast();

  const cliBusy = ref(false);

  const editor = computed<EditorServerConfig>(() => ({ ...DEFAULT_CONFIG.editorServer!, ...settings.config.value.editorServer }));
  /** 「上传到」菜单：已添加、编辑器能用的图床 */
  const hosts = computed(() => upload.hosts.value.filter((h) => !EDITOR_UNSUPPORTED_SERVICES.has(h.id)).map((h) => ({ id: h.id, name: h.name })));
  const hostName = (id: string | null) => (id ? hosts.value.find((h) => h.id === id)?.name ?? id : null);

  async function saveEditor(rowId: 'typora' | 'obsidian' | 'cli', patch: Partial<EditorServerConfig>): Promise<boolean> {
    const ok = await settings.patch(rowId, (c) => { c.editorServer = { ...DEFAULT_CONFIG.editorServer!, ...c.editorServer, ...patch }; });
    // 等这次下发完再往下走（探测端口要等服务按新设置重启）；内容没变时 editorSync 不会重复下发
    if (ok) await applyEditorConfig().catch((error) => log.warn('下发编辑器配置失败', error));
    return ok;
  }

  /** 进这一组时读一遍。Obsidian 没接入写「尚未配置」，刚接入、还没有结果写「检测中…」，有上次的结果就先照旧、静默重测 */
  async function load(): Promise<void> {
    if (!editor.value.enabled) obsidian.value = 'off';
    else if (obsidian.value === 'off') obsidian.value = 'checking';
    await Promise.all([
      invoke<string>('get_executable_path').catch(() => '').then((path) => { executablePath.value = path; }),
      refreshCliPath(),
      probeObsidian(),
    ]);
  }

  // ---- Typora ----

  function setTypora(id: string | null): Promise<boolean> {
    return saveEditor('typora', { typoraService: id, typoraEnabled: !!id });
  }

  // ---- Obsidian ----

  /** 「测试连接」、换图床、换端口：先写「检测中…」再出结果 */
  async function testObsidian(): Promise<void> {
    if (editor.value.enabled) obsidian.value = 'checking';
    await probeObsidian();
  }

  async function probeObsidian(): Promise<void> {
    if (!editor.value.enabled) { obsidian.value = 'off'; return; }
    const port = editor.value.port;
    try {
      // 走 Rust 发请求：/status 故意不带 CORS 许可，网页里直接 fetch 会被当成跨域拦掉
      const body = JSON.parse(await invoke<string>('check_editor_server_status', { port })) as { app?: string };
      obsidian.value = body.app === 'PicNexus' ? 'ok' : 'notPicnexus';
    } catch {
      const free = await invoke<boolean>('check_port_free', { port }).catch(() => true);
      obsidian.value = free ? 'down' : 'portBusy';
    }
  }

  async function setObsidian(id: string | null): Promise<void> {
    if (await saveEditor('obsidian', { obsidianService: id, enabled: !!id })) await testObsidian();
  }

  async function setPort(port: number): Promise<void> {
    if (!isValidPort(port) || port === editor.value.port) return;
    if (await saveEditor('obsidian', { port })) await testObsidian();
  }

  // ---- 命令行 ----

  async function refreshCliPath(): Promise<void> {
    try {
      cliPath.value = await invoke<CliPathStatus>('get_cli_path_status');
    } catch (error) {
      log.warn('读取命令行 PATH 状态失败', error);
      cliPath.value = null;
    }
  }

  /** 加入 PATH = 启用命令行（导出图床配置）+ 建命令入口；移除反过来。系统不支持加入 PATH 时只切换启用 */
  async function setCli(on: boolean): Promise<void> {
    if (cliBusy.value) return;
    cliBusy.value = true;
    try {
      if (on && !(await saveEditor('cli', { cliEnabled: true }))) return;
      if (cliPath.value?.supported) {
        try {
          cliPath.value = await invoke<CliPathStatus>(on ? 'add_cli_to_path' : 'remove_cli_from_path');
        } catch (error) {
          toast.error(on ? '未能加入 PATH' : '未能从 PATH 移除', `${messageOf(error)}，请重试`);
          return;
        }
      }
      if (!on) await saveEditor('cli', { cliEnabled: false });
    } finally {
      cliBusy.value = false;
    }
  }

  return { executablePath, editor, hosts, hostName, obsidian, cliPath, cliBusy, load, setTypora, setObsidian, setPort, testObsidian, setCli };
}
