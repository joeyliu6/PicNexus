import { computed, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryItem, UserConfig } from '../../../../config/types';
import { buildCheckItemsSync, liteRowToItem } from '../../../../composables/link-check/linkCheckDataBuilder';
import { useCheckStats } from '../../../../composables/link-check/useCheckStats';
import type { LinkCheckLiteRow } from '../../../../services/HistoryDatabase';
import type { LinkCheckRow } from '../../../../types/linkCheck';

vi.mock('../../../../composables/useCopyLink', () => ({
  applyLinkPrefix: (url: string) => url,
}));

const EMPTY_CONFIG = {} as UserConfig;

describe('link check skip state', () => {
  it('liteRowToItem() maps link_check_skip to linkCheckSkip', () => {
    const row: LinkCheckLiteRow = {
      id: 'row-1',
      local_file_name: 'demo.png',
      primary_service: 'r2',
      results: '[]',
      link_check_status: null,
      link_check_skip: 1,
    };

    const item = liteRowToItem(row);
    expect(item.linkCheckSkip).toBe(true);
  });

  it('buildCheckItemsSync() carries item linkCheckSkip onto every row', () => {
    const item: HistoryItem = {
      id: 'history-1',
      timestamp: 0,
      localFileName: 'demo.png',
      primaryService: 'r2',
      generatedLink: '',
      linkCheckSkip: true,
      results: [
        {
          serviceId: 'r2',
          status: 'success',
          result: { serviceId: 'r2', fileKey: 'file-1', url: 'https://example.com/demo.png' },
        },
      ],
    };

    const { rows } = buildCheckItemsSync([item], EMPTY_CONFIG);
    expect(rows).toHaveLength(1);
    expect(rows[0].linkCheckSkip).toBe(true);
  });

  it('useCheckStats() excludes skipped rows from active totals and tracks skipped count separately', () => {
    const rows = ref<LinkCheckRow[]>([
      {
        historyId: 'h1',
        serviceId: 'r2',
        url: 'https://example.com/a.png',
        rawUrl: 'https://example.com/a.png',
        fileName: 'a.png',
        linkCheckSkip: true,
      },
      {
        historyId: 'h2',
        serviceId: 'r2',
        url: 'https://example.com/b.png',
        rawUrl: 'https://example.com/b.png',
        fileName: 'b.png',
      },
    ]);

    const { stats } = useCheckStats({
      scopedRows: computed(() => rows.value),
      checkRows: rows,
      progress: ref(null),
    });

    expect(stats.value.total).toBe(1);
    expect(stats.value.unchecked).toBe(1);
    expect(stats.value.skipped).toBe(1);
  });
});
