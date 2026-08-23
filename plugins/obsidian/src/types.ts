export interface PicNexusSettings {
  port: number;
  autoUploadOnPaste: boolean;
  autoUploadOnDrop: boolean;
  showNotifications: boolean;
}

export const DEFAULT_SETTINGS: PicNexusSettings = {
  port: 36799,
  autoUploadOnPaste: true,
  autoUploadOnDrop: true,
  showNotifications: true,
};

export const PORT_MIN = 1024;
export const PORT_MAX = 65535;

/**
 * 端口判据的唯一来源：加载路径（normalizeSettings）和输入路径（设置项的 validate 回调）共用。
 * 合法返回 undefined；非法返回给用户看的中文文案。
 */
export function validatePort(value: number): string | undefined {
  if (!Number.isInteger(value)) return '端口必须是整数';
  if (value < PORT_MIN || value > PORT_MAX) return `端口需在 ${PORT_MIN}–${PORT_MAX} 之间`;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBoolean(
  settings: Record<string, unknown>,
  key: keyof Pick<PicNexusSettings, 'autoUploadOnPaste' | 'autoUploadOnDrop' | 'showNotifications'>,
): boolean {
  const value = settings[key];
  return typeof value === 'boolean' ? value : DEFAULT_SETTINGS[key];
}

export function normalizeSettings(value: unknown): PicNexusSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };

  const port = typeof value.port === 'number' && !validatePort(value.port)
    ? value.port
    : DEFAULT_SETTINGS.port;

  return {
    port,
    autoUploadOnPaste: readBoolean(value, 'autoUploadOnPaste'),
    autoUploadOnDrop: readBoolean(value, 'autoUploadOnDrop'),
    showNotifications: readBoolean(value, 'showNotifications'),
  };
}

export interface UploadResponse {
  success: boolean;
  result?: string[];
  message?: string;
}

export interface StatusResponse {
  app: string;
  version: string;
  service: string | null;
  serviceName: string | null;
  ready: boolean;
}
