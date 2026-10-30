// 命令面板（Ctrl K / ⌘ K，HomeScreen.dc.html H15 / H16）的开关与条目。
// 空输入：最近 3 张、常用跳转、动作；输入时按文件名实时匹配图片，再加命中的页面 / 动作 / 设置项。

import { computed, ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import type { HistoryItem } from '@/config/types';
import { getServiceDisplayName } from '@/constants/serviceNames';
import { historyDB } from '@/services/database';
import { useRecentUploads } from '@/composables/history/useRecentUploads';
import { useThemeManager } from '@/composables/useTheme';
import { formatRelativeTime, formatShortDateTime } from '@/utils/formatters';
import { createLogger } from '@/utils/logger';
import { ACTION_COMMANDS, DEFAULT_JUMPS, PAGE_COMMANDS, SETTING_COMMANDS, splitMatch, type ActionId } from './commandIndex';
import type { IconName } from '@/components/pn/icons';
import type { NavigatePayload } from './navigatePayload';

const log = createLogger('CommandPalette');

type CommandRun =
  | { kind: 'image'; item: HistoryItem }
  | { kind: 'page'; path: string }
  | { kind: 'action'; action: ActionId }
  | { kind: 'setting'; target: NavigatePayload };

export interface CommandEntry {
  id: string;
  label: string;
  match: [string, string, string] | null;
  sub?: string;
  hint?: string;
  icon?: IconName;
  image?: HistoryItem;
  run: CommandRun;
}

export interface CommandGroup {
  title: string;
  entries: CommandEntry[];
}

const open = ref(false);
const query = ref('');
const imageResults = ref<HistoryItem[]>([]);

const IMAGE_LIMIT = 6;

export function useCommandPalette() {
  const { recent } = useRecentUploads();
  const { effectiveTheme } = useThemeManager();
  const actionLabel = (a: (typeof ACTION_COMMANDS)[number]) => (a.action === 'theme' && effectiveTheme.value === 'dark' ? '切换到浅色' : a.label);

  const runSearch = useDebounceFn(async (keyword: string) => {
    if (!keyword.trim()) {
      imageResults.value = [];
      return;
    }
    try {
      const result = await historyDB.search(keyword, { limit: IMAGE_LIMIT });
      if (query.value === keyword) imageResults.value = result.items;
    } catch (error) {
      log.warn('搜索图片失败', error);
    }
  }, 120);

  watch(query, (value) => { void runSearch(value); });
  watch(open, (value) => { if (!value) { query.value = ''; imageResults.value = []; } });

  function imageEntry(item: HistoryItem, keyword: string, hint?: string): CommandEntry {
    return {
      id: `image:${item.id}`,
      label: item.localFileName,
      match: splitMatch(item.localFileName, keyword),
      sub: keyword ? `${formatShortDateTime(item.timestamp)} · ${getServiceDisplayName(item.primaryService)}` : undefined,
      hint,
      image: item,
      run: { kind: 'image', item },
    };
  }

  const groups = computed<CommandGroup[]>(() => {
    const keyword = query.value.trim();
    const matches = (label: string) => !keyword || label.toLowerCase().includes(keyword.toLowerCase());
    const pages = PAGE_COMMANDS.filter((p) => (keyword ? matches(p.label) : DEFAULT_JUMPS.includes(p.id)))
      .map<CommandEntry>((p) => ({ id: p.id, label: p.label, match: splitMatch(p.label, keyword), hint: p.shortcut, icon: p.icon, run: { kind: 'page', path: p.path } }));
    const actions = ACTION_COMMANDS.filter((a) => matches(actionLabel(a)))
      .map<CommandEntry>((a) => ({ id: a.id, label: actionLabel(a), match: splitMatch(actionLabel(a), keyword), hint: a.shortcut, icon: a.icon, run: { kind: 'action', action: a.action } }));

    if (!keyword) {
      return [
        { title: '最近上传', entries: recent.value.slice(0, 3).map((item) => imageEntry(item, '', formatRelativeTime(item.timestamp))) },
        { title: '跳转', entries: pages },
        { title: '动作', entries: actions },
      ].filter((g) => g.entries.length > 0);
    }

    const settings = SETTING_COMMANDS.filter((s) => matches(s.label) || (s.sub && matches(s.sub)))
      .map<CommandEntry>((s) => ({ id: s.id, label: s.label, match: splitMatch(s.label, keyword), sub: s.sub, icon: s.icon, run: { kind: 'setting', target: s.target } }));
    return [
      { title: '图片', entries: imageResults.value.map((item) => imageEntry(item, keyword)) },
      { title: '页面', entries: pages },
      { title: '动作', entries: actions },
      { title: '设置', entries: settings },
    ].filter((g) => g.entries.length > 0);
  });

  const flat = computed(() => groups.value.flatMap((g) => g.entries));

  return {
    open,
    query,
    groups,
    flat,
    show: () => { open.value = true; },
    hide: () => { open.value = false; },
    toggle: () => { open.value = !open.value; },
  };
}
