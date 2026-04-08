// MD 文档救援 — 筛选管道 + diff 生成
// 纯前端数据处理，只依赖 imageLinks 等共享状态

import { ref, computed, watch, type Ref } from 'vue';
import { watchDebounced } from '@vueuse/core';
import { replaceImageLinks } from '../../utils/mdParser';
import {
  type MdImageLinkWithFile,
  imageLinks,
  mode,
  fileContent,
} from './shared';

export type StatusFilter = 'invalid' | 'suspicious' | 'timeout' | 'unchecked' | 'valid' | 'all' | null;

/**
 * 筛选管道 composable（watch/watchDebounced 需要在 composable 函数内调用）
 */
export function useMdLinkFilter() {
  const statusFilter: Ref<StatusFilter> = ref('all');
  const selectedSourceFile = ref<string | null>(null);
  const searchInput = ref('');
  const searchQuery = ref('');
  const currentPage = ref(1);
  const PAGE_SIZE = 100;

  watch(statusFilter, () => { currentPage.value = 1; });
  watch(selectedSourceFile, () => { currentPage.value = 1; });
  watchDebounced(searchInput, (val) => { searchQuery.value = val; currentPage.value = 1; }, { debounce: 200 });

  const sourceFileList = computed(() => {
    const map = new Map<string, number>();
    for (const link of imageLinks.value) {
      map.set(link.sourceFileName, (map.get(link.sourceFileName) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  });

  const scopedLinks = computed(() => {
    let links = imageLinks.value;
    if (selectedSourceFile.value) {
      links = links.filter((l) => l.sourceFileName === selectedSourceFile.value);
    }
    const q = searchQuery.value.trim().toLowerCase();
    if (q) {
      links = links.filter((l) =>
        l.url.toLowerCase().includes(q)
        || l.sourceFileName.toLowerCase().includes(q)
        || (l.altText && l.altText.toLowerCase().includes(q)),
      );
    }
    return links;
  });

  const stats = computed(() => {
    const links = scopedLinks.value;
    let valid = 0, invalid = 0, timeout = 0, suspicious = 0, unchecked = 0;
    let rescuable = 0;
    for (const l of links) {
      const cr = l.checkResult;
      if (!cr) { unchecked++; continue; }
      if (cr.is_valid) { valid++; continue; }
      if (cr.error_type === 'timeout') { timeout++; }
      else if (cr.error_type === 'suspicious') { suspicious++; }
      else { invalid++; }
      if (l.backupLinks && l.backupLinks.length > 0) rescuable++;
    }
    const broken = invalid + timeout + suspicious;
    const checked = links.length - unchecked;
    const unresolvable = broken - rescuable;
    return {
      total: links.length, checked, valid, broken, rescuable, unresolvable,
      invalid, timeout, suspicious, unchecked,
    };
  });

  const brokenLinks = computed(() =>
    imageLinks.value.filter((l) => l.checkResult && !l.checkResult.is_valid),
  );

  const healthyLinks = computed(() =>
    imageLinks.value.filter((l) => l.checkResult?.is_valid),
  );

  const filteredLinks = computed(() => {
    let links = scopedLinks.value.filter((l) => {
      const r = l.checkResult;
      switch (statusFilter.value) {
        case null: return true;
        case 'invalid': return r && !r.is_valid && r.error_type !== 'timeout' && r.error_type !== 'suspicious';
        case 'suspicious': return r?.error_type === 'suspicious';
        case 'timeout': return r?.error_type === 'timeout';
        case 'unchecked': return !r;
        case 'valid': return r?.is_valid;
        case 'all': return true;
        default: return true;
      }
    });
    const severity: Record<string, number> = { http_4xx: 0, http_5xx: 1, network: 2, timeout: 3, suspicious: 4, success: 5 };
    links = [...links].sort((a, b) =>
      (severity[a.checkResult?.error_type ?? 'success'] ?? 5) - (severity[b.checkResult?.error_type ?? 'success'] ?? 5),
    );
    return links;
  });

  const totalPages = computed(() => Math.max(1, Math.ceil(filteredLinks.value.length / PAGE_SIZE)));
  const visibleLinks = computed(() => {
    const start = (currentPage.value - 1) * PAGE_SIZE;
    return filteredLinks.value.slice(start, start + PAGE_SIZE);
  });

  return {
    statusFilter,
    selectedSourceFile,
    searchInput,
    searchQuery,
    currentPage,
    PAGE_SIZE,
    sourceFileList,
    scopedLinks,
    stats,
    brokenLinks,
    healthyLinks,
    filteredLinks,
    totalPages,
    visibleLinks,
  };
}

/**
 * 生成简单的 diff 预览（变更行高亮）
 */
export function generateDiff(): Array<{ line: number; type: 'unchanged' | 'removed' | 'added'; text: string; file?: string }> {
  const allDiff: Array<{ line: number; type: 'unchanged' | 'removed' | 'added'; text: string; file?: string }> = [];

  const fileLinks = new Map<string, MdImageLinkWithFile[]>();
  for (const link of imageLinks.value) {
    if (link.selectedBackup && link.checkResult && !link.checkResult.is_valid) {
      const list = fileLinks.get(link.sourceFile) || [];
      list.push(link);
      fileLinks.set(link.sourceFile, list);
    }
  }

  if (fileLinks.size === 0) return [];

  if (mode.value === 'file' && fileContent.value && fileLinks.size === 1) {
    const replacements = new Map<string, string>();
    for (const link of imageLinks.value) {
      if (link.selectedBackup && link.checkResult && !link.checkResult.is_valid) {
        replacements.set(link.url, link.selectedBackup);
      }
    }

    const oldLines = fileContent.value.split('\n');
    const newContent = replaceImageLinks(fileContent.value, replacements);
    const newLines = newContent.split('\n');

    const maxLen = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLen; i++) {
      const oldLine = oldLines[i] ?? '';
      const newLine = newLines[i] ?? '';

      if (oldLine === newLine) {
        allDiff.push({ line: i + 1, type: 'unchanged', text: oldLine });
      } else {
        allDiff.push({ line: i + 1, type: 'removed', text: oldLine });
        allDiff.push({ line: i + 1, type: 'added', text: newLine });
      }
    }
  }

  return allDiff;
}
