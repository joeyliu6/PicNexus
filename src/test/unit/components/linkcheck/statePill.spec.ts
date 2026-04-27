import { describe, expect, it } from 'vitest';
import { mountWithDefaults } from '../../../helpers/vueMount';
import StatePill from '../../../../components/views/linkcheck/common/StatePill.vue';

describe('StatePill', () => {
  it('running 态显示呼吸点，不再显示圆环进度', () => {
    const wrapper = mountWithDefaults(StatePill, {
      props: {
        pill: {
          tone: 'running',
          label: '检测中',
          progressPercent: 42,
          tooltip: {
            title: '链接检测中',
            items: [{ label: '完成度', value: '42%' }],
          },
        },
      },
    });

    expect(wrapper.find('.bm-state-pill__dot').exists()).toBe(true);
    expect(wrapper.find('.bm-state-pill__progress').exists()).toBe(false);
    expect(wrapper.find('[role="progressbar"]').exists()).toBe(false);
  });

  it('暂停/取消态显示传入图标和 tooltip 内容', () => {
    const wrapper = mountWithDefaults(StatePill, {
      props: {
        pill: {
          tone: 'cancelling',
          icon: 'pi pi-spin pi-spinner',
          label: '正在取消…',
          tooltip: {
            title: '批量迁移进度',
            items: [
              { label: '成功', value: '12', tone: 'success' },
              { label: '失败', value: '2', tone: 'danger' },
            ],
            notes: ['已成功写入的数据会保留'],
          },
        },
      },
    });

    expect(wrapper.find('i.pi-spinner').exists()).toBe(true);
    expect(wrapper.text()).toContain('批量迁移进度');
    expect(wrapper.text()).toContain('成功');
    expect(wrapper.text()).toContain('12');
    expect(wrapper.text()).toContain('已成功写入的数据会保留');
  });
});
