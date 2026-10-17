// 测试连接（交接说明 8.4、P06–P08）：按图床分派到后端，收成统一的 HostTestState。
// 结果按图床 id 存在模块里：测试进行中换到别的图床再回来，按钮仍是「正在检测…」；结果只在本次页面会话里保留。
// 已添加的图床结果写回健康状态（左栏 ⚠、首页「上传到」的警示都读它）；连接表单里的草稿不写。

import { computed, reactive } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { probeBuiltinServiceAvailability, useServiceAvailability } from '@/composables/service/useServiceAvailability';
import { useServiceHealth } from '@/composables/service/useServiceHealth';
import { DEFAULT_WEBDAV_URL_TEMPLATE } from '@/config/types';
import { getErrorMessage, isLanHttpUnconfirmedError } from '@/types/errors';
import { createLogger } from '@/utils/logger';
import { extractNamiAuthToken } from '@/utils/namiAuthToken';
import { describeHost, type HostDescriptor, type TestStep } from './hostCatalog';
import { localizeReason, resolveField, type HostTestState } from './hostTestText';

const log = createLogger('HostTest');

const states = reactive(new Map<string, HostTestState>());

/** 要测的那一份配置：已添加的图床读配置，连接表单读草稿；WebDAV 密码已经是明文 */
export interface HostTestInput {
  hostId: string;
  record: Record<string, unknown>;
  /** 草稿（还没连上）：结果不写健康状态 */
  draft?: boolean;
}

/** 测试本身判不了、要用户拍板的情况：WebDAV 地址判不出在不在局域网（P12） */
export class LanHttpConsentNeeded extends Error {}

