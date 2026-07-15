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

  const port = typeof value.port === 'number'
    && Number.isInteger(value.port)
    && value.port >= 1024
    && value.port <= 65535
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
