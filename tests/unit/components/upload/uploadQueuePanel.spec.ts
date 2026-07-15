import { describe, expect, it } from 'vitest';
import { mountWithDefaults } from '../../helpers/vueMount';
import UploadQueuePanel from '@/components/views/upload/UploadQueuePanel.vue';

function mountPanel(props = {}) {
  return mountWithDefaults(UploadQueuePanel, {
    props: {
      hasFailedItems: false,
      hasCompletedItems: false,
      hasQueueItems: false,
      hasActiveItems: false,
      isBatchRetrying: false,
      queueTotal: 0,
      queueDone: 0,
      ...props,
    },
    global: {
      stubs: {
        UploadQueue: {
          template: '<div class="upload-queue-stub" />',
          methods: {
            setRetryCallback() {},
          },
        },
      },
    },
  });
}

describe('UploadQueuePanel', () => {
  it('显示队列进度并透传批量操作', async () => {
    const wrapper = mountPanel({
      hasFailedItems: true,
      hasCompletedItems: true,
      hasQueueItems: true,
      queueTotal: 5,
      queueDone: 2,
    });

    await wrapper.get('.retry-btn').trigger('click');
    await wrapper.get('.clear-completed-btn').trigger('click');
    await wrapper.get('.clear-btn').trigger('click');

    expect(wrapper.text()).toContain('2/5');
    expect(wrapper.emitted('batch-retry')).toHaveLength(1);
    expect(wrapper.emitted('clear-completed')).toHaveLength(1);
    expect(wrapper.emitted('clear-queue')).toHaveLength(1);
  });

  it('批量重传中禁用重传按钮并显示 loading 文案', () => {
    const wrapper = mountPanel({
      hasFailedItems: true,
      isBatchRetrying: true,
      queueTotal: 3,
      queueDone: 1,
    });

    expect(wrapper.get('.retry-btn').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('重传中...');
  });

  it('上传进行中禁用清空列表', async () => {
    const wrapper = mountPanel({
      hasQueueItems: true,
      hasActiveItems: true,
      queueTotal: 1,
    });

    const button = wrapper.get('.clear-btn');
    expect(button.attributes('disabled')).toBeDefined();

    await button.trigger('click');

    expect(wrapper.emitted('clear-queue')).toBeUndefined();
  });

  it('无队列动作时只保留上传队列容器', () => {
    const wrapper = mountPanel();

    expect(wrapper.find('.retry-btn').exists()).toBe(false);
    expect(wrapper.find('.clear-completed-btn').exists()).toBe(false);
    expect(wrapper.find('.clear-btn').exists()).toBe(false);
    expect(wrapper.find('.upload-queue-stub').exists()).toBe(true);
  });
});