interface StepOutcome {
  ok: boolean;
  steps: TestStep[];
  step?: TestStep;
  field?: string | null;
  reason?: string;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

async function testCookie(hostId: string, record: Record<string, unknown>): Promise<StepOutcome> {
  const cookie = str(record.cookie);
  try {
    // 逐个写字面量：invoke 参数名一致性检查只认得出字面量命令名
    switch (hostId) {
      case 'weibo': await invoke('test_weibo_connection', { weiboCookie: cookie }); break;
      case 'zhihu': await invoke('test_zhihu_connection', { zhihuCookie: cookie }); break;
      case 'nowcoder': await invoke('test_nowcoder_cookie', { nowcoderCookie: cookie }); break;
      case 'bilibili': await invoke('test_bilibili_connection', { bilibiliCookie: cookie }); break;
      case 'chaoxing': await invoke('test_chaoxing_connection', { chaoxingCookie: cookie }); break;
      case 'nami': await invoke('test_nami_connection', { cookie, authToken: str(record.authToken) || extractNamiAuthToken(cookie) }); break;
      default: throw new Error(`未知的 Cookie 图床：${hostId}`);
    }
    return { ok: true, steps: ['credentials'] };
  } catch (error) {
    return { ok: false, steps: ['credentials'], step: 'credentials', field: 'cookie', reason: getErrorMessage(error) || '登录已失效' };
  }
}

async function testToken(hostId: string, record: Record<string, unknown>): Promise<StepOutcome> {
  try {
    const res = hostId === 'smms'
      ? await fetch('https://sm.ms/api/v2/upload', { method: 'POST', headers: { Authorization: str(record.token) } })
      : await fetch('https://api.imgur.com/3/account/albums', { headers: { Authorization: `Client-ID ${str(record.clientId)}` } });
    if (res.ok) return { ok: true, steps: ['credentials'] };
    return { ok: false, steps: ['credentials'], step: 'credentials', field: 'token', reason: hostId === 'smms' ? 'SM.MS 拒绝了这个 Token' : 'Imgur 拒绝了这个 Client ID' };
  } catch {
    return { ok: false, steps: ['credentials'], step: 'credentials', reason: `无法连接 ${hostId === 'smms' ? 'SM.MS' : 'Imgur'}，请检查网络后重试` };
  }
}

/** GitHub：读仓库并确认有写权限 → 写入并删除一个测试文件（公开访问不测：CDN 有缓存延迟） */
async function testGithub(record: Record<string, unknown>): Promise<StepOutcome> {
  const steps: TestStep[] = ['credentials', 'write'];
  const owner = str(record.owner);
  const repo = str(record.repo);
  const branch = str(record.branch) || 'main';
  const headers = { Authorization: `token ${str(record.token)}`, Accept: 'application/vnd.github+json' };
  const api = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const info = await fetch(api, { headers });
    if (info.status === 401) return { ok: false, steps, step: 'credentials', field: 'token', reason: 'GitHub 拒绝了这个 Token' };
    if (info.status === 404) return { ok: false, steps, step: 'credentials', field: 'repo', reason: '找不到这个仓库，或 Token 没有访问权限' };
    if (!info.ok) return { ok: false, steps, step: 'credentials', reason: `GitHub 返回 HTTP ${info.status}，请稍后重试` };
    const body = await info.json() as { permissions?: { push?: boolean } };
    if (body.permissions && !body.permissions.push) return { ok: false, steps, step: 'credentials', field: 'token', reason: 'Token 没有这个仓库的写入权限' };

    const dir = str(record.path).replace(/^\/+|\/+$/g, '');
    const path = `${dir ? `${dir}/` : ''}.picnexus-probe-${Date.now()}.txt`;
    const put = await fetch(`${api}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'PUT', headers, body: JSON.stringify({ message: 'PicNexus connection test', content: btoa('picnexus'), branch }),
    });
    if (!put.ok) {
      const field = put.status === 404 || put.status === 422 ? 'branch' : null;
      return { ok: false, steps, step: 'write', field, reason: field ? '这个分支不存在' : `写入失败（HTTP ${put.status}）` };
    }
    const created = await put.json() as { content?: { sha?: string } };
    const sha = created.content?.sha;
    if (sha) {
      await fetch(`${api}/contents/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'DELETE', headers, body: JSON.stringify({ message: 'PicNexus connection test cleanup', sha, branch }),
      }).catch((error) => log.warn('GitHub 测试文件清理失败', error));
    }
    return { ok: true, steps };
  } catch {
    return { ok: false, steps, step: 'credentials', reason: '无法连接 GitHub，请检查网络后重试' };
  }
}

interface ProbeReport { ok: boolean; failedStep: TestStep | null; field: string | null; message: string; steps: TestStep[] }

async function testObject(hostId: string, record: Record<string, unknown>): Promise<StepOutcome> {
  const report = await invoke<ProbeReport>('probe_s3_storage', { serviceId: hostId, config: record });
  return report.ok
    ? { ok: true, steps: report.steps }
    : { ok: false, steps: report.steps, step: report.failedStep ?? 'credentials', field: report.field, reason: report.message };
}

interface WebdavReport { success: boolean; message: string; failedStep: TestStep | null; field: string | null }

async function testWebdav(record: Record<string, unknown>): Promise<StepOutcome> {
  const steps: TestStep[] = ['credentials', 'write', 'public'];
  try {
    const report = await invoke<WebdavReport>('test_webdav_storage', {
      url: str(record.url),
      username: str(record.username),
      password: typeof record.password === 'string' ? record.password : '',
      remotePath: str(record.remotePath),
      publicDomain: str(record.publicDomain),
      publicUrlTemplate: str(record.publicUrlTemplate) || DEFAULT_WEBDAV_URL_TEMPLATE,
      lanHttpConfirmed: record.lanHttpConfirmed === true,
    });
    return report.success
      ? { ok: true, steps }
      : { ok: false, steps, step: report.failedStep ?? 'credentials', field: report.field, reason: report.message };
  } catch (error) {
    if (isLanHttpUnconfirmedError(error)) throw new LanHttpConsentNeeded(getErrorMessage(error));
    const reason = getErrorMessage(error) || '连接测试失败';
    return { ok: false, steps, step: 'credentials', field: /公开/.test(reason) ? 'public_domain' : 'url', reason };
  }
}

