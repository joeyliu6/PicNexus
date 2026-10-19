import { describe, expect, it } from 'vitest';
import { hostWarningText } from '@/composables/upload/useUploadController';
import UploadToPanel from '@/views/home/UploadToPanel.vue';
import { mountWithDefaults } from '../../helpers/vueMount';

// 「上传到」面板里勾选的图床有问题时那一行（HomeScreen.dc.html）：
// 待拍板 ㉑（选 A）Cookie 图床统一说「登录失效」（同图床页、托盘）；⑪（选 A）「重新登录」开登录小窗，加「…」
describe('UploadToPanel', () => {
  it('says 登录失效 for a cookie host and offers 重新登录…', () => {
    const wrapper = mountWithDefaults(UploadToPanel, {
      props: { hosts: [{ id: 'weibo', name: '微博', selected: true, warning: hostWarningText('weibo', null), cookieLogin: true }] },
    });
    expect(wrapper.get('.upload-to__warn-text').text()).toBe('微博登录失效，暂时传不上');
    expect(wrapper.get('.upload-to__link').text()).toBe('重新登录…');
  });
});
