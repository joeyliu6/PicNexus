import { syncStatusStore } from '../store/instances';
import { createLogger } from './logger';

const DEVICE_ID_KEY = 'deviceId';
const log = createLogger('SyncDevice');

let cachedDeviceId: string | null = null;

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function getSyncDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const stored = await syncStatusStore.get<string>(DEVICE_ID_KEY);
    if (typeof stored === 'string' && stored.trim()) {
      cachedDeviceId = stored.trim();
      return cachedDeviceId;
    }

    const nextId = createDeviceId();
    await syncStatusStore.set(DEVICE_ID_KEY, nextId);
    await syncStatusStore.save();
    cachedDeviceId = nextId;
    return nextId;
  } catch (error) {
    log.warn('读取或保存设备 ID 失败，使用本次会话临时 ID:', error);
    cachedDeviceId = createDeviceId();
    return cachedDeviceId;
  }
}

export function resetCachedSyncDeviceIdForTests(): void {
  cachedDeviceId = null;
}
