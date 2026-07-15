import { describe, expect, it } from 'vitest';
import { shallowMountWithDefaults } from '../helpers/vueMount';
import QueueCard from '@/components/upload/QueueCard.vue';
import ChannelCard from '@/components/upload/ChannelCard.vue';
import { DEFAULT_CONFIG } from '@/config/types';

describe('QueueCard', () => {
  it('向 ChannelCard 透传失败错误信息用于 tooltip', () => {
    const wrapper = shallowMountWithDefaults(QueueCard, {
      props: {
        item: {
          id: 'queue-1',
          fileName: 'a.jpg',
          filePath: '/tmp/a.jpg',
          enabledServices: ['upyun'],
          serviceProgress: {
            upyun: {
              serviceId: 'upyun',
              status: '✗ 失败',
              progress: 0,
              error: 'service error',
            },
          },
          status: 'error',
        },
        config: DEFAULT_CONFIG,
      },
      global: {
        stubs: {
          ThumbnailImage: true,
        },
      },
    });

    const channelCard = wrapper.findComponent(ChannelCard);
    expect(channelCard.exists()).toBe(true);
    expect(channelCard.props('error')).toBe('service error');
  });
});
