// 连接测试逻辑 - 从 SettingsView.vue 提取
// 负责单项连接测试、批量测试引擎

import { ref, type Ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { useToast, suppressToasts } from '../useToast';
import { useServiceAvailability } from '../useServiceAvailability';
import { useServiceHealth } from '../useServiceHealth';
import { TOAST_MESSAGES } from '../../constants';
import type { ServiceType, CustomS3Profile } from '../../config/types';
import { isCustomS3Id, getCustomS3ProfileId } from '../../config/types';
import type { BatchTestProgress } from '../../types/batchTest';

const MIN_DISPLAY_MS = 300;
const COMPLETE_LINGER_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface UseConnectionTestOptions {
  formData: Ref<any>;
  serviceNames: Record<ServiceType, string>;
  availableServices: Ref<string[]>;
  testingConnections: Ref<Record<string, boolean>>;
  errorToString: (error: unknown) => string;
  validateS3Config: (serviceId: ServiceType, config: Record<string, unknown>) => string | null;
}

export function useConnectionTest(options: UseConnectionTestOptions) {
  const { formData, serviceNames, testingConnections, errorToString, validateS3Config } = options;

  const toast = useToast();
  const serviceHealth = useServiceHealth();
  const {
    qiyuAvailable, jdAvailable,
    isCheckingQiyu, isCheckingJd,
    checkQiyuAvailability, checkJdAvailable,
  } = useServiceAvailability();

  // ---- 批量测试状态 ----

  const isBatchTesting = ref(false);
  const batchTestProgress = ref<BatchTestProgress | null>(null);
  const batchTestAborted = ref(false);
  const batchTestCompletionKey = ref(0);

  // ---- 单项测试函数 ----

  async function testTokenConnection(serviceId: string, token: string) {
    try {
      if (serviceId === 'smms') {
        const res = await fetch('https://sm.ms/api/v2/upload', {
          method: 'POST',
          headers: { 'Authorization': token }
        });
        if (!res.ok) throw new Error('Token 无效');
      } else if (serviceId === 'imgur') {
        const res = await fetch('https://api.imgur.com/3/account/albums', {
          headers: { 'Authorization': `Client-ID ${token}` }
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
        headers: { 'Authorization': `token ${config.token}`, 'User-Agent': 'PicNexus' }
      });
      if (!res.ok) throw new Error('验证失败');
      toast.showConfig('success', TOAST_MESSAGES.auth.configValid('GitHub'));
    } catch (error) {
      toast.showConfig('error', TOAST_MESSAGES.auth.connectionFailed('GitHub', String(error)));
      throw error;
    }
  }

  async function testS3Connection(serviceId: string) {
    let config: any;
    let displayName: string;

    if (isCustomS3Id(serviceId)) {
      const profileId = getCustomS3ProfileId(serviceId);
      const profile = formData.value.custom_s3_profiles.find((p: CustomS3Profile) => p.id === profileId);
      if (!profile) throw new Error('找不到该自定义 S3 配置');
      config = { ...profile };
      displayName = profile.name || '自定义 S3';
    } else {
      config = formData.value[serviceId as keyof typeof formData.value] as any;
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

  async function testConn(fn: () => Promise<void>, key: string) {
    testingConnections.value[key] = true;
    try {
      await fn();
      serviceHealth.markVerified(key as ServiceType);
    } catch (e) {
      serviceHealth.markTestFailed(key as ServiceType, errorToString(e));
    } finally {
      testingConnections.value[key] = false;
    }
  }

  async function testCookieConnection(command: string, params: Record<string, string>, serviceId: ServiceType) {
    try {
      await invoke(command, params);
      toast.showConfig('success', TOAST_MESSAGES.auth.cookieValid(serviceNames[serviceId]));
    } catch (e) {
      toast.showConfig('error', TOAST_MESSAGES.auth.testFailed(String(e)));
      throw e;
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
    jd: async () => {
      await checkJdAvailable(true);
      if (!jdAvailable.value) throw new Error('京东图床当前不可用');
    },
    qiyu: async () => {
      await checkQiyuAvailability(true);
      if (!qiyuAvailable.value) throw new Error('七鱼图床当前不可用');
    },
  };

  async function handleServiceTest(serviceId: string) {
    if (isCustomS3Id(serviceId)) {
      await testConn(() => testS3Connection(serviceId), serviceId);
      return;
    }
    await testConn(actions[serviceId], serviceId);
  }

  async function handleBuiltinCheck(serviceId: string) {
    if (serviceId === 'jd') {
      await checkJdAvailable();
      toast.showConfig('info', jdAvailable.value
        ? TOAST_MESSAGES.auth.serviceAvailable('京东图床')
        : TOAST_MESSAGES.auth.serviceUnavailable('京东图床'));
    } else if (serviceId === 'qiyu') {
      await checkQiyuAvailability(true);
      toast.showConfig('info', qiyuAvailable.value
        ? TOAST_MESSAGES.auth.serviceAvailable('七鱼图床')
        : TOAST_MESSAGES.auth.serviceUnavailable('七鱼图床'));
    }
  }

  // ---- 预校验 ----

  const S3_SERVICE_IDS: ServiceType[] = ['r2', 'tencent', 'aliyun', 'qiniu', 'upyun'];

  function preValidateService(serviceId: string): string | null {
    if (isCustomS3Id(serviceId)) {
      const profileId = getCustomS3ProfileId(serviceId);
      const profile = formData.value.custom_s3_profiles.find((p: CustomS3Profile) => p.id === profileId);
      if (!profile) return '找不到该自定义 S3 配置';
      return validateS3Config(serviceId as ServiceType, profile as any);
    }
    if (S3_SERVICE_IDS.includes(serviceId as ServiceType)) {
      const config = formData.value[serviceId as keyof typeof formData.value] as any;
      return validateS3Config(serviceId as ServiceType, config);
    }
    return null;
  }

  async function runServiceTest(serviceId: ServiceType, task: Promise<void>) {
    try {
      await task;
      serviceHealth.markVerified(serviceId);
    } catch (e) {
      serviceHealth.markTestFailed(serviceId, errorToString(e));
    }
  }

  // ---- 批量测试 ----

  async function testAllConfiguredServices() {
    if (isBatchTesting.value) return;

    const MIN_TOTAL_MS = 1500;
    const SLOW_SERVICES: ServiceType[] = ['qiyu'];

    const allServices = (Object.entries(serviceHealth.healthStatusMap.value) as [ServiceType, string][])
      .filter(([id]) => actions[id])
      .map(([id, status]) => ({ id: id as ServiceType, status }));

    if (allServices.length === 0) return;

    const normalServices = allServices.filter(s => !SLOW_SERVICES.includes(s.id));
    const slowServiceEntries = allServices.filter(s => SLOW_SERVICES.includes(s.id));
    const orderedServices = [...normalServices, ...slowServiceEntries];

    isBatchTesting.value = true;
    batchTestAborted.value = false;
    batchTestProgress.value = { current: 0, total: orderedServices.length, currentService: '' };
    suppressToasts(true);

    const slowPromises = new Map<ServiceType, Promise<void>>();
    for (const s of slowServiceEntries) {
      if (s.status !== 'unconfigured' && !preValidateService(s.id)) {
        slowPromises.set(s.id, actions[s.id]());
      }
    }

    const overallStartTime = Date.now();

    try {
      for (let i = 0; i < orderedServices.length; i++) {
        if (batchTestAborted.value) break;

        const { id: serviceId, status } = orderedServices[i];
        const startTime = Date.now();

        batchTestProgress.value = {
          current: i,
          total: orderedServices.length,
          currentService: serviceNames[serviceId],
        };
        testingConnections.value[serviceId] = true;

        if (status === 'unconfigured') {
          await delay(MIN_DISPLAY_MS);
        } else {
          const validationError = preValidateService(serviceId);
          if (validationError) {
            serviceHealth.markTestFailed(serviceId, validationError);
            await delay(MIN_DISPLAY_MS);
          } else {
            const task = slowPromises.get(serviceId) ?? actions[serviceId]();
            await runServiceTest(serviceId, task);
            const elapsed = Date.now() - startTime;
            if (elapsed < MIN_DISPLAY_MS) await delay(MIN_DISPLAY_MS - elapsed);
          }
        }

        testingConnections.value[serviceId] = false;
      }

      if (!batchTestAborted.value) {
        batchTestProgress.value = {
          current: orderedServices.length,
          total: orderedServices.length,
          currentService: '',
        };
        const totalElapsed = Date.now() - overallStartTime;
        await delay(Math.max(COMPLETE_LINGER_MS, MIN_TOTAL_MS - totalElapsed));
      }
    } finally {
      suppressToasts(false);
      isBatchTesting.value = false;
      batchTestProgress.value = null;
      batchTestCompletionKey.value++;
    }
  }

  return {
    // 服务可用性
    qiyuAvailable,
    jdAvailable,
    isCheckingQiyu,
    isCheckingJd,
    // 测试状态
    isBatchTesting,
    batchTestProgress,
    batchTestAborted,
    batchTestCompletionKey,
    // 方法
    handleServiceTest,
    handleBuiltinCheck,
    testAllConfiguredServices,
  };
}
