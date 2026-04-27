import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { getShellOpenMock } from '../../../helpers/tauriMock';

const {
  toastWarnMock,
  toastErrorMock,
  copyLinkActionMock,
  applyConfiguredUrlMock,
  confirmDeleteMock,
} = vi.hoisted(() => ({
  toastWarnMock: vi.fn(),
  toastErrorMock: vi.fn(),
  copyLinkActionMock: vi.fn(),
  applyConfiguredUrlMock: vi.fn((url: string, serviceId?: string) => `prefixed:${serviceId}:${url}`),
  confirmDeleteMock: vi.fn(),
}));
const shellOpenMock = getShellOpenMock();

vi.mock('../../../../composables/useToast', () => ({
  useToast: () => ({
    warn: toastWarnMock,
    error: toastErrorMock,
  }),
}));

vi.mock('../../../../composables/useCopyLink', () => ({
  useCopyLink: () => ({
    copyLink: copyLinkActionMock,
    applyConfiguredUrl: applyConfiguredUrlMock,
  }),
}));

vi.mock('../../../../composables/useConfirm', () => ({
  useConfirm: () => ({
    confirmDelete: confirmDeleteMock,
  }),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { useLightboxActions } = await import('../../../../composables/history/useLightboxActions');

function makeHistoryItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    timestamp: 1_710_000_000_000,
    localFileName: 'demo.png',
    primaryService: 'weibo',
    generatedLink: 'https://img.example.com/demo.png',
    results: [
      {
        serviceId: 'weibo',
        status: 'success',
        result: {
          serviceId: 'weibo',
          fileKey: 'demo-key',
          url: 'https://img.example.com/demo.png',
        },
      },
    ],
    width: 100,
    height: 80,
    ...overrides,
  };
}

function mountHarness(initialItem = makeHistoryItem()) {
  const item = ref(initialItem as ReturnType<typeof makeHistoryItem> | null);
  const resetZoom = vi.fn();
  const onDelete = vi.fn();
  let api: ReturnType<typeof useLightboxActions> | null = null;

  const Harness = defineComponent({
    setup() {
      api = useLightboxActions({
        item: item as never,
        resetZoom,
        onDelete,
      });
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  return {
    wrapper,
    item,
    resetZoom,
    onDelete,
    api: () => api!,
  };
}

describe('useLightboxActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    copyLinkActionMock.mockResolvedValue({ ok: true });
    shellOpenMock.mockResolvedValue(undefined);
  });

  it('warns instead of copying when the current item has no generated link', async () => {
    const harness = mountHarness(makeHistoryItem({ generatedLink: '' }));

    await harness.api().handleCopyLink();

    expect(copyLinkActionMock).not.toHaveBeenCalled();
    expect(toastWarnMock).toHaveBeenCalledTimes(1);
  });

  it('copies the primary link and resets copy feedback after the timer elapses', async () => {
    const harness = mountHarness();

    await harness.api().handleCopyLink();

    expect(copyLinkActionMock).toHaveBeenCalledWith({
      url: 'https://img.example.com/demo.png',
      fileName: 'demo.png',
      serviceId: 'weibo',
      width: 100,
      height: 80,
    }, { showSuccessToast: false });
    expect(harness.api().copySuccess.value).toBe(true);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(harness.api().copySuccess.value).toBe(false);
  });

  it('clears copy feedback immediately when the lightbox item changes', async () => {
    const harness = mountHarness();

    await harness.api().handleCopyLink();
    expect(harness.api().copySuccess.value).toBe(true);

    harness.item.value = makeHistoryItem({
      id: 'item-2',
      generatedLink: 'https://img.example.com/second.png',
    });
    await nextTick();

    expect(harness.api().copySuccess.value).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(harness.api().copySuccess.value).toBe(false);
  });

  it('copies a specific successful service link and warns when that service has no usable URL', async () => {
    const harness = mountHarness(makeHistoryItem({
      results: [
        {
          serviceId: 'weibo',
          status: 'success',
          result: {
            serviceId: 'weibo',
            fileKey: 'demo-key',
            url: 'https://img.example.com/demo.png',
          },
        },
        {
          serviceId: 'r2',
          status: 'failed',
          error: 'boom',
        },
      ],
    }));

    await harness.api().handleCopyServiceLink('weibo');
    expect(copyLinkActionMock).toHaveBeenCalledWith({
      url: 'https://img.example.com/demo.png',
      fileName: 'demo.png',
      serviceId: 'weibo',
      width: 100,
      height: 80,
    }, { showSuccessToast: false });

    copyLinkActionMock.mockClear();
    await harness.api().handleCopyServiceLink('r2');
    expect(copyLinkActionMock).not.toHaveBeenCalled();
    expect(toastWarnMock).toHaveBeenCalledTimes(1);
  });

  it('opens the prefixed URL in the browser and reports failures through the toast', async () => {
    const harness = mountHarness();

    await harness.api().openInBrowser();

    expect(applyConfiguredUrlMock).toHaveBeenCalledWith('https://img.example.com/demo.png', 'weibo');
    expect(shellOpenMock).toHaveBeenCalledWith('prefixed:weibo:https://img.example.com/demo.png');

    shellOpenMock.mockRejectedValueOnce(new Error('denied'));
    await harness.api().openInBrowser();

    expect(toastErrorMock).toHaveBeenCalledTimes(1);
  });

  it('resets zoom before confirming deletion and deletes the originally selected item after confirmation', async () => {
    const harness = mountHarness();

    harness.api().handleDelete();

    expect(harness.resetZoom).toHaveBeenCalledTimes(1);
    expect(confirmDeleteMock).toHaveBeenCalledTimes(1);

    const [, confirmCallback] = confirmDeleteMock.mock.calls[0];
    harness.item.value = makeHistoryItem({ id: 'item-2' });
    (confirmCallback as () => void)();

    expect(harness.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'item-1' }));
  });
});