async function testBuiltin(hostId: string): Promise<StepOutcome> {
  const availability = useServiceAvailability();
  try {
    await probeBuiltinServiceAvailability(hostId as 'jd' | 'qiyu', true);
  } catch {
    /* 下面按可用性判 */
  }
  const ok = hostId === 'jd' ? availability.jdAvailable.value : availability.qiyuAvailable.value;
  return ok ? { ok: true, steps: [] } : { ok: false, steps: [], step: 'credentials', reason: '服务暂不可用，请稍后重试' };
}

function runner(descriptor: HostDescriptor, input: HostTestInput): Promise<StepOutcome> {
  switch (descriptor.kind) {
    case 'builtin': return testBuiltin(input.hostId);
    case 'cookie': return testCookie(input.hostId, input.record);
    case 'token': return input.hostId === 'github' ? testGithub(input.record) : testToken(input.hostId, input.record);
    case 'object':
    case 's3': return testObject(input.hostId, input.record);
    case 'webdav': return testWebdav(input.record);
  }
}

export function useHostTest() {
  const health = useServiceHealth();

  const testing = computed(() => new Set([...states].filter(([, s]) => s.phase === 'testing').map(([id]) => id)));

  function stateOf(hostId: string): HostTestState {
    return states.get(hostId) ?? { phase: 'idle' };
  }

  /** 测一次；同一个图床正在测时忽略。WebDAV 判不出局域网时抛 LanHttpConsentNeeded，由页面弹 P12 后重测 */
  async function run(input: HostTestInput): Promise<HostTestState> {
    const descriptor = describeHost(input.hostId);
    if (!descriptor) return { phase: 'idle' };
    if (stateOf(input.hostId).phase === 'testing') return stateOf(input.hostId);
    states.set(input.hostId, { phase: 'testing' });
    const started = performance.now();
    let state: HostTestState;
    try {
      const outcome = await runner(descriptor, input);
      if (outcome.ok) {
        state = { phase: 'ok', ms: Math.round(performance.now() - started), steps: outcome.steps };
      } else {
        const step = outcome.step ?? 'credentials';
        state = {
          phase: 'fail',
          step,
          field: resolveField(descriptor, outcome.field),
          reason: localizeReason(descriptor.id, outcome.reason ?? '连接测试失败'),
          passed: outcome.steps.slice(0, outcome.steps.indexOf(step)),
        };
      }
    } catch (error) {
      states.delete(input.hostId);
      if (error instanceof LanHttpConsentNeeded) throw error;
      log.error(`${input.hostId} 测试连接出错`, error);
      state = { phase: 'fail', step: 'credentials', reason: getErrorMessage(error) || '连接测试失败', passed: [] };
    }
    states.set(input.hostId, state);
    if (!input.draft && descriptor.kind !== 'builtin') {
      if (state.phase === 'ok') health.markVerified(input.hostId);
      else if (state.phase === 'fail') health.markTestFailed(input.hostId, state.reason);
    }
    return state;
  }

  /** 字段改了：那一格的红框随之清掉（结果条留着，直到下一次测试） */
  function clearField(hostId: string, key: string): void {
    const state = states.get(hostId);
    if (state?.phase === 'fail' && state.field === key) states.set(hostId, { ...state, field: undefined });
  }

  /** 不经后端直接记一个失败（「测试并连接」时必填项没填） */
  function markFailed(hostId: string, state: Extract<HostTestState, { phase: 'fail' }>): void {
    states.set(hostId, state);
  }

  function forget(hostId: string): void {
    states.delete(hostId);
  }

  return { testing, stateOf, run, clearField, markFailed, forget };
}

/** 测试用 */
export function __resetHostTestForTests(): void {
  states.clear();
}
