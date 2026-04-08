// 编辑器服务集成 - 从 SettingsView.vue 提取
// 负责构建编辑器服务配置（Typora/Obsidian）、应用到后端、签名变更检测

import { ref, computed, watch, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast } from '../useToast';
import type { EditorServerConfig, ServerServiceType, CustomS3Profile } from '../../config/types';
import { isCustomS3Id, getCustomS3ProfileId } from '../../config/types';
import { createLogger } from '../../utils/logger';

interface UseEditorIntegrationOptions {
  formData: Ref<any>;
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

  // ---- 构建服务配置 JSON ----

  function buildServiceConfigJson(service: ServerServiceType | null): string | null {
    if (!service) return null;

    const svc = service;
    const fd = formData.value;

    switch (svc) {
      case 'jd':
        return JSON.stringify({ type: 'jd' });
      case 'qiyu':
        return JSON.stringify({ type: 'qiyu' });
      case 'github':
        return JSON.stringify({ type: 'github', token: fd.github.token, owner: fd.github.owner, repo: fd.github.repo, branch: fd.github.branch, path: fd.github.path });
      case 'smms':
        return JSON.stringify({ type: 'smms', token: fd.smms.token });
      case 'imgur':
        return JSON.stringify({ type: 'imgur', clientId: fd.imgur.clientId });
      case 'weibo':
        return JSON.stringify({ type: 'weibo', cookie: fd.weiboCookie });
      case 'bilibili':
        return JSON.stringify({ type: 'bilibili', cookie: fd.bilibili.cookie });
      case 'nowcoder':
        return JSON.stringify({ type: 'nowcoder', cookie: fd.nowcoder.cookie });
      case 'chaoxing':
        return JSON.stringify({ type: 'chaoxing', cookie: fd.chaoxing.cookie });
      case 'zhihu':
        return JSON.stringify({ type: 'zhihu', cookie: fd.zhihu.cookie });
      case 'nami': {
        const cookie = fd.nami.cookie;
        const tokenMatch = cookie.match(/token=([^;]+)/);
        const authToken = fd.nami.authToken || (tokenMatch ? tokenMatch[1] : '');
        return JSON.stringify({ type: 'nami', cookie, authToken });
      }
      case 'r2':
        return JSON.stringify({ type: 'r2', accountId: fd.r2.accountId, accessKeyId: fd.r2.accessKeyId, secretAccessKey: fd.r2.secretAccessKey, bucketName: fd.r2.bucketName, path: fd.r2.path, publicDomain: fd.r2.publicDomain });
      case 'tencent':
        return JSON.stringify({ type: 'tencent', secretId: fd.tencent.secretId, secretKey: fd.tencent.secretKey, region: fd.tencent.region, bucket: fd.tencent.bucket, path: fd.tencent.path, publicDomain: fd.tencent.publicDomain });
      case 'aliyun':
        return JSON.stringify({ type: 'aliyun', accessKeyId: fd.aliyun.accessKeyId, accessKeySecret: fd.aliyun.accessKeySecret, region: fd.aliyun.region, bucket: fd.aliyun.bucket, path: fd.aliyun.path, publicDomain: fd.aliyun.publicDomain });
      case 'qiniu':
        return JSON.stringify({ type: 'qiniu', accessKey: fd.qiniu.accessKey, secretKey: fd.qiniu.secretKey, region: fd.qiniu.region, bucket: fd.qiniu.bucket, customDomain: fd.qiniu.publicDomain, path: fd.qiniu.path });
      case 'upyun':
        return JSON.stringify({ type: 'upyun', operator: fd.upyun.operator, password: fd.upyun.password, bucket: fd.upyun.bucket, publicDomain: fd.upyun.publicDomain });
      default: {
        if (isCustomS3Id(svc)) {
          const profileId = getCustomS3ProfileId(svc);
          const profile = fd.custom_s3_profiles.find((p: CustomS3Profile) => p.id === profileId);
          if (profile) {
            return JSON.stringify({ type: svc, endpoint: profile.endpoint, accessKeyId: profile.accessKeyId, secretAccessKey: profile.secretAccessKey, region: profile.region, bucket: profile.bucket, path: profile.path, publicDomain: profile.publicDomain });
          }
        }
        return null;
      }
    }
  }

  function buildObsidianApplyPayload(cfg: EditorServerConfig) {
    return {
      enabled: cfg.enabled,
      port: cfg.port,
      serviceConfigJson: buildServiceConfigJson(cfg.obsidianService),
    };
  }

  // ---- 凭证签名（用于变更检测）----

  function buildEditorCredentialSignature(service: ServerServiceType, fd: typeof formData.value): string {
    switch (service) {
      case 'jd':
      case 'qiyu':
        return service;
      case 'github':
        return [fd.github.token, fd.github.owner, fd.github.repo, fd.github.branch, fd.github.path].join('|');
      case 'smms':
        return fd.smms.token;
      case 'imgur':
        return fd.imgur.clientId;
      case 'weibo':
        return fd.weiboCookie;
      case 'bilibili':
        return fd.bilibili.cookie;
      case 'nowcoder':
        return fd.nowcoder.cookie;
      case 'chaoxing':
        return fd.chaoxing.cookie;
      case 'zhihu':
        return fd.zhihu.cookie;
      case 'nami':
        return [fd.nami.cookie, fd.nami.authToken].join('|');
      case 'r2':
        return [fd.r2.accountId, fd.r2.accessKeyId, fd.r2.secretAccessKey, fd.r2.bucketName, fd.r2.path, fd.r2.publicDomain].join('|');
      case 'tencent':
        return [fd.tencent.secretId, fd.tencent.secretKey, fd.tencent.region, fd.tencent.bucket, fd.tencent.path, fd.tencent.publicDomain].join('|');
      case 'aliyun':
        return [fd.aliyun.accessKeyId, fd.aliyun.accessKeySecret, fd.aliyun.region, fd.aliyun.bucket, fd.aliyun.path, fd.aliyun.publicDomain].join('|');
      case 'qiniu':
        return [fd.qiniu.accessKey, fd.qiniu.secretKey, fd.qiniu.region, fd.qiniu.bucket, fd.qiniu.publicDomain, fd.qiniu.path].join('|');
      case 'upyun':
        return [fd.upyun.operator, fd.upyun.password, fd.upyun.bucket, fd.upyun.publicDomain].join('|');
      default: {
        if (isCustomS3Id(service)) {
          const profileId = getCustomS3ProfileId(service);
          const profile = fd.custom_s3_profiles.find((p: CustomS3Profile) => p.id === profileId);
          if (profile) return [profile.endpoint, profile.accessKeyId, profile.secretAccessKey, profile.region, profile.bucket, profile.path, profile.publicDomain].join('|');
        }
        return '';
      }
    }
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
    return `${typoraSig}|${obsidianSig}`;
  });

  watch(activeEditorServiceSignature, () => {
    if (!isSettingsReady.value) return;
    const cfg = formData.value.editorServer;
    if (!cfg.typoraService && !cfg.obsidianService) return;
    if (!cfg.enabled && !cfg.typoraEnabled) return;
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

    const obsidianPayload = buildObsidianApplyPayload(cfg);
    const cliConfigJson = buildServiceConfigJson(cfg.typoraService);
    const payloadKey = JSON.stringify({ obsidian: obsidianPayload, cli: cliConfigJson });

    if (!force && payloadKey === lastAppliedEditorPayloadKey.value) {
      return true;
    }

    try {
      await invoke('update_server_config', obsidianPayload);
      await invoke('save_cli_config', { serviceConfigJson: cliConfigJson });
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
