// src/composables/useAdvancedSearch.ts
// 高级搜索功能

import { ref } from 'vue';
import { historyDB } from '../services/HistoryDatabase';
import type { ServiceType } from '../config/types';

export interface AdvancedSearchParams {
  keyword?: string;
  regex?: boolean;
  fields?: Array<'filename' | 'url' | 'service' | 'note'>;
  services?: ServiceType[];
  dateFrom?: Date;
  dateTo?: Date;
  sizeMin?: number;
  sizeMax?: number;
  sortBy?: 'createdAt' | 'size' | 'filename';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export function useAdvancedSearch() {
  const isLoading = ref(false);
  const results = ref<any[]>([]);
  const totalCount = ref(0);

  const searchParams = ref<AdvancedSearchParams>({
    sortBy: 'createdAt',
    sortOrder: 'desc',
    limit: 100,
    offset: 0
  });

  async function search(params: Partial<AdvancedSearchParams> = {}) {
    isLoading.value = true;
    try {
      searchParams.value = { ...searchParams.value, ...params };

      const allRecords: any[] = [];
      for await (const batch of historyDB.getAllStream(1000)) {
        allRecords.push(...batch);
      }
      let filtered = [...allRecords];

      if (searchParams.value.keyword) {
        const keyword = searchParams.value.keyword;
        const fields = searchParams.value.fields || ['filename', 'url'];
        const useRegex = searchParams.value.regex;

        filtered = filtered.filter(record => {
          const localFileName = record.localFileName || '';
          const generatedLink = record.generatedLink || '';

          return fields.some(field => {
            const value = field === 'filename' ? localFileName : generatedLink;
            if (useRegex) {
              try {
                return new RegExp(keyword, 'i').test(value);
              } catch {
                return false;
              }
            } else {
              return value.toLowerCase().includes(keyword.toLowerCase());
            }
          });
        });
      }

      if (searchParams.value.services && searchParams.value.services.length > 0) {
        filtered = filtered.filter(record =>
          searchParams.value.services!.includes(record.primaryService)
        );
      }

      if (searchParams.value.dateFrom) {
        const from = searchParams.value.dateFrom.getTime();
        filtered = filtered.filter(record => record.timestamp >= from);
      }

      if (searchParams.value.dateTo) {
        const to = searchParams.value.dateTo.getTime();
        filtered = filtered.filter(record => record.timestamp <= to);
      }

      if (searchParams.value.sizeMin) {
        filtered = filtered.filter(record =>
          (record.fileSize || 0) >= searchParams.value.sizeMin!
        );
      }

      if (searchParams.value.sizeMax) {
        filtered = filtered.filter(record =>
          (record.fileSize || 0) <= searchParams.value.sizeMax!
        );
      }

      const sortBy = searchParams.value.sortBy || 'createdAt';
      const sortOrder = searchParams.value.sortOrder || 'desc';
      const multiplier = sortOrder === 'asc' ? 1 : -1;

      filtered.sort((a, b) => {
        let aVal: any, bVal: any;

        if (sortBy === 'createdAt') {
          aVal = a.timestamp;
          bVal = b.timestamp;
        } else if (sortBy === 'size') {
          aVal = a.fileSize || 0;
          bVal = b.fileSize || 0;
        } else if (sortBy === 'filename') {
          aVal = (a.localFileName || '').toLowerCase();
          bVal = (b.localFileName || '').toLowerCase();
        }

        if (typeof aVal === 'string') {
          return aVal.localeCompare(bVal) * multiplier;
        } else {
          return (aVal - bVal) * multiplier;
        }
      });

      totalCount.value = filtered.length;

      const limit = searchParams.value.limit || 100;
      const offset = searchParams.value.offset || 0;
      results.value = filtered.slice(offset, offset + limit);

    } catch (error) {
      console.error('搜索失败:', error);
      throw error;
    } finally {
      isLoading.value = false;
    }
  }

  async function exportResults(format: 'json' | 'csv' = 'json') {
    if (format === 'json') {
      return JSON.stringify(results.value, null, 2);
    } else {
      const headers = ['ID', '文件名', '图床', 'URL', '上传时间', '大小'];
      const rows = results.value.map(r => [
        r.id,
        r.localFileName,
        r.primaryService,
        r.generatedLink,
        new Date(r.timestamp).toLocaleString(),
        `${(r.fileSize || 0) / 1024} KB`
      ]);
      return [headers, ...rows].map(row => row.join(',')).join('\n');
    }
  }

  function reset() {
    searchParams.value = {
      sortBy: 'createdAt',
      sortOrder: 'desc',
      limit: 100,
      offset: 0
    };
    results.value = [];
    totalCount.value = 0;
  }

  return {
    isLoading,
    results,
    totalCount,
    searchParams,
    search,
    exportResults,
    reset
  };
}
