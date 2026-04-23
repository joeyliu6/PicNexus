// 连接测试逻辑 - 从 SettingsView.vue 提取
// 负责单项连接测试、批量测试编排，并统一接入共享检测 runner

import { type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast, suppressToasts } from '../useToast';
import { useServiceAvailability, probeBuiltinServiceAvailability } from '../useServiceAvailability';
import { useServiceHealth } from '../useServiceHealth';
import { buildServiceCheckSummarySnapshot, useServiceCheckRunner } from '../useServiceCheckRunner';
import { TOAST_MESSAGES } from '../../constants';
import type { ServiceType, CustomS3Profile } from '../../config/types';
import { isCustomS3Id, getCustomS3ProfileId } from '../../config/types';
import type { SettingsFormShape } from './useSettingsForm';
import type { ServiceHealthStatus } from '../../types/serviceHealth';

interface UseConnectionTestOptions {
  formData: Ref<SettingsFormShape>;
  serviceNames: Record<ServiceType, string>;
  errorToString: (error: unknown) => string;
  validateS3Config: (serviceId: ServiceType, config: Record<string, unknown>) => string | null;
}

export function useConnectionTest(options: UseConnectionTestOptions) {
  const { formData, serviceNames, errorToString, validateS3Config } = options;

  const toast = useToast();
  const serviceHealth = useServiceHealth();
  const {
    qiyuAvailable,
    jdAvailable,
    isCheckingQiyu,
    isCheckingJd,
  } = useServiceAvailability();

  const {
    testingConnections,
    activeSession,
    visibleRefreshingServiceIds,
    isBatchTesting,
    batchTestProgress,
    batchTestCompletionKey,
    runServiceChecks,
    cancelBatchTest,
  } = useServiceCheckRunner();

  // ---- 单项测试函数 ----

  async function testTokenConnection(serviceId: string, token: string) {
    try {
      if (serviceId === 'smms') {
        const res = await fetch('https://sm.ms/api/v2/upload', {
          method: 'POST',
          headers: { Authorization: token },
        });
        if (!res.ok) throw new Error('Token 无效');
      } else if (serviceId === 'imgur') {
        const res = await fetch('https://api.imgur.com/3/account/albums', {
          headers: { Authorization: `Client-ID ${token}` },
        });
        if (!res.ok) throw new Error('Client ID 无效');
      }
      toast.showConfig('success', TOAST_MESSAGES.auth.tokenValid(serviceNames[serviceId as ServiceType]));
    } catch (error) {
      toast.showConfig('error', TOAST_MESSAGES.auth.tokenFailed(serviceNames[serviceId as ServiceType], String(error)));
      throw error;
    }
  }

  async function testGitHubConnection() {
    try {
      const config = formData.value.github;
      const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}`, {
        headers: { Authorization: `token ${config.token}`, 'User-Agent': 'PicNexus' },
      });
      if (!res.ok) throw new Error('验证失败');
      toast.showConfig('success', TOAST_MESSAGES.auth.configValid('GitHub'));
    } catch (error) {
      toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed('GitHub', String(error)));
      throw error;
    }
  }

  async function testS3Connection(serviceId: string) {
    let config: Record<string, unknown>;
    let displayName: string;

    if (isCustomS3Id(serviceId)) {
      const profileId = getCustomS3ProfileId(serviceId);
      const profile = formData.value.custom_s3_profiles.find((item: CustomS3Profile) => item.id === profileId);
      if (!profile) throw new Error('找不到该自定义 S3 配置');
      config = { ...profile };
      displayName = profile.name || '自定义 S3';
    } else {
      config = formData.value[serviceId as 'r2' | 'tencent' | 'aliyun' | 'qiniu' | 'upyun'] as unknown as Record<string, unknown>;
      displayName = serviceNames[serviceId as ServiceType];
    }

    const validationError = validateS3Config(serviceId as ServiceType, config);
    if (validationError) {
      toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed(displayName, validationError));
      throw new Error(validationError);
    }

    try {
      await invoke('test_s3_connection', { serviceId, config });
      toast.showConfig('success', TOAST_MESSAGES.auth.configValid(displayName));
    } catch (error) {
      const msg = errorToString(error);
      toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed(displayName, msg));
      throw error;
    }
  }

  async function testCookieConnection(command: string, params: Record<string, string>, serviceId: ServiceType) {
    try {
      await invoke(command, params);
      toast.showConfig('success', TOAST_MESSAGES.auth.cookieValid(serviceNames[serviceId]));
    } catch (error) {
      toast.showConfig('error', TOAST_MESSAGES.auth.testFailed(String(error)));
      throw error;
    }
  }

  // ---- 服务测试路由 ----

  const actions: Record<string, () => Promise<void>> = {
    r2: () => testS3Connection('r2'),
    tencent: () => testS3Connection('tencent'),
    aliyun: () => testS3Connection('aliyun'),
    qiniu: () => testS3Connection('qiniu'),
    upyun: () => testS3Connection('upyun'),
    smms: () => testTokenConnection('smms', formData.value.smms.token),
    github: () => testGitHubConnection(),
    imgur: () => testTokenConnection('imgur', formData.value.imgur.clientId),
    weibo: () => testCookieConnection('test_weibo_connection', { weiboCookie: formData.value.weiboCookie || '' }, 'weibo'),
    zhihu: () => testCookieConnection('test_zhihu_connection', { zhihuCookie: formData.value.zhihu?.cookie || '' }, 'zhihu'),
    nowcoder: () => testCookieConnection('test_nowcoder_cookie', { nowcoderCookie: formData.value.nowcoder?.cookie || '' }, 'nowcoder'),
    bilibili: () => testCookieConnection('test_bilibili_connection', { bilibiliCookie: formData.value.bilibili?.cookie || '' }, 'bilibili'),
    chaoxing: () => testCookieConnection('test_chaoxing_connection', { chaoxingCookie: formData.value.chaoxing?.cookie || '' }, 'chaoxing'),
    nami: () => {
      const cookie = formData.value.nami.cookie || '';
      const tokenMatch = cookie.match(/token=([^;]+)/);
      const authToken = formData.value.nami.authToken || (tokenMatch ? tokenMatch[1] : '');
      return testCookieConnection('test_nami_connection', { cookie, authToken }, 'nami');
    },
    jd: () => probeBuiltinServiceAvailability('jd', true),
    qiyu: () => probeBuiltinServiceAvailability('qiyu', true),
  };

  // ---- 预校验 ----

  const S3_SERVICE_IDS: ServiceType[] = ['r2', 'tencent', 'aliyun', 'qiniu', 'upyun'];

  function preValidateService(serviceId: string): string | null {
    if (isCustomS3Id(serviceId)) {
      const profileId = getCustomS3ProfileId(serviceId);
      const profile = formData.value.custom_s3_profiles.find((item: CustomS3Profile) => item.id === profileId);
      if (!profile) return '找不到该自定义 S3 配置';
      return validateS3Config(serviceId as ServiceType, profile as unknown as Record<string, unknown>);
    }

    if (S3_SERVICE_IDS.includes(serviceId as ServiceType)) {
      const config = formData.value[serviceId as 'r2' | 'tencent' | 'aliyun' | 'qiniu' | 'upyun'] as unknown as Record<string, unknown>;
      return validateS3Config(serviceId as ServiceType, config);
    }

    return null;
  }

  function getServiceLabel(serviceId: string): string {
    if (isCustomS3Id(serviceId)) {
      const profileId = getCustomS3ProfileId(serviceId);
      const profile = formData.value.custom_s3_profiles.find((item: CustomS3Profile) => item.id === profileId);
      return profile?.name || '自定义 S3';
    }

    return serviceNames[serviceId as ServiceType] || serviceId;
  }

  function getHealthStatus(serviceId: string): ServiceHealthStatus {
    return serviceHealth.healthStatusMap.value[serviceId] ?? 'pending';
  }

  function getHealthStatusMapSnapshot(): Record<string, ServiceHealthStatus> {
    return serviceHealth.healthStatusMap.value ?? {};
  }

  const BUILTIN_PROBE_IDS = new Set<string>(['jd', 'qiyu']);
  const BUILTIN_LABELS: Record<string, string> = { jd: '京东图床', qiyu: '七鱼图床' };

  function resolveServiceTask(serviceId: string): (() => Promise<void>) | undefined {
    return isCustomS3Id(serviceId) ? () => testS3Connection(serviceId) : actions[serviceId];
  }

  async function executeServiceTask(serviceId: string, task: () => Promise<void>) {
    const isBuiltinProbe = BUILTIN_PROBE_IDS.has(serviceId);
    try {
      const validationError = preValidateService(serviceId);
      if (validationError) {
        serviceHealth.markTestFailed(serviceId, validationError);
        // 预校验失败时，下游 task（testS3Connection）不会执行，需在此补一条错误 toast；
        // 批量路径有 suppressToasts 吃掉，不会打扰用户。
        toast.showConfig(
          'error',
          TOAST_MESSAGES.auth.connectionFailed(getServiceLabel(serviceId), validationError)
        );
        throw new Error(validationError);
      }

      await task();

      if (!isBuiltinProbe) serviceHealth.markVerified(serviceId);
    } catch (error) {
      if (!isBuiltinProbe) serviceHealth.markTestFailed(serviceId, errorToString(error));
      throw error;
    }
  }

  async function runSingleServiceCheck(serviceId: string) {
    const task = resolveServiceTask(serviceId);
    if (!task) return;

    await runServiceChecks({
      mode: 'single',
      tasks: [{
        serviceId,
        label: getServiceLabel(serviceId),
        run: () => executeServiceTask(serviceId, task),
      }],
      baselineStatuses: {
        [serviceId]: getHealthStatus(serviceId),
      },
      summarySnapshot: buildServiceCheckSummarySnapshot(getHealthStatusMapSnapshot()),
      resolveStatus: getHealthStatus,
    });
  }

  // ---- 暴露给设置页的方法 ----

  async function handleServiceTest(serviceId: string) {
    await runSingleServiceCheck(serviceId);
  }

  async function handleBuiltinCheck(serviceId: string) {
    if (!BUILTIN_PROBE_IDS.has(serviceId)) return;

    await runSingleServiceCheck(serviceId);

    const available = serviceId === 'jd' ? jdAvailable.value : qiyuAvailable.value;
    const label = BUILTIN_LABELS[serviceId];
    toast.showConfig('info', available
      ? TOAST_MESSAGES.auth.serviceAvailable(label)
      : TOAST_MESSAGES.auth.serviceUnavailable(label));
  }

  async function testAllConfiguredServices() {
    if (isBatchTesting.value) return;

    const serviceIds = Object.entries(serviceHealth.healthStatusMap.value)
      .filter(([serviceId, status]) => {
        if (status === 'unconfigured') return false;
        return isCustomS3Id(serviceId) || !!actions[serviceId];
      })
      .map(([serviceId]) => serviceId);

    if (serviceIds.length === 0) return;

    suppressToasts(true);

    try {
      await runServiceChecks({
        mode: 'batch',
        tasks: serviceIds.map((serviceId) => ({
          serviceId,
          label: getServiceLabel(serviceId),
          run: () => executeServiceTask(serviceId, resolveServiceTask(serviceId)!),
        })),
        baselineStatuses: Object.fromEntries(
          serviceIds.map((serviceId) => [serviceId, getHealthStatus(serviceId)])
        ) as Record<string, ServiceHealthStatus>,
        summarySnapshot: buildServiceCheckSummarySnapshot(getHealthStatusMapSnapshot()),
        resolveStatus: getHealthStatus,
      });
    } finally {
      suppressToasts(false);
    }
  }

  return {
    qiyuAvailable,
    jdAvailable,
    isCheckingQiyu,
    isCheckingJd,
    testingConnections,
    activeSession,
    visibleRefreshingServiceIds,
    isBatchTesting,
    batchTestProgress,
    batchTestCompletionKey,
    handleServiceTest,
    handleBuiltinCheck,
    testAllConfiguredServices,
    cancelBatchTest,
  };
}
