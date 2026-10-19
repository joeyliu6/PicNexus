// 设置页读写配置的唯一入口：每改一项都读磁盘上的最新配置、只改这一项、保存。
// 不握一份表单副本——副本整份回写会用旧值盖掉图床页、托盘、云同步刚写进去的东西；图床字段这里从来不碰。
// 保存成功在改动的那一行闪「已保存」（交接说明第 4 节规则 10）；失败红色通知，界面回到磁盘上的值。
import { computed, reactive, ref, toRaw } from 'vue';
import { DEFAULT_CONFIG, type ImageCompressionConfig, type UserConfig } from '@/config/types';
import { useConfigManager } from '@/composables/useConfig';
import { useToast } from '@/composables/useToast';
import { readFreshConfig } from '@/store/instances';
import { TOAST_MESSAGES } from '@/constants/toastMessages';
import { createLogger } from '@/utils/logger';

const log = createLogger('SettingsConfig');

/** 「已保存」显示多久 */
export const SAVED_FLASH_MS = 1500;

const config = ref<UserConfig>(structuredClone(DEFAULT_CONFIG));
/** 对外只读（改动一律走 patch）：只给 getter，类型不做深只读，免得每处读取都要转换 */
const view = computed(() => config.value);
const saved = reactive(new Set<string>());
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let queue: Promise<unknown> = Promise.resolve();

async function reload(): Promise<void> {
  config.value = (await readFreshConfig()) ?? structuredClone(DEFAULT_CONFIG);
}

/** 在这一行闪一下「已保存」 */
function flashSaved(rowId: string): void {
  clearTimeout(timers.get(rowId));
  saved.add(rowId);
  timers.set(rowId, setTimeout(() => {
    saved.delete(rowId);
    timers.delete(rowId);
  }, SAVED_FLASH_MS));
}

/**
 * 改一项并保存。排队执行：连着改两项时第二次读到的是第一次写完的配置，互不覆盖。
 * rowId 给了就在那一行闪「已保存」；返回是否写进去了。
 */
function patch(rowId: string | null, mutate: (draft: UserConfig) => void): Promise<boolean> {
  const run = queue.then(async () => {
    const draft = (await readFreshConfig()) ?? structuredClone(toRaw(config.value));
    mutate(draft);
    try {
      await useConfigManager().saveConfig(draft, true);
    } catch (error) {
      log.warn('保存设置失败', error);
      const message = TOAST_MESSAGES.config.notSaved(error);
      useToast().error(message.summary, message.detail);
      await reload().catch((reloadError) => log.warn('保存失败后重新读取配置失败', reloadError));
      return false;
    }
    config.value = draft;
    if (rowId) flashSaved(rowId);
    return true;
  });
  queue = run.catch(() => undefined);
  return run;
}

/**
 * 改压缩方案（S02）：mutate 返回 null 表示不用改。放在模块里而不在组件里，
 * 「删除方案」的撤销要在对话框、甚至整个「上传与链接」分组卸载之后还能写回去
 */
function patchCompression(mutate: (c: ImageCompressionConfig) => ImageCompressionConfig | null): Promise<boolean> {
  return patch('compression', (c) => {
    const next = mutate(c.imageCompression ?? structuredClone(DEFAULT_CONFIG.imageCompression!));
    if (next) c.imageCompression = next;
  });
}

export function useSettingsConfig() {
  return {
    /** 磁盘上的配置（只读；改动一律走 patch） */
    config: view,
    reload,
    patch,
    patchCompression,
    flashSaved,
    isSaved: (rowId: string) => saved.has(rowId),
  };
}

/** 测试用 */
export function __resetSettingsConfigForTests(): void {
  config.value = structuredClone(DEFAULT_CONFIG);
  saved.clear();
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  queue = Promise.resolve();
}
