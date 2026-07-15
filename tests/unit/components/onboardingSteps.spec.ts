import { describe, expect, it } from 'vitest';
import { mountWithDefaults } from '../helpers/vueMount';
import UploadStep from '@/components/onboarding/steps/UploadStep.vue';
import ServicesStep from '@/components/onboarding/steps/ServicesStep.vue';

describe('Onboarding steps', () => {
  it('UploadStep 展示四种上传方式且不重复默认图床说明', () => {
    const wrapper = mountWithDefaults(UploadStep);

    expect(wrapper.text()).toContain('支持四种上传方式');
    expect(wrapper.text()).not.toContain('上传后自动生成 URL、Markdown、HTML 等格式链接');
    expect(wrapper.text()).not.toContain('京东、七鱼图床已默认启用');
    expect(wrapper.findAll('.method-card')).toHaveLength(4);
    expect(wrapper.text()).toContain('拖拽文件');
    expect(wrapper.text()).toContain('点击选择');
    expect(wrapper.text()).toContain('粘贴上传');
    expect(wrapper.text()).toContain('URL 下载');
  });

  it('ServicesStep 使用精简图床说明', () => {
    const wrapper = mountWithDefaults(ServicesStep);

    expect(wrapper.text()).toContain('京东、七鱼可开箱使用，其他图床按需配置。');
    expect(wrapper.text()).not.toContain('但需先确认公共图床风险');
    expect(wrapper.text()).not.toContain('京东、七鱼已默认开启；其他图床可按需配置，支持多图床并行上传。');
  });
});
