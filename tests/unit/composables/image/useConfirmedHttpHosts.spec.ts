import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { WebDAVStorageProfile } from '@/config/types';
import { useConfirmedHttpHosts } from '@/composables/image/useConfirmedHttpHosts';

const nas: WebDAVStorageProfile = {
  id: 'nas', name: 'NAS', url: 'http://192.168.1.2/dav', username: '', passwordEncrypted: '', remotePath: '/',
  publicDomain: 'http://nas.example.com', publicUrlTemplate: '', lanHttpConfirmed: true,
};

describe('useConfirmedHttpHosts', () => {
  it('lists the confirmed plain-HTTP hosts and keeps one Set while that list stays the same', () => {
    const config = ref<{ webdav_profiles: WebDAVStorageProfile[] }>({ webdav_profiles: [nas] });
    const hosts = useConfirmedHttpHosts(config);
    const first = hosts.value;
    expect([...first]).toEqual(['nas.example.com']);

    // 保存了一次与域名无关的配置：名单没变，引用也不变（缩略图不会白重试）
    config.value = { webdav_profiles: [{ ...nas, name: 'Home NAS' }] };
    expect(hosts.value).toBe(first);

    config.value = { webdav_profiles: [{ ...nas, lanHttpConfirmed: false }] };
    expect(hosts.value.size).toBe(0);
  });
});
