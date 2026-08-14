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
import { useCopyBadgeFeedback } from '../useCopyBadgeFeedback';

const log = createLogger('SensitiveDraft');

/**
 * 芯片显示「已更新」的时长
 *
 * 比复制按钮那 1200ms 长：notification-patterns.md 批评过「一闪而过的提示用户必然错过」，
 * 而保存反馈比复制更需要被看见——用户要确认自己那下改动真的存住了。
 */
const SAVED_FEEDBACK_HOLD_MS = 2000;

/**
 * 已存过值时的占位文案——留空提交不会改动已保存的值
 *
 * 只在输入框**聚焦时**可见：没聚焦时 SensitiveField 会用圆点盖住它，
 * 表示「里面有东西」。两条信息各自在最相关的时机出现。
 */
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
  onEditStart: (knownPlaintext?: string) => void;
  placeholder: string;
  hasStoredValue: boolean;
  loadingValue: boolean;
  revealStored: (() => Promise<string>) | null;
}

export interface SensitiveDraft {
  /** 当前草稿内容；未输入过则为空串 */
  draftOf: (key: string) => string;
  setDraft: (key: string, value: string) => void;
  /**
   * 开始编辑：把已存的值填进草稿，好让用户就地改一个字符。
   * 传了 `knownPlaintext` 就直接用（点过眼睛的场合），否则走 `reveal` 取。
   */
  beginEdit: (key: string, knownPlaintext?: string) => Promise<void>;
  /** 取值进行中（异步解密），此时输入框只读，避免覆盖用户输入 */
  isLoading: (key: string) => boolean;
  /** 失焦时调用。空草稿或没改过都直接返回，成功后清空草稿 */
  commitDraft: (key: string) => Promise<void>;
  /** 交给 SensitiveField 的 revealStored；未存过值时返回 null（眼睛按钮随之禁用） */
  makeRevealer: (key: string) => (() => Promise<string>) | null;
  hasStored: (key: string) => boolean;
  placeholder: (key: string, emptyHint: string) => string;
  /** 芯片文案：刚存过显示「已更新」，其余时候「已保存」 */
  chipLabel: (key: string) => string;
  /**
   * 模板里 `<SensitiveField v-bind="secrets.bindingsFor(key, hint)" />` 一行接完
   *
   * Why 不让各组件自己拼这些 prop：同一个 key 要在模板里重复好几遍，
   * 抄错任意一处都会让草稿、提交、揭示三者对不上号——而且四个组件要各抄一遍。
   */
  bindingsFor: (key: string, emptyHint: string) => SensitiveFieldBindings;
}

export function useSensitiveDraft(options: SensitiveDraftOptions): SensitiveDraft {
  const drafts = ref<Record<string, string>>({});
  const loading = ref<Record<string, boolean>>({});

  /**
   * 聚焦时取出来的原值，用来判断「用户到底改没改」
   *
   * 这是旧结构性保证的替身。以前明文根本进不了 modelValue，所以"查看"物理上
   * 不可能变成"写入"；现在为了能就地改一个字符，明文在编辑期间会进来，
   * 改用比较来挡：值和取出来时一样就不写盘。
   *
   * 不放进 ref：它不参与渲染，放响应式里只会多一份明文副本被追踪。
   */
  const originals = new Map<string, string>();

  /** 保存成功后的瞬时反馈。复用既有机制，它自带 key 区分和 onScopeDispose 清理 */
  const savedFeedback = useCopyBadgeFeedback(SAVED_FEEDBACK_HOLD_MS);

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

  /**
   * 聚焦时把已存的值取出来填进草稿
   *
   * 这样输入框就是个普通密码框：点进去就能改一个字符，不用整串重打。
   * 明文只在编辑期间存在，失焦即清。
   */
  async function beginEdit(key: string, knownPlaintext?: string): Promise<void> {
    if (!options.hasStored(key)) return;   // 没存过，本来就是空框输入
    if (drafts.value[key]) return;          // 已经在编辑
    if (loading.value[key]) return;

    // 刚点过眼睛，明文已经在调用方手上了：省一次解密，也少一次竞态
    //
    // ⚠️ 这条路径同样要记 originals。漏了的话，「点眼睛看一眼再点进框里」失焦时
    // 会因为找不到原值而被判成"改过了"，把看过的内容原样重新加密写回——
    // 正是本不变量要拦的那件事。
    if (knownPlaintext !== undefined) {
      drafts.value[key] = knownPlaintext;
      originals.set(key, knownPlaintext);
      return;
    }

    loading.value[key] = true;
    try {
      const plaintext = await options.reveal(key);
      // 竞态守卫：解密期间用户已经开始打字了，别把他敲的东西盖掉
      if (!drafts.value[key]) {
        drafts.value[key] = plaintext;
        originals.set(key, plaintext);
      }
    } catch (error) {
      // 取不出来就维持空草稿。下面 commitDraft 的「空草稿不提交」会兜住，
      // 已存的值不会因为解不开而被清掉。
      if (options.onRevealError) {
        options.onRevealError(error, key);
      } else {
        log.error(`敏感字段取值失败：${key}`, error);
      }
    } finally {
      loading.value[key] = false;
    }
  }

  function isLoading(key: string): boolean {
    return !!loading.value[key];
  }

  async function commitDraft(key: string): Promise<void> {
    const draft = drafts.value[key];

    // 留空则不修改。也兜住了「取值失败留下空框」——已存的值不会被清掉
    if (!draft) {
      originals.delete(key);
      return;
    }

    // 取出来看了一眼、一个字符没动 → 不写盘。
    // 这是旧「明文不进 modelValue」结构性保证的替身，别去掉。
    if (originals.get(key) === draft) {
      drafts.value[key] = '';
      originals.delete(key);
      return;
    }

    try {
      await options.commit(key, draft);
      // 只在成功后清空：提交失败还把用户刚输入的内容抹掉，等于二次伤害
      drafts.value[key] = '';
      originals.delete(key);
      savedFeedback.markCopied(key);
    } catch (error) {
      if (options.onCommitError) {
        options.onCommitError(error, key);
      } else {
        log.error(`敏感字段提交失败：${key}`, error);
      }
    }
  }

  function chipLabel(key: string): string {
    return savedFeedback.isCopied(key) ? '已更新' : '已保存';
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
      onEditStart: (knownPlaintext?: string) => { void beginEdit(key, knownPlaintext); },
      placeholder: placeholder(key, emptyHint),
      hasStoredValue: options.hasStored(key),
      loadingValue: isLoading(key),
      revealStored: makeRevealer(key),
    };
  }

  return {
    draftOf,
    setDraft,
    beginEdit,
    isLoading,
    commitDraft,
    makeRevealer,
    hasStored: (key: string) => options.hasStored(key),
    placeholder,
    chipLabel,
    bindingsFor,
  };
}
