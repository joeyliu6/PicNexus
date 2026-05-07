// 编辑器服务集成 - 从 SettingsView.vue 提取
// 负责构建编辑器服务配置（Typora/Obsidian）、应用到后端、签名变更检测

import { ref, computed, watch, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../useToast';
import type { EditorServerConfig } from '../../config/types';
import { createLogger } from '../../utils/logger';
import { generateEditorServerAuthToken } from '../../utils/editorServerAuth';
import type { SettingsFormShape } from './settingsFormTypes';
import {
  buildCliServicesConfigJson,
  buildEditorCredentialSignature,
  buildServiceConfigJson,
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

  function ensureEditorServerAuthToken(cfg: EditorServerConfig): string {
    const existing = cfg.authToken?.trim();
    if (existing) return existing;

    const authToken = generateEditorServerAuthToken();
    formData.value.editorServer = { ...cfg, authToken };
    return authToken;
  }

  function buildObsidianApplyPayload(cfg: EditorServerConfig, authToken: string | null) {
    return {
      enabled: cfg.enabled,
      port: cfg.port,
      serviceConfigJson: buildServiceConfigJson(cfg.obsidianService, formData.value),
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
    const cliSig = fd.editorServer.cliEnabled === true ? `cli:${buildCliServicesConfigJson(fd)}` : 'cli:disabled';
    return `${typoraSig}|${obsidianSig}|${cliSig}`;
  });

  watch(activeEditorServiceSignature, () => {
    if (!isSettingsReady.value) return;
    debouncedApplyEditorServer();
  });

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
    const obsidianPayload = buildObsidianApplyPayload(activeCfg, authToken);
    const typoraConfigJson = buildServiceConfigJson(cfg.typoraService, formData.value);
    const cliServicesConfigJson = cfg.cliEnabled === true ? buildCliServicesConfigJson(formData.value) : null;
    const payloadKey = JSON.stringify({ obsidian: obsidianPayload, typora: typoraConfigJson, cli: cliServicesConfigJson });

    if (!force && payloadKey === lastAppliedEditorPayloadKey.value) {
      return true;
    }

    try {
      await invoke('update_server_config', obsidianPayload);
      await invoke('save_cli_config', { serviceConfigJson: typoraConfigJson, servicesConfigJson: cliServicesConfigJson });
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
