// 编辑器服务集成 - 从 SettingsView.vue 提取
// 负责构建编辑器服务配置（Typora/Obsidian）、应用到后端、签名变更检测

import { ref, computed, watch, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../useToast';
import type { EditorServerConfig } from '../../config/types';
import { isWebDAVId } from '../../config/types';
import { createLogger } from '../../utils/logger';
import { generateEditorServerAuthToken } from '../../utils/editorServerAuth';
import type { SettingsFormShape } from './settingsFormTypes';
import {
  buildCliServicesConfigJson,
  buildCliServicesSignature,
  buildEditorCredentialSignature,
  buildServiceConfigJson,
  resolveWebDAVPasswordsForCli,
  resolveWebDAVServicePassword,
} from './editorServiceConfig';

interface UseEditorIntegrationOptions {
  formData: Ref<SettingsFormShape>;
  isSettingsReady: Ref<boolean>;
  errorToString: (error: unknown) => string;
  debouncedApplyCallback?: () => void;
}

const log = createLogger('EditorIntegration');

export function useEditorIntegration(options: UseEditorIntegrationOptions) {
  const { formData, isSettingsReady, errorToString } = options;
  const toast = useToast();

  const lastAppliedEditorPayloadKey = ref<string | null>(null);
  let _debouncedEditorApplyTimer: ReturnType<typeof setTimeout> | null = null;
  // 明文降级只提示一次：`applyEditorServer` 每次改设置都会跑，逐次弹会变成噪音
  let _plaintextFallbackWarned = false;

  function ensureEditorServerAuthToken(cfg: EditorServerConfig): string {
    const existing = cfg.authToken?.trim();
    if (existing) return existing;

    const authToken = generateEditorServerAuthToken();
    formData.value.editorServer = { ...cfg, authToken };
    return authToken;
  }

  function buildObsidianApplyPayload(cfg: EditorServerConfig, authToken: string | null, webdavPassword?: string) {
    return {
      enabled: cfg.enabled,
      port: cfg.port,
      serviceConfigJson: buildServiceConfigJson(cfg.obsidianService, formData.value, webdavPassword),
      authToken,
    };
  }

  // ---- 签名变更检测 ----

  const activeEditorServiceSignature = computed(() => {
    const cfg = formData.value.editorServer;
    const fd = formData.value;
    const typoraSig = cfg.typoraService
      ? `typora:${cfg.typoraService}:${buildEditorCredentialSignature(cfg.typoraService, fd)}`
      : 'typora:none';
    const obsidianSig = cfg.obsidianService
      ? `obsidian:${cfg.obsidianService}:${buildEditorCredentialSignature(cfg.obsidianService, fd)}`
      : 'obsidian:none';
    const cliSig = fd.editorServer.cliEnabled === true ? `cli:${buildCliServicesSignature(fd)}` : 'cli:disabled';
    return `${typoraSig}|${obsidianSig}|${cliSig}`;
  });

  watch(activeEditorServiceSignature, () => {
    if (!isSettingsReady.value) return;
    debouncedApplyEditorServer();
  });

  /**
   * 钥匙串不可用、`cli-config.json` 退回明文时，必须让用户看见
   *
   * Why 不静默：Electron `safeStorage` 在 Linux 缺钥匙串时就是悄悄降级成近乎无加密的
   * 模式，大量用户在不知情的情况下裸奔。这里反着来——Rust 侧打 warn 日志，前端再弹一次
   * 提示。Windows/macOS 一定有钥匙串，正常情况下这条分支走不到。
   */
  function warnIfCliConfigPlaintext(outcome: { encrypted: boolean } | null): void {
    if (!outcome || outcome.encrypted !== false || _plaintextFallbackWarned) return;
    _plaintextFallbackWarned = true;
    log.warn('系统钥匙串不可用，cli-config.json 以明文写入');
    toast.showConfig('warn', {
      summary: '编辑器配置未能加密',
      detail: '系统钥匙串不可用，图床凭证以明文存放在本机配置文件中。文件权限已收紧到仅当前用户可读，但请勿将其外传或同步到云盘。',
    });
  }

  // ---- 应用编辑器配置 ----

  async function applyEditorServer(
    cfg: EditorServerConfig,
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    const { force = false } = options;

    if (!Number.isInteger(cfg.port) || cfg.port < 1024 || cfg.port > 65535) {
      return false;
    }

    const authToken = cfg.enabled ? ensureEditorServerAuthToken(cfg) : (cfg.authToken?.trim() || null);
    const activeCfg = formData.value.editorServer;

    try {
      // 只在服务真正启用时才解密——禁用时即使密文解不开（换机/密钥不匹配）也不该
      // 挡住"关掉这个服务"本身，否则用户想关服务都关不掉，只能卡在旧状态。
      const obsidianPassword = activeCfg.enabled && activeCfg.obsidianService && isWebDAVId(activeCfg.obsidianService)
        ? await resolveWebDAVServicePassword(activeCfg.obsidianService, formData.value)
        : undefined;
      const typoraPassword = cfg.typoraEnabled && cfg.typoraService && isWebDAVId(cfg.typoraService)
        ? await resolveWebDAVServicePassword(cfg.typoraService, formData.value)
        : undefined;
      const cliWebdavPasswords = cfg.cliEnabled === true
        ? await resolveWebDAVPasswordsForCli(formData.value)
        : undefined;

      const obsidianPayload = buildObsidianApplyPayload(activeCfg, authToken, obsidianPassword);
      const typoraConfigJson = buildServiceConfigJson(cfg.typoraService, formData.value, typoraPassword);
      const cliServicesConfigJson = cfg.cliEnabled === true ? buildCliServicesConfigJson(formData.value, cliWebdavPasswords) : null;
      const payloadKey = JSON.stringify({ obsidian: obsidianPayload, typora: typoraConfigJson, cli: cliServicesConfigJson });

      if (!force && payloadKey === lastAppliedEditorPayloadKey.value) {
        return true;
      }

      await invoke('update_server_config', obsidianPayload);
      const cliOutcome = await invoke<{ encrypted: boolean } | null>('save_cli_config', {
        serviceConfigJson: typoraConfigJson,
        servicesConfigJson: cliServicesConfigJson,
      });
      warnIfCliConfigPlaintext(cliOutcome);
      lastAppliedEditorPayloadKey.value = payloadKey;
      return true;
    } catch (e) {
      log.error('更新失败', e);
      toast.showConfig('error', { summary: '编辑器服务启动失败', detail: errorToString(e) });
      return false;
    }
  }

  function debouncedApplyEditorServer() {
    if (_debouncedEditorApplyTimer) clearTimeout(_debouncedEditorApplyTimer);
    _debouncedEditorApplyTimer = setTimeout(() => {
      _debouncedEditorApplyTimer = null;
      void applyEditorServer(formData.value.editorServer);
    }, 500);
  }

  // ---- 清理 ----

  function clearTimer() {
    if (_debouncedEditorApplyTimer) {
      clearTimeout(_debouncedEditorApplyTimer);
      _debouncedEditorApplyTimer = null;
    }
  }

  return {
    applyEditorServer,
    debouncedApplyEditorServer,
    clearTimer,
  };
}
