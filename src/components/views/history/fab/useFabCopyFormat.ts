import { computed } from 'vue';
import { useConfigManager } from '../../../../composables/useConfig';
import { createLogger } from '../../../../utils/logger';
import { FORMAT_NAMES, type LinkFormat } from '../../../../utils/linkFormatter';

const log = createLogger('FabCopyFormat');

export function useFabCopyFormat() {
  const configManager = useConfigManager();

  const currentDefault = computed<LinkFormat>(
    () => (configManager.config.value.linkOutput?.defaultFormat ?? 'url') as LinkFormat,
  );

  const hasCustomTemplate = computed(
    () => !!configManager.config.value.linkOutput?.customTemplate,
  );

  // 自定义格式下只显示"复制链接",否则追加格式名
  const mainButtonLabel = computed(() => {
    if (currentDefault.value === 'custom') return '复制链接';
    return `复制链接 · ${FORMAT_NAMES[currentDefault.value]}`;
  });

  const mainButtonTooltip = computed<string | null>(() => {
    if (currentDefault.value !== 'custom') return null;
    const tpl = configManager.config.value.linkOutput?.customTemplate;
    if (!tpl) return '当前为自定义格式，但未配置模板';
    const preview = tpl.length > 60 ? `${tpl.slice(0, 57)}...` : tpl;
    return `自定义模板：${preview}`;
  });

  async function setDefaultFormat(format: LinkFormat): Promise<void> {
    const cfg = configManager.config.value;
    if (cfg.linkOutput?.defaultFormat === format) return;
    // linkOutput 在 UserConfig 里是可选的，但内部字段都是必填的：兜底所有字段
    const currentLinkOutput = cfg.linkOutput ?? {
      defaultFormat: 'url' as LinkFormat,
      customTemplate: '{url}',
      autoCopy: true,
    };
    const next = {
      ...cfg,
      linkOutput: { ...currentLinkOutput, defaultFormat: format },
    };
    try {
      await configManager.saveConfig(next, true);
      log.info('默认格式已更新', { format });
    } catch (e) {
      log.error('保存默认格式失败', e);
    }
  }

  return {
    currentDefault,
    hasCustomTemplate,
    mainButtonLabel,
    mainButtonTooltip,
    setDefaultFormat,
  };
}
