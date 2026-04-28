import { describe, expect, it } from 'vitest';
import { nextTick } from 'vue';
import { mountWithDefaults } from '../../helpers/vueMount';
import ThumbnailImage from '../../../components/common/ThumbnailImage.vue';

describe('ThumbnailImage fallback chain', () => {
  it('tries the next image source before rendering the placeholder', async () => {
    const wrapper = mountWithDefaults(ThumbnailImage, {
      props: {
        srcs: [
          'https://cdn.example.com/broken.jpg',
          'https://cdn.example.com/fallback.jpg',
        ],
        alt: 'fallback image',
        imageClass: 'history-thumb',
      },
      slots: {
        placeholder: '<span data-testid="thumb-fallback">fallback</span>',
      },
    });

    expect(wrapper.get('img').attributes('src')).toBe('https://cdn.example.com/broken.jpg');

    await wrapper.get('img').trigger('error');
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toBe('https://cdn.example.com/fallback.jpg');
    expect(wrapper.find('[data-testid="thumb-fallback"]').exists()).toBe(false);

    await wrapper.get('img').trigger('error');
    await nextTick();

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-testid="thumb-fallback"]').text()).toBe('fallback');
  });

  it('resets the fallback index when the source list changes', async () => {
    const wrapper = mountWithDefaults(ThumbnailImage, {
      props: {
        srcs: ['https://cdn.example.com/old.jpg'],
        alt: 'changing image',
      },
    });

    await wrapper.get('img').trigger('error');
    await nextTick();
    expect(wrapper.find('.thumbnail-placeholder').exists()).toBe(true);

    await wrapper.setProps({
      srcs: ['https://cdn.example.com/new-primary.jpg', 'https://cdn.example.com/new-fallback.jpg'],
    });
    await nextTick();

    expect(wrapper.get('img').attributes('src')).toBe('https://cdn.example.com/new-primary.jpg');
  });
});
