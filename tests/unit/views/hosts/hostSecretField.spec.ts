// 图床凭证框（P09 / P10）：钉住 sensitive-field-contract.md 的不变量——看一眼不等于改一次、圆点个数固定、
// 清空要确认（Esc / 关掉确认框一律当不删）；外加「查看」30 秒自动收回、Esc 取消编辑
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';

const m = vi.hoisted(() => ({ confirm: vi.fn(), toastError: vi.fn() }));

vi.mock('@/composables/useConfirm', () => ({ useConfirm: () => ({ confirm: m.confirm }) }));
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: m.toastError }) }));
vi.mock('@/security/shellOpen', () => ({ openTrustedExternalUrl: vi.fn() }));

const { default: HostSecretField } = await import('@/views/hosts/HostSecretField.vue');

const mounted: VueWrapper[] = [];

function mountField(props: { hasValue?: boolean; secret?: string; maskPrefix?: string } = {}) {
  const wrapper = mount(HostSecretField, {
    props: {
      label: 'Secret Access Key',
      hasValue: props.hasValue ?? true,
      reveal: vi.fn(async () => props.secret ?? 'sk-live-0123456789'),
      maskPrefix: props.maskPrefix ?? '',
    },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return wrapper;
}

const value = (wrapper: VueWrapper) => wrapper.find('.host-secret__value');
const revealButton = (wrapper: VueWrapper) => wrapper.findAll('button').find((b) => b.text() === '查看' || b.text() === '隐藏')!;

async function beginEdit(wrapper: VueWrapper): Promise<HTMLInputElement> {
  await value(wrapper).trigger('click');
  await nextTick();
  return wrapper.find('input').element as HTMLInputElement;
}

async function type(wrapper: VueWrapper, text: string): Promise<void> {
  const input = wrapper.find('input');
  await input.setValue(text);
  await input.trigger('input');
}

beforeEach(() => { vi.useFakeTimers(); m.confirm.mockReset(); m.toastError.mockReset(); });
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  vi.useRealTimers();
});

describe('HostSecretField', () => {
  it('看一眼不等于改一次：查看只显示明文，不写进输入框，也不保存', async () => {
    const wrapper = mountField({ secret: 'sk-live-0123456789' });
    await revealButton(wrapper).trigger('click');
    await vi.waitFor(() => expect(value(wrapper).text()).toBe('sk-live-0123456789'));

    const input = await beginEdit(wrapper);
    expect(input.value).toBe('');
    await wrapper.find('input').trigger('blur');
    expect(wrapper.emitted('commit')).toBeUndefined();
  });

  it('查看 30 秒后自动收回成圆点', async () => {
    const wrapper = mountField();
    await revealButton(wrapper).trigger('click');
    await vi.waitFor(() => expect(value(wrapper).text()).toBe('sk-live-0123456789'));
    vi.advanceTimersByTime(30_000);
    await nextTick();
    expect(value(wrapper).text()).not.toContain('sk-live');
  });

  it('圆点个数固定：长短不同的密钥看上去一样，前缀照写', () => {
    const short = mountField({ secret: '123456' });
    const long = mountField({ secret: 'x'.repeat(64) });
    const cookie = mountField({ maskPrefix: 'SUB=' });
    expect(value(short).text()).toBe(value(long).text());
    expect(value(cookie).text()).toBe(`SUB=${value(short).text()}`);
  });

  it('改：粘贴新值离开即保存；Esc 取消，不保存', async () => {
    const wrapper = mountField();
    await beginEdit(wrapper);
    await type(wrapper, '  new-secret  ');
    await wrapper.find('input').trigger('blur');
    expect(wrapper.emitted('commit')).toEqual([['new-secret']]);

    await beginEdit(wrapper);
    await type(wrapper, 'oops');
    await wrapper.find('input').trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.emitted('commit')).toHaveLength(1);
  });

  it('没输入就离开 = 取消，不问也不动已存的值', async () => {
    const wrapper = mountField();
    await beginEdit(wrapper);
    await wrapper.find('input').trigger('blur');
    expect(m.confirm).not.toHaveBeenCalled();
    expect(wrapper.emitted('commit')).toBeUndefined();
  });

  it('清空要确认：输入过又删空再离开先问；不确认（含 Esc、关掉）就留着', async () => {
    const wrapper = mountField();
    m.confirm.mockResolvedValueOnce(false);
    await beginEdit(wrapper);
    await type(wrapper, 'x');
    await type(wrapper, '');
    await wrapper.find('input').trigger('blur');
    await vi.waitFor(() => expect(m.confirm).toHaveBeenCalledTimes(1));
    expect(m.confirm).toHaveBeenCalledWith('清空后需重新填写，否则无法上传到这个图床。', expect.objectContaining({ header: '清空 Secret Access Key？', acceptLabel: '清空', tone: 'danger' }));
    expect(wrapper.emitted('commit')).toBeUndefined();

    m.confirm.mockResolvedValueOnce(true);
    await beginEdit(wrapper);
    await type(wrapper, 'x');
    await type(wrapper, '');
    await wrapper.find('input').trigger('blur');
    await vi.waitFor(() => expect(wrapper.emitted('commit')).toEqual([['']]));
  });

  it('查看失败：通知说清怎么办，框里仍是圆点', async () => {
    const wrapper = mount(HostSecretField, {
      props: { label: '密码', hasValue: true, reveal: vi.fn(async () => { throw new Error('decrypt failed'); }) },
      attachTo: document.body,
    });
    mounted.push(wrapper);
    await revealButton(wrapper).trigger('click');
    await vi.waitFor(() => expect(m.toastError).toHaveBeenCalledWith('无法查看密码', '请重新填写后再试'));
    expect(value(wrapper).text()).not.toContain('decrypt');
  });
});
