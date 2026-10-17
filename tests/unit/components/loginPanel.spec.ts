// Cookie 登录小窗准备页（P16）：「开始登录」失败时原因写在按钮下方，不弹系统对话框
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import LoginPanel from '@/components/login/LoginPanel.vue';
import { COOKIE_PROVIDERS } from '@/config/cookieProviders';

describe('LoginPanel', () => {
  it('没出错时不显示错误行；出错时以红字写原因 + 处理办法', async () => {
    const wrapper = mount(LoginPanel, { props: { provider: COOKIE_PROVIDERS.weibo } });
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    await wrapper.setProps({ error: '当前平台不支持读取登录状态，请关闭此窗口后重试' });
    expect(wrapper.get('[role="alert"]').text()).toBe('当前平台不支持读取登录状态，请关闭此窗口后重试');
  });
});
