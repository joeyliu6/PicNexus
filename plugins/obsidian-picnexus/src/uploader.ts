import { requestUrl } from 'obsidian';
import type { UploadResponse, StatusResponse } from './types';

export class PicNexusUploader {
  private baseUrl: string;

  constructor(port: number) {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  updatePort(port: number): void {
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async checkStatus(): Promise<StatusResponse> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/status`,
      method: 'GET',
    });
    return resp.json as StatusResponse;
  }

  async uploadByPath(filePaths: string[]): Promise<UploadResponse> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/upload`,
      method: 'POST',
      body: JSON.stringify({ list: filePaths }),
      contentType: 'application/json',
    });
    return resp.json as UploadResponse;
  }

  async uploadByContent(data: ArrayBuffer, filename: string, contentType: string): Promise<UploadResponse> {
    const resp = await requestUrl({
      url: `${this.baseUrl}/upload/file`,
      method: 'POST',
      body: data,
      headers: {
        'Content-Type': contentType || 'image/png',
        'X-Filename': encodeURIComponent(filename),
      },
    });
    return resp.json as UploadResponse;
  }
}
