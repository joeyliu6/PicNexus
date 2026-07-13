export interface PicNexusSettings {
  port: number;
  autoUploadOnPaste: boolean;
  autoUploadOnDrop: boolean;
  showNotifications: boolean;
  imageFormat: 'markdown' | 'wiki';
}

export const DEFAULT_SETTINGS: PicNexusSettings = {
  port: 36799,
  autoUploadOnPaste: true,
  autoUploadOnDrop: true,
  showNotifications: true,
  imageFormat: 'markdown',
};

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
