// 编辑器服务（Typora / Obsidian / CLI）的凭证同步：应用级单例，从磁盘上的配置拼出各图床凭证下发给后端。
// 图床凭证由图床页写进配置（设置页不再握着一份），所以这里不读设置页的表单：启动时下发一次，
// 之后每次配置变化（图床页改凭证、设置页改编辑器选项、托盘、云同步）重拼一次；内容没变不重复下发。

import { effectScope, ref } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { DEFAULT_CONFIG, type EditorServerConfig, type UserConfig } from '@/config/types';
import { useConfigManager } from '@/composables/useConfig';
import { readFreshConfig } from '@/store/instances';
import { extractErrorMessage } from '@/utils/serviceHealthMessage';
import { createLogger } from '@/utils/logger';
import type { SettingsFormShape } from './settingsFormTypes';
import { useEditorIntegration } from './useEditorIntegration';

const log = createLogger('EditorSync');

function merged<T extends object>(defaults: T | undefined, saved: Partial<T> | undefined): T {
  return { ...structuredClone(defaults ?? {} as T), ...(saved ? structuredClone(saved) : {}) } as T;
}

/** 配置 → 编辑器服务要的那份凭证（字段口径同上传器读配置） */
export function editorSourceFromConfig(config: UserConfig): SettingsFormShape {
  const services = config.services ?? {};
  const d = DEFAULT_CONFIG.services;
  const zhihu = merged(d.zhihu, services.zhihu);
  const imgur = merged(d.imgur, services.imgur);
  return {
    weiboCookie: services.weibo?.cookie ?? '',
    r2: { ...merged(d.r2, services.r2), thumbnailProxyEnabled: services.r2?.thumbnailProxyEnabled ?? true },
    tencent: merged(d.tencent, services.tencent),
    aliyun: merged(d.aliyun, services.aliyun),
    qiniu: merged(d.qiniu, services.qiniu),
    upyun: merged(d.upyun, services.upyun),
    custom_s3_profiles: structuredClone(config.custom_s3_profiles ?? []),
    webdav_profiles: structuredClone(config.webdav_profiles ?? []),
    nowcoder: merged(d.nowcoder, services.nowcoder),
    zhihu: { cookie: zhihu.cookie, sourceParamEnabled: zhihu.sourceParamEnabled ?? true, sourceParamValue: zhihu.sourceParamValue ?? '172ae18b' },
    nami: { cookie: services.nami?.cookie ?? '', authToken: services.nami?.authToken ?? '' },
    bilibili: merged(d.bilibili, services.bilibili),
    chaoxing: merged(d.chaoxing, services.chaoxing),
    smms: merged(d.smms, services.smms),
    github: merged(d.github, services.github),
    imgur: { clientId: imgur.clientId, clientSecret: imgur.clientSecret ?? '' },
    editorServer: { ...structuredClone(DEFAULT_CONFIG.editorServer!), ...(config.editorServer ?? {}) },
  } as SettingsFormShape;
}

const source = ref<SettingsFormShape>(editorSourceFromConfig(DEFAULT_CONFIG));
let integration: ReturnType<typeof useEditorIntegration> | null = null;

function ensureIntegration(): ReturnType<typeof useEditorIntegration> {
  // isSettingsReady 一直为 false：不让它自己按签名防抖下发，什么时候下发由这里说了算
  integration ??= effectScope(true).run(() => useEditorIntegration({
    formData: source,
    isSettingsReady: ref(false),
    errorToString: (error) => extractErrorMessage(error, '') || String(error),
  }))!;
  return integration;
}

/**
 * 按最新配置下发一次。editorServer 传了就用传的（设置页刚改、还没存的编辑器选项）；
 * 返回实际下发的编辑器选项——开启时可能补了一个 authToken，调用方要把它存住，免得下次又换一个。
 */
export function applyEditorConfig(
  editorServer?: EditorServerConfig,
  options: { force?: boolean } = {},
): Promise<{ ok: boolean; editorServer: EditorServerConfig }> {
  // 排队执行：启动时那次与配置变化触发的那次会撞在一起，两次共用 source，不排队的话前一次会读到后一次的数据
  const run = queue.then(() => applyOnce(editorServer, options));
  queue = run.catch(() => undefined);
  return run;
}

let queue: Promise<unknown> = Promise.resolve();

async function applyOnce(
  editorServer: EditorServerConfig | undefined,
  options: { force?: boolean },
): Promise<{ ok: boolean; editorServer: EditorServerConfig }> {
  const latest = (await readFreshConfig()) ?? DEFAULT_CONFIG;
  source.value = { ...editorSourceFromConfig(latest), ...(editorServer ? { editorServer: structuredClone(editorServer) } : {}) };
  const ok = await ensureIntegration().applyEditorServer(source.value.editorServer, options);
  const applied = source.value.editorServer;
  // 用配置里的选项下发时补出了 authToken：写回配置（设置页的编辑走调用方自己的保存）
  if (!editorServer && applied.authToken && applied.authToken !== latest.editorServer?.authToken) {
    try {
      await useConfigManager().saveConfig({ ...latest, editorServer: applied }, true);
    } catch (error) {
      log.warn('保存编辑器服务的 authToken 失败', error);
    }
  }
  return { ok, editorServer: applied };
}

/** 在外壳里装一次：启动时下发，之后跟着配置变化；返回卸载函数 */
export function installEditorSync(): () => void {
  let unlisten: UnlistenFn | null = null;
  let disposed = false;
  void applyEditorConfig(undefined, { force: true }).catch((error) => log.warn('启动时下发编辑器配置失败', error));
  listen('config-updated', () => { void applyEditorConfig().catch((error) => log.warn('下发编辑器配置失败', error)); })
    .then((fn) => { if (disposed) fn(); else unlisten = fn; })
    .catch((error) => log.warn('配置变化监听失败', error));
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** 测试用 */
export function __resetEditorSyncForTests(): void {
  integration = null;
  queue = Promise.resolve();
  source.value = editorSourceFromConfig(DEFAULT_CONFIG);
}
