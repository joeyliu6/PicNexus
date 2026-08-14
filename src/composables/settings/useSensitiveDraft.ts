// 敏感字段「密文常驻、明文按需」的草稿机
//
// 统一规则：存起来之后界面只显示「有没有」，不显示「是什么」；想看内容主动点眼睛，
// 点开临时取明文、15 秒自动收回（收回由 SensitiveField 负责）。
//
// 四个设置分组（Token / Cookie / S3 / WebDAV）需要的是同一套机械动作：
// 一张草稿表、失焦提交、已保存判定、按需揭示。抄四遍不如收在一处。
//
// ⚠️ 这里**只**处理草稿与揭示，绝不把揭示出的明文写回 modelValue。
// 明文一旦进了 modelValue，父组件失焦提交时会把它当成"用户新填的值"重新写一遍——
// 「看一眼」就变成了「改一次」。SensitiveField 用只读展示态从结构上挡住了这条路，
// 本模块也不得从另一侧把它绕开。

import { ref } from 'vue';
import { createLogger } from '../../utils/logger';

const log = createLogger('SensitiveDraft');

/** 已存过值时输入框的占位文案——留空提交不会改动已保存的值 */
export const KEEP_STORED_PLACEHOLDER = '留空则不修改';

export interface SensitiveDraftOptions {
  /** 该字段是否已存过值：决定「已保存」芯片是否出现、眼睛按钮是否可用 */
  hasStored: (key: string) => boolean;
  /** 按需取明文。明文字段直接返回，密文字段在这里解密 */
  reveal: (key: string) => Promise<string>;
  /** 提交草稿。只在草稿非空时被调用，所以实现里无需再判空 */
  commit: (key: string, draft: string) => Promise<void> | void;
  onRevealError?: (error: unknown, key: string) => void;
  onCommitError?: (error: unknown, key: string) => void;
}

/** 一次性喂给 SensitiveField 的 props + 监听器，配合 v-bind 使用 */
export interface SensitiveFieldBindings {
  modelValue: string;
  'onUpdate:modelValue': (value: string) => void;
  onBlur: () => void;
  placeholder: string;
  hasStoredValue: boolean;
  revealStored: (() => Promise<string>) | null;
}

export interface SensitiveDraft {
  /** 当前草稿内容；未输入过则为空串 */
  draftOf: (key: string) => string;
  setDraft: (key: string, value: string) => void;
  /** 失焦时调用。空草稿直接返回（留空则不修改），成功后清空草稿 */
  commitDraft: (key: string) => Promise<void>;
  /** 交给 SensitiveField 的 revealStored；未存过值时返回 null（眼睛按钮随之禁用） */
  makeRevealer: (key: string) => (() => Promise<string>) | null;
  hasStored: (key: string) => boolean;
  placeholder: (key: string, emptyHint: string) => string;
  /**
   * 模板里 `<SensitiveField v-bind="secrets.bindingsFor(key, hint)" />` 一行接完
   *
   * Why 不让各组件自己拼这六个 prop：同一个 key 要在模板里重复五遍，
   * 抄错任意一处都会让草稿、提交、揭示三者对不上号——而且四个组件要各抄一遍。
   */
  bindingsFor: (key: string, emptyHint: string) => SensitiveFieldBindings;
}

export function useSensitiveDraft(options: SensitiveDraftOptions): SensitiveDraft {
  const drafts = ref<Record<string, string>>({});

  /**
   * revealer 按 key 记忆化
   *
   * Why：这个函数在模板里被调用，不缓存的话每次渲染都产生新的函数引用，
   * SensitiveField 的 revealStored prop 就会每帧都"变化"一次。
   * 闭包在**被调用时**才读状态，所以缓存住引用不会读到过期数据。
   */
  const revealers = new Map<string, () => Promise<string>>();

  function draftOf(key: string): string {
    return drafts.value[key] ?? '';
  }

  function setDraft(key: string, value: string): void {
    drafts.value[key] = value;
  }

  async function commitDraft(key: string): Promise<void> {
    const draft = drafts.value[key];
    if (!draft) return;

    try {
      await options.commit(key, draft);
      // 只在成功后清空：提交失败还把用户刚输入的内容抹掉，等于二次伤害
      drafts.value[key] = '';
    } catch (error) {
      if (options.onCommitError) {
        options.onCommitError(error, key);
      } else {
        log.error(`敏感字段提交失败：${key}`, error);
      }
    }
  }

  function makeRevealer(key: string): (() => Promise<string>) | null {
    if (!options.hasStored(key)) return null;

    let revealer = revealers.get(key);
    if (!revealer) {
      revealer = async () => {
        try {
          return await options.reveal(key);
        } catch (error) {
          if (options.onRevealError) {
            options.onRevealError(error, key);
          } else {
            log.error(`敏感字段揭示失败：${key}`, error);
          }
          // 继续抛出，交给 SensitiveField 走 revealError 分支：
          // 它需要知道失败了，才能不进入展示态
          throw error;
        }
      };
      revealers.set(key, revealer);
    }
    return revealer;
  }

  function placeholder(key: string, emptyHint: string): string {
    return options.hasStored(key) ? KEEP_STORED_PLACEHOLDER : emptyHint;
  }

  function bindingsFor(key: string, emptyHint: string): SensitiveFieldBindings {
    return {
      modelValue: draftOf(key),
      'onUpdate:modelValue': (value: string) => setDraft(key, value),
      onBlur: () => { void commitDraft(key); },
      placeholder: placeholder(key, emptyHint),
      hasStoredValue: options.hasStored(key),
      revealStored: makeRevealer(key),
    };
  }

  return {
    draftOf,
    setDraft,
    commitDraft,
    makeRevealer,
    hasStored: (key: string) => options.hasStored(key),
    placeholder,
    bindingsFor,
  };
}
