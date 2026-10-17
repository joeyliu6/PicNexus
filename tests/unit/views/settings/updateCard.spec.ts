// 更新卡：每页最多一个主按钮——设置页顶部出现刷新横幅（它的「刷新」是主按钮）时，更新卡的按钮退成次要按钮
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import UpdateCard from '@/views/settings/UpdateCard.vue';
import { useAutoUpdate } from '@/composables/useAutoUpdate';
import { __resetCloudSyncForTests, useCloudSync } from '@/views/settings/useCloudSync';

const update = useAutoUpdate();

function found(): void {
  update.status.value = 'available';
  update.pendingUpdateAvailable.value = true;
  update.updateInfo.value = { version: '1.2.0', date: '2026-10-15', body: '- 新的设置页' };
}

afterEach(() => {
  update.status.value = 'idle';
  update.pendingUpdateAvailable.value = false;
  update.updateInfo.value = null;
  __resetCloudSyncForTests();
});

describe('UpdateCard', () => {
  it('发现新版本：「立即更新」是主按钮', async () => {
    found();
    const wrapper = mount(UpdateCard);
    await nextTick();
    expect(wrapper.find('.pn-button').classes()).toContain('pn-button--primary');
  });

  it('刷新横幅在时：「立即更新」退成次要按钮', async () => {
    found();
    useCloudSync().needsReload.value = 'cloud';
    const wrapper = mount(UpdateCard);
    await nextTick();
    expect(wrapper.find('.pn-button').classes()).toContain('pn-button--secondary');
  });
});
